const floatService = require("../../services/xiaofuFloatService");

const FLOAT_SIZE = 58;
const EDGE_MARGIN = 10;
const DRAG_THRESHOLD = 5;
const FRAME_MS = 16;

function getSystemInfo() {
  try {
    if (wx.getWindowInfo) return wx.getWindowInfo();
  } catch (error) {
    // fall back below
  }
  try {
    return wx.getSystemInfoSync();
  } catch (error) {
    return {
      windowWidth: 375,
      windowHeight: 667,
      safeArea: null,
    };
  }
}

Component({
  properties: {
    context: {
      type: Object,
      value: null,
    },
    hidden: {
      type: Boolean,
      value: false,
    },
    bottomOffset: {
      type: Number,
      value: 0,
    },
  },

  data: {
    visible: false,
    dimmed: false,
    moving: false,
    logoReady: true,
    x: 0,
    y: 0,
    size: FLOAT_SIZE,
  },

  lifetimes: {
    attached() {
      this._touch = null;
      this._lastMoveAt = 0;
      this.refreshPosition();
    },
  },

  pageLifetimes: {
    show() {
      this.refreshPosition();
    },
  },

  observers: {
    "hidden, bottomOffset": function refreshByProps() {
      this.refreshPosition();
    },
  },

  methods: {
    currentRoute() {
      try {
        const pages = getCurrentPages && getCurrentPages();
        const page = pages && pages.length ? pages[pages.length - 1] : null;
        return page && page.route || "";
      } catch (error) {
        return "";
      }
    },

    getBounds(policy) {
      const info = getSystemInfo();
      const width = Number(info.windowWidth || 375) || 375;
      const height = Number(info.windowHeight || 667) || 667;
      const safeArea = info.safeArea || {};
      const safeTop = Number(safeArea.top || 0) || 0;
      const safeBottomGap = safeArea.bottom ? Math.max(0, height - Number(safeArea.bottom || height)) : 0;
      const bottomAvoid = Number(policy && policy.bottomAvoidPx || 28) + safeBottomGap + Number(this.properties.bottomOffset || 0);
      return {
        minX: EDGE_MARGIN,
        maxX: Math.max(EDGE_MARGIN, width - FLOAT_SIZE - EDGE_MARGIN),
        minY: Math.max(EDGE_MARGIN, safeTop + 56),
        maxY: Math.max(EDGE_MARGIN, height - FLOAT_SIZE - bottomAvoid),
        width,
        height,
      };
    },

    clampPosition(position, bounds) {
      const source = position || {};
      const x = Number(source.x);
      const y = Number(source.y);
      return {
        x: Math.min(bounds.maxX, Math.max(bounds.minX, Number.isFinite(x) ? x : bounds.maxX)),
        y: Math.min(bounds.maxY, Math.max(bounds.minY, Number.isFinite(y) ? y : bounds.maxY - 18)),
      };
    },

    refreshPosition() {
      const route = this.currentRoute();
      const policy = floatService.getRoutePolicy(route);
      const hidden = this.properties.hidden === true ||
        policy.hidden ||
        !floatService.isEnabled() ||
        floatService.isRouteHidden(route);
      if (hidden) {
        this.setData({ visible: false });
        return;
      }
      const bounds = this.getBounds(policy);
      const saved = floatService.getPosition();
      const position = this.clampPosition(saved || { x: bounds.maxX, y: bounds.maxY - 18 }, bounds);
      this.setData({
        visible: true,
        dimmed: policy.dimmed,
        x: Math.round(position.x),
        y: Math.round(position.y),
      });
    },

    getTouch(event) {
      const touches = event && event.touches && event.touches.length ? event.touches : event && event.changedTouches;
      return touches && touches.length ? touches[0] : null;
    },

    onTouchStart(event) {
      const touch = this.getTouch(event);
      if (!touch) return;
      this._touch = {
        startX: Number(touch.clientX || 0),
        startY: Number(touch.clientY || 0),
        lastX: Number(touch.clientX || 0),
        lastY: Number(touch.clientY || 0),
        originX: Number(this.data.x || 0),
        originY: Number(this.data.y || 0),
        dragging: false,
      };
      this._longPressed = false;
    },

    onTouchMove(event) {
      const touch = this.getTouch(event);
      if (!touch || !this._touch) return;
      const currentX = Number(touch.clientX || 0);
      const currentY = Number(touch.clientY || 0);
      const dx = currentX - this._touch.startX;
      const dy = currentY - this._touch.startY;
      if (!this._touch.dragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      this._touch.dragging = true;
      const now = Date.now();
      if (now - Number(this._lastMoveAt || 0) < FRAME_MS) return;
      this._lastMoveAt = now;
      const policy = floatService.getRoutePolicy(this.currentRoute());
      const bounds = this.getBounds(policy);
      const next = this.clampPosition({
        x: this._touch.originX + dx,
        y: this._touch.originY + dy,
      }, bounds);
      this.setData({
        moving: true,
        x: Math.round(next.x),
        y: Math.round(next.y),
      });
    },

    onTouchEnd() {
      if (!this._touch) return;
      const dragging = this._touch.dragging === true;
      this._touch = null;
      if (!dragging) {
        this.setData({ moving: false });
        return;
      }
      const policy = floatService.getRoutePolicy(this.currentRoute());
      const bounds = this.getBounds(policy);
      const currentX = Number(this.data.x || 0);
      const snapX = currentX + FLOAT_SIZE / 2 < bounds.width / 2 ? bounds.minX : bounds.maxX;
      const next = this.clampPosition({ x: snapX, y: this.data.y }, bounds);
      floatService.savePosition(next);
      this._ignoreTapUntil = Date.now() + 260;
      this.setData({
        moving: false,
        x: Math.round(next.x),
        y: Math.round(next.y),
      });
    },

    onTap() {
      if (Date.now() < Number(this._ignoreTapUntil || 0) || this._longPressed) return;
      this.openAssistant();
    },

    onLongPress() {
      this._longPressed = true;
      wx.showActionSheet({
        itemList: ["打开小佛AI", "隐藏本页", "关闭浮窗"],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.openAssistant();
          } else if (res.tapIndex === 1) {
            floatService.setRouteHidden(this.currentRoute(), true);
            this.setData({ visible: false });
            wx.showToast({ title: "已在本页隐藏", icon: "none" });
          } else if (res.tapIndex === 2) {
            floatService.setEnabled(false);
            this.setData({ visible: false });
            wx.showToast({ title: "可在设置或小佛页重新开启", icon: "none" });
          }
        },
        complete: () => {
          setTimeout(() => {
            this._longPressed = false;
          }, 260);
        },
      });
    },

    openAssistant() {
      floatService.savePendingContext(this.properties.context || {});
      wx.navigateTo({
        url: "/pages/ai-assistant/ai-assistant?from=float",
        fail: () => {
          wx.showToast({ title: "暂时无法打开小佛AI", icon: "none" });
        },
      });
    },

    onLogoError() {
      if (this.data.logoReady) this.setData({ logoReady: false });
    },
  },
});
