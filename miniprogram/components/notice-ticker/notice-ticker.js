const appConfigService = require("../../services/appConfigService");

const PRIORITY_SCORE = {
  urgent: 3,
  important: 2,
  normal: 1,
};

function pageMatches(notice, pageKey) {
  const target = notice.targetPage || "all";
  return target === "all" || target === pageKey;
}

function isTickerNotice(notice, pageKey) {
  return notice &&
    notice.enabled !== false &&
    notice.displayMode === "ticker" &&
    pageMatches(notice, pageKey) &&
    appConfigService.shouldShowNotice(notice);
}

function buildDisplayItem(notice) {
  const title = notice.title || "";
  const text = title;
  return Object.assign({}, notice, {
    tickerText: text,
    shouldScroll: text.length > 18,
    dateText: notice.startAt ? String(notice.startAt).slice(0, 10) :
      (notice.createdAt ? String(notice.createdAt).slice(0, 10) : ""),
    validUntilText: notice.endAt ? String(notice.endAt).slice(0, 10) : "",
    typeLabel: notice.typeLabel || ({ info: "校园通知", warning: "提醒", success: "好消息", update: "服务更新", maintenance: "维护通知" }[notice.type] || "校园通知"),
  });
}

function normalizeNotices(value) {
  return Array.isArray(value) ? value : [];
}

Component({
  properties: {
    notices: {
      type: null,
      value: [],
      observer(value) {
        if (!Array.isArray(value)) {
          this.setData({ notices: [] }, () => this.updateVisibleNotices());
          return;
        }
        this.updateVisibleNotices();
      },
    },
    pageKey: {
      type: String,
      value: "home",
      observer() {
        this.updateVisibleNotices();
      },
    },
    maxCount: {
      type: Number,
      value: 1,
      observer() {
        this.updateVisibleNotices();
      },
    },
    safeAreaTop: {
      type: Number,
      value: 0,
    },
  },

  data: {
    visibleNotices: [],
    currentNotice: null,
    currentIndex: 0,
    detailVisible: false,
    panelBodyHeight: "auto",
    panelBodyScroll: false,
  },

  lifetimes: {
    attached() {
      this.updateVisibleNotices();
      this._rotationTimer = setInterval(() => this.rotateNotice(), 6500);
    },
    detached() {
      if (this._rotationTimer) clearInterval(this._rotationTimer);
      this._rotationTimer = null;
    },
  },
  pageLifetimes: {
    resize() { this.measureDetail(); },
  },

  methods: {
    updateVisibleNotices() {
      const pageKey = this.data.pageKey || "home";
      const maxCount = Math.max(1, this.data.maxCount || 1);
      const visibleNotices = normalizeNotices(this.data.notices)
        .filter((notice) => isTickerNotice(notice, pageKey))
        .sort((left, right) => {
          const priorityDiff = (PRIORITY_SCORE[right.priority] || 0) - (PRIORITY_SCORE[left.priority] || 0);
          if (priorityDiff !== 0) return priorityDiff;
          return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
        })
        .slice(0, maxCount)
        .map(buildDisplayItem);

      const previousId = this.data.currentNotice && this.data.currentNotice.id;
      const currentIndex = this.data.detailVisible ? Math.max(0, visibleNotices.findIndex((notice) => notice.id === previousId)) : 0;
      this.setData({
        visibleNotices,
        currentIndex,
        currentNotice: visibleNotices[currentIndex] || null,
        detailVisible: this.data.detailVisible && visibleNotices.length > 0,
      }, () => this.measureDetail());
    },

    rotateNotice() {
      const notices = this.data.visibleNotices || [];
      if (this.data.detailVisible || notices.length < 2) return;
      const currentIndex = (this.data.currentIndex + 1) % notices.length;
      this.setData({ currentIndex, currentNotice: notices[currentIndex] });
    },

    openNoticeDetail() {
      if (!this.data.currentNotice) return;
      this.setData({ detailVisible: true, panelBodyHeight: "auto", panelBodyScroll: false }, () => this.measureDetail());
      this.triggerEvent("open", { notice: this.data.currentNotice });
    },

    closeNoticeDetail() {
      this.setData({ detailVisible: false });
    },

    measureDetail() {
      if (!this.data.detailVisible) return;
      const generation = this._layoutGeneration = (this._layoutGeneration || 0) + 1;
      this.createSelectorQuery()
        .select(".notice-ticker-panel-body").boundingClientRect()
        .select(".notice-ticker-panel-head").boundingClientRect()
        .select(".notice-ticker-panel-footer").boundingClientRect()
        .exec((rects) => {
          if (!this.data.detailVisible || generation !== this._layoutGeneration || !rects || rects.some((rect) => !rect)) return;
          const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
          const scale = windowInfo.windowWidth / 750;
          // Reserve the mask margins, panel padding, heading gap and fixed footer.
          const available = Math.max(0, windowInfo.windowHeight - 142 * scale - rects[1].height - rects[2].height);
          const contentHeight = Math.ceil(rects[0].height);
          this.setData({
            panelBodyHeight: Math.min(contentHeight, Math.floor(available)) + "px",
            panelBodyScroll: contentHeight > available,
          });
        });
    },

    openNoticePicker() {
      if (!this.data.currentNotice) return;
      this.setData({ detailVisible: true }, () => {
        const reactions = this.selectComponent("#noticeDetailReactions");
        if (reactions) reactions.openPicker();
        this.measureDetail();
      });
    },

    onReactionChange(event) {
      const result = event.detail;
      const visibleNotices = this.data.visibleNotices.map((notice) => notice.id === result.noticeId
        ? Object.assign({}, notice, { reactions: result.summary }) : notice);
      const currentNotice = visibleNotices.find((notice) => notice.id === this.data.currentNotice.id);
      this.setData({ visibleNotices, currentNotice }, () => this.measureDetail());
    },

    noop() {},

    dismissNotice() {
      const notice = this.data.currentNotice;
      if (!notice) return;
      appConfigService.dismissNotice(notice);
      this.triggerEvent("dismiss", { notice });
      this.setData({ detailVisible: false }, () => {
        this.updateVisibleNotices();
      });
    },
  },
});
