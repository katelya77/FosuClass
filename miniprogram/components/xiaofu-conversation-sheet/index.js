Component({
  properties: {
    visible: { type: Boolean, value: false },
    conversations: { type: Array, value: [] },
  },
  methods: {
    onClose() {
      this.triggerEvent("close");
    },
    onCreate() {
      this.triggerEvent("create");
    },
    onSelect(event) {
      this.triggerEvent("select", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onRename(event) {
      this.triggerEvent("rename", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onClear(event) {
      this.triggerEvent("clear", { conversationId: event.currentTarget.dataset.conversationId });
    },
    onDelete(event) {
      this.triggerEvent("delete", { conversationId: event.currentTarget.dataset.conversationId });
    },
  },
});
