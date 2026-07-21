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
    onOverflow(event) {
      this.triggerEvent("overflow", {
        cardKey: event.currentTarget.dataset.cardKey,
      });
    },
  },
});
