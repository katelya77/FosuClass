Component({
  properties: {
    visible: { type: Boolean, value: false },
    conversations: { type: Array, value: [] },
  },
  data: {
    menuConversationId: "",
  },
  observers: {
    visible(value) {
      if (!value) this.setData({ menuConversationId: "" });
    },
  },
  methods: {
    onClose() {
      this.setData({ menuConversationId: "" });
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
