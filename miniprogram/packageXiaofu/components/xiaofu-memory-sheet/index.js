Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: "local_only" },
  },
  data: {
    privacyExpanded: false,
  },
  observers: {
    visible(value) {
      if (!value) this.setData({ privacyExpanded: false });
    },
  },
  methods: {
    onClose() {
      this.setData({ privacyExpanded: false });
      this.triggerEvent("close");
    },
    onSelectMode(event) {
      const mode = event.currentTarget.dataset.mode;
      this.triggerEvent("change", { mode });
    },
    onTogglePrivacyDetail() {
      this.setData({ privacyExpanded: !this.data.privacyExpanded });
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
