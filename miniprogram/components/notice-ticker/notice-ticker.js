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

      this.setData({
        visibleNotices,
        currentIndex: 0,
        currentNotice: visibleNotices[0] || null,
        detailVisible: this.data.detailVisible && visibleNotices.length > 0,
      });
    },

    rotateNotice() {
      const notices = this.data.visibleNotices || [];
      if (this.data.detailVisible || notices.length < 2) return;
      const currentIndex = (this.data.currentIndex + 1) % notices.length;
      this.setData({ currentIndex, currentNotice: notices[currentIndex] });
    },

    openNoticeDetail() {
      if (!this.data.currentNotice) return;
      this.setData({ detailVisible: true });
      this.triggerEvent("open", { notice: this.data.currentNotice });
    },

    closeNoticeDetail() {
      this.setData({ detailVisible: false });
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
