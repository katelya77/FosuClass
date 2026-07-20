Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: "local_only" },
  },
  methods: {
    onClose() {
      this.triggerEvent("close");
    },
    onSelectMode(event) {
      const mode = event.currentTarget.dataset.mode;
      this.triggerEvent("change", { mode });
    },
    onClearLocal() {
      this.triggerEvent("clearlocal");
    },
    onClearCurrent() {
      this.triggerEvent("clearcurrent");
    },
    onClearAll() {
      this.triggerEvent("clearall");
    },
  },
});

