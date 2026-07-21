Component({
  properties: {
    visible: { type: Boolean, value: false },
    conversations: { type: Array, value: [] },
  },
  data: {
    menuConversationId: "",
    searchQuery: "",
    filteredConversations: [],
  },
  observers: {
    visible(value) {
      if (!value) this.setData({ menuConversationId: "", searchQuery: "" });
      this.recompute();
    },
    conversations() {
      this.recompute();
    },
  },
  methods: {
    recompute() {
      const q = String(this.data.searchQuery || "").trim().toLowerCase();
      const source = Array.isArray(this.properties.conversations) ? this.properties.conversations : [];
      const filtered = !q
        ? source.slice()
        : source.filter((item) => {
          const title = String(item.title || "").toLowerCase();
          const preview = String(item.preview || "").toLowerCase();
          return title.includes(q) || preview.includes(q);
        });
      filtered.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0);
      });
      this.setData({ filteredConversations: filtered });
    },
    onSearchInput(event) {
      this.setData({ searchQuery: event.detail.value || "" });
      this.recompute();
    },
    onClose() {
      this.setData({ menuConversationId: "", searchQuery: "" });
      this.triggerEvent("close");
    },
    onCreate() {
      this.triggerEvent("create");
    },
    onSelect(event) {
      this.setData({ menuConversationId: "" });
      this.triggerEvent("select", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onMore(event) {
      const conversationId = event.currentTarget.dataset.conversationId;
      this.setData({
        menuConversationId: this.data.menuConversationId === conversationId ? "" : conversationId,
      });
    },
    onRename(event) {
      this.setData({ menuConversationId: "" });
      this.triggerEvent("rename", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onPin(event) {
      this.setData({ menuConversationId: "" });
      this.triggerEvent("pin", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onClear(event) {
      this.setData({ menuConversationId: "" });
      this.triggerEvent("clear", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onDelete(event) {
      this.setData({ menuConversationId: "" });
      this.triggerEvent("delete", { conversationId: event.currentTarget.dataset.conversationId });
    },
  },
});
