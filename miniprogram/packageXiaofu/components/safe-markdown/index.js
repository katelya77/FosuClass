const { parseMarkdown, sanitizeLink } = require("../../services/safeMarkdown");

const COLLAPSED_BLOCKS = 12;

Component({
  properties: {
    content: { type: String, value: "" },
    selectable: { type: Boolean, value: true },
  },
  data: {
    visibleBlocks: [],
    expanded: false,
    collapsible: false,
    hiddenCount: 0,
    truncated: false,
  },
  observers: {
    content(value) {
      this.renderMarkdown(value, this.data.expanded);
    },
  },
  methods: {
    renderMarkdown(content, expanded) {
      const document = parseMarkdown(content || "");
      const showAll = expanded === true || !document.collapsible;
      const visibleBlocks = showAll
        ? document.blocks
        : document.blocks.slice(0, COLLAPSED_BLOCKS);
      this._markdownDocument = document;
      this.setData({
        visibleBlocks,
        expanded: showAll && document.collapsible,
        collapsible: document.collapsible,
        hiddenCount: Math.max(0, document.blocks.length - visibleBlocks.length),
        truncated: document.truncated,
      });
    },
    onToggleExpanded() {
      const next = !this.data.expanded;
      this.renderMarkdown(this.data.content, next);
    },
    onCopyCode(event) {
      const index = Number(event.currentTarget.dataset.index);
      const block = this.data.visibleBlocks[index];
      if (!block || block.type !== "code") return;
      wx.setClipboardData({
        data: String(block.text || ""),
        success() {
          wx.showToast({ title: "代码已复制", icon: "none" });
        },
      });
    },
    onCopyLink(event) {
      const href = sanitizeLink(event.currentTarget.dataset.href || "");
      if (!href) {
        wx.showToast({ title: "链接未通过安全校验", icon: "none" });
        return;
      }
      wx.setClipboardData({
        data: href,
        success() {
          wx.showToast({ title: "链接已复制", icon: "none" });
        },
      });
    },
  },
});
