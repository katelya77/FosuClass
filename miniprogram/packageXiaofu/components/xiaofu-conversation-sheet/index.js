Component({
  properties: {
    visible: { type: Boolean, value: false },
    conversations: { type: Array, value: [] },
  },
  data: {
    searchQuery: "",
    filteredConversations: [],
    openSwipeId: "",
  },
  observers: {
    visible(value) {
      if (!value) this.setData({ openSwipeId: "", searchQuery: "" });
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
      this.setData({ openSwipeId: "", searchQuery: "" });
      this.triggerEvent("close");
    },
    onCreate() {
      this.triggerEvent("create");
    },
    onSelect(event) {
      this.setData({ openSwipeId: "" });
      this.triggerEvent("select", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onTouchStart(event) {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch) return;
      this._touchStartX = touch.clientX;
      this._touchStartY = touch.clientY;
      this._touchId = event.currentTarget.dataset.conversationId;
    },
    onTouchEnd(event) {
      const touch = event.changedTouches && event.changedTouches[0];
      if (!touch || !this._touchId) return;
      const dx = touch.clientX - Number(this._touchStartX || 0);
      const dy = touch.clientY - Number(this._touchStartY || 0);
      if (Math.abs(dx) < 36 || Math.abs(dx) < Math.abs(dy)) return;
      if (dx < 0) {
        this.setData({ openSwipeId: this._touchId });
      } else if (this.data.openSwipeId === this._touchId) {
        this.setData({ openSwipeId: "" });
      }
    },
    closeSwipe() {
      if (this.data.openSwipeId) this.setData({ openSwipeId: "" });
    },
    onPin(event) {
      this.setData({ openSwipeId: "" });
      this.triggerEvent("pin", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onClear(event) {
      this.setData({ openSwipeId: "" });
      this.triggerEvent("clear", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onDelete(event) {
      this.setData({ openSwipeId: "" });
      this.triggerEvent("delete", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onRename(event) {
      this.setData({ openSwipeId: "" });
      this.triggerEvent("rename", { conversationId: event.currentTarget.dataset.conversationId });
    },
  },
});
