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
  const content = notice.content || "";
  const text = content ? `${title} · ${content}` : title;
  return Object.assign({}, notice, {
    tickerText: text,
    shouldScroll: text.length > 18,
  });
}

Component({
  properties: {
    notices: {
      type: Array,
      value: [],
      observer() {
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
    detailVisible: false,
  },

  lifetimes: {
    attached() {
      this.updateVisibleNotices();
    },
  },

  methods: {
    updateVisibleNotices() {
      const pageKey = this.data.pageKey || "home";
      const maxCount = Math.max(1, this.data.maxCount || 1);
      const visibleNotices = (this.data.notices || [])
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
        currentNotice: visibleNotices[0] || null,
        detailVisible: this.data.detailVisible && visibleNotices.length > 0,
      });
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
