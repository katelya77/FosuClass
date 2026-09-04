Component({
  properties: {
    visible: { type: Boolean, value: false },
    items: { type: Array, value: [] },
    hint: { type: String, value: "" },
    publicMode: { type: Boolean, value: true },
  },
  methods: {
    onSelect(event) {
      const index = Number(event && event.currentTarget && event.currentTarget.dataset.index);
      const command = (this.data.items || [])[index];
      if (!command) return;
      this.triggerEvent("select", { command });
    },
  },
});
