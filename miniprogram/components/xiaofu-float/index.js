const floatService = require("../../services/xiaofuFloatService");
const courseReminderClient = require("../../services/courseReminderClient");
const securitySessionService = require("../../services/securitySessionService");
const assistantBrand = require("../../config/assistantBrand");

const FLOAT_SIZE = 58;
const EDGE_MARGIN = 6;
const TOP_SAFE_GAP = 0;
const CAPSULE_GAP = 10;
const DRAG_THRESHOLD = 11;
const FRAME_MS = 16;
const TAP_DEDUPE_MS = 360;

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

function getMenuButtonRect() {
  try {
    if (wx.getMenuButtonBoundingClientRect) return wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    // No capsule information outside real WeChat runtime.
  }
  return null;
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
    hintEyebrow: "",
    hintText: "",
    hintSide: "left",
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
      const bottomAvoid = Math.max(10, Number(policy && policy.bottomAvoidPx || 18)) +
        safeBottomGap +
        Number(this.properties.bottomOffset || 0);
      const menuButton = getMenuButtonRect();
      return {
        minX: EDGE_MARGIN,
        maxX: Math.max(EDGE_MARGIN, width - FLOAT_SIZE - EDGE_MARGIN),
        minY: Math.max(EDGE_MARGIN, Math.min(safeTop + TOP_SAFE_GAP, EDGE_MARGIN)),
        maxY: Math.max(EDGE_MARGIN, height - FLOAT_SIZE - bottomAvoid),
        menuButton,
        width,
        height,
      };
    },

    avoidCapsule(position, bounds) {
      const rect = bounds && bounds.menuButton;
      if (!rect) return position;
      const left = Number(rect.left);
      const bottom = Number(rect.bottom);
      if (!Number.isFinite(left) || !Number.isFinite(bottom)) return position;
      const x = Number(position && position.x);
      const y = Number(position && position.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return position;
      const nearRightEdge = x + FLOAT_SIZE > left - CAPSULE_GAP;
      const overlapsCapsuleY = y < bottom + CAPSULE_GAP;
      if (!nearRightEdge || !overlapsCapsuleY) return position;
      return Object.assign({}, position, {
        y: Math.min(bounds.maxY, Math.max(bounds.minY, bottom + CAPSULE_GAP)),
      });
    },

    clampPosition(position, bounds) {
      const source = position || {};
      const x = Number(source.x);
      const y = Number(source.y);
      const clamped = {
        x: Math.min(bounds.maxX, Math.max(bounds.minX, Number.isFinite(x) ? x : bounds.maxX)),
        y: Math.min(bounds.maxY, Math.max(bounds.minY, Number.isFinite(y) ? y : bounds.maxY - 18)),
      };
      return this.avoidCapsule(clamped, bounds);
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
      let insight = floatService.getProactiveInsight();
      try {
        const aiAssistantService = require("../../services/aiAssistantService");
        const workspace = aiAssistantService.buildProactiveWorkspace(aiAssistantService.buildClientContext({}));
        if (workspace && workspace.insight) insight = floatService.setProactiveInsight(workspace.insight);
      } catch (error) {
        // Keep the latest short-lived, sanitized insight when local context is unavailable.
      }
      if (insight && floatService.isProactiveInsightDismissed(insight)) insight = null;
      this._currentInsight = insight;
      this.setData({
        visible: true,
        dimmed: policy.dimmed,
        x: Math.round(position.x),
        y: Math.round(position.y),
        hintEyebrow: insight && insight.eyebrow || "",
        hintText: insight && insight.title || "",
        hintSide: position.x + FLOAT_SIZE / 2 < bounds.width / 2 ? "right" : "left",
      });
      this.refreshInAppReminderHint();
    },

    refreshInAppReminderHint() {
      const now = Date.now();
      if (this._inAppReminderCheckPending
        || now - Number(this._lastInAppReminderCheckAt || 0) < 30000
        || !securitySessionService.isSessionAvailable({ refreshSkewMs: 0 })) return;
      this._inAppReminderCheckPending = true;
      this._lastInAppReminderCheckAt = now;
      courseReminderClient.listInAppEvents(1).then((result) => {
        if (!result || result.success !== true || !Array.isArray(result.items) || !result.items.length) return;
        const event = result.items[0] || {};
        const occurrence = event.occurrence && typeof event.occurrence === "object" ? event.occurrence : {};
        const courseName = String(occurrence.courseName || "课程提醒").replace(/[\r\n]+/g, " ").slice(0, 32);
        const startTime = String(occurrence.startTime || "").slice(0, 8);
        const insight = floatService.setProactiveInsight({
          kind: event.kind === "schedule_change" ? "schedule_change" : "course_start",
          eyebrow: event.kind === "schedule_change" ? "课表变化提醒" : "应用内提醒",
          title: [courseName, startTime].filter(Boolean).join(" · "),
          detail: String(event.id || "").slice(0, 80),
          actionUrl: "/pages/today/today",
        });
        if (!insight || floatService.isProactiveInsightDismissed(insight)) return;
        this._currentInsight = insight;
        this.setData({ hintEyebrow: insight.eyebrow, hintText: insight.title });
      }).catch(() => {
        // 浮窗不承担在线决策；收件箱不可用时保留本机主动洞察。
      }).finally(() => {
        this._inAppReminderCheckPending = false;
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
      this._tapOpenedAt = 0;
    },

    onTouchMove(event) {
      const touch = this.getTouch(event);
      if (!touch || !this._touch) return;
      const currentX = Number(touch.clientX || 0);
      const currentY = Number(touch.clientY || 0);
      this._touch.lastX = currentX;
      this._touch.lastY = currentY;
      const dx = currentX - this._touch.startX;
      const dy = currentY - this._touch.startY;
      if (!this._touch.dragging && Math.sqrt(dx * dx + dy * dy) < DRAG_THRESHOLD) return;
      if (this._longPressed) return;
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
        hintSide: next.x + FLOAT_SIZE / 2 < bounds.width / 2 ? "right" : "left",
      });
    },

    onTouchEnd(event) {
      if (!this._touch) return;
      const dragging = this._touch.dragging === true;
      const touch = this.getTouch(event);
      if (touch) {
        this._touch.lastX = Number(touch.clientX || this._touch.lastX || 0);
        this._touch.lastY = Number(touch.clientY || this._touch.lastY || 0);
      }
      const touchState = this._touch;
      this._touch = null;
      if (!dragging) {
        this.setData({ moving: false });
        if (!this._longPressed && Date.now() >= Number(this._ignoreTapUntil || 0)) {
          this._tapOpenedAt = Date.now();
          this.openAssistant();
        }
        return;
      }
      const policy = floatService.getRoutePolicy(this.currentRoute());
      const bounds = this.getBounds(policy);
      const dx = Number(touchState.lastX || touchState.startX || 0) - Number(touchState.startX || 0);
      const dy = Number(touchState.lastY || touchState.startY || 0) - Number(touchState.startY || 0);
      const settled = this.clampPosition({
        x: Number(touchState.originX || 0) + dx,
        y: Number(touchState.originY || 0) + dy,
      }, bounds);
      const currentX = Number.isFinite(settled.x) ? settled.x : Number(this.data.x || 0);
      const snapX = currentX + FLOAT_SIZE / 2 < bounds.width / 2 ? bounds.minX : bounds.maxX;
      const next = this.clampPosition({ x: snapX, y: settled.y }, bounds);
      floatService.savePosition(next);
      this._ignoreTapUntil = Date.now() + 260;
      this.setData({
        moving: false,
        x: Math.round(next.x),
        y: Math.round(next.y),
        hintSide: next.x + FLOAT_SIZE / 2 < bounds.width / 2 ? "right" : "left",
      });
    },

    onTouchCancel() {
      this._touch = null;
      this._ignoreTapUntil = Date.now() + 260;
      this.setData({ moving: false });
    },

    onTap() {
      if (Date.now() < Number(this._ignoreTapUntil || 0) || this._longPressed) return;
      if (Date.now() - Number(this._tapOpenedAt || 0) < TAP_DEDUPE_MS) return;
      this._tapOpenedAt = Date.now();
      this.openAssistant();
    },

    onHintTap() {
      const insight = this._currentInsight || {
        eyebrow: this.data.hintEyebrow,
        title: this.data.hintText,
      };
      floatService.dismissProactiveInsight(insight);
      this._currentInsight = null;
      this.setData({ hintEyebrow: "", hintText: "" });
    },

    onLongPress() {
      this._longPressed = true;
      wx.showActionSheet({
        itemList: [`打开${assistantBrand.assistantName}`, "隐藏本页", "关闭浮窗"],
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
            wx.showToast({ title: `可在设置或${assistantBrand.assistantName}页面重新开启`, icon: "none" });
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
      if (/pages\/ai-assistant\/ai-assistant/.test(this.currentRoute())) return;
      floatService.savePendingContext(this.properties.context || {});
      wx.navigateTo({
        url: "/packageXiaofu/pages/ai-assistant/ai-assistant?from=float",
        fail: () => {
          wx.redirectTo({
            url: "/packageXiaofu/pages/ai-assistant/ai-assistant?from=float",
            fail: () => wx.showToast({ title: `暂时无法打开${assistantBrand.assistantName}`, icon: "none" }),
          });
        },
      });
    },

    onLogoError() {
      if (this.data.logoReady) this.setData({ logoReady: false });
    },
  },
});
