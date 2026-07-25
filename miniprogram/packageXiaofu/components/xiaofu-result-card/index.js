Component({
  properties: {
    card: { type: Object, value: null },
    messageIndex: { type: Number, value: 0 },
    cardIndex: { type: Number, value: 0 },
  },
  methods: {
    onAction(event) {
      this.triggerEvent("action", {
        messageIndex: this.data.messageIndex,
        cardIndex: this.data.cardIndex,
        actionIndex: event.currentTarget.dataset.actionIndex,
      });
    },
    onItemTap(event) {
      const ds = (event && event.currentTarget && event.currentTarget.dataset) || {};
      if (!ds.tappable || !ds.url) return;
      this.triggerEvent("itemtap", {
        messageIndex: this.data.messageIndex,
        cardIndex: this.data.cardIndex,
        url: String(ds.url || ""),
      });
    },
    onOverflow(event) {
      this.triggerEvent("overflow", {
        cardKey: event.currentTarget.dataset.cardKey,
      });
    },
  },
});
