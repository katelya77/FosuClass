Component({
  properties: {
    visible: { type: Boolean, value: false },
    mode: { type: String, value: "local_only" },
    preferences: { type: Array, value: [] },
    preferencesLoading: { type: Boolean, value: false },
    autoMemoryEnabled: { type: Boolean, value: true },
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
    onToggleAutoMemory() {
      this.triggerEvent("toggleautomemory", {
        autoMemoryEnabled: !this.data.autoMemoryEnabled,
      });
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
    onDeletePreference(event) {
      const key = event.currentTarget.dataset.key || "";
      if (key) this.triggerEvent("deletepreference", { key });
    },
    onEditPreference(event) {
      const key = event.currentTarget.dataset.key || "";
      const value = event.currentTarget.dataset.value;
      if (!key) return;
      this.triggerEvent("editpreference", { key, value });
    },
  },
});
