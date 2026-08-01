Component({
  properties: {
    visible: { type: Boolean, value: false },
    memoryStatusText: { type: String, value: "仅保存在本机" },
    privacyStatusText: { type: String, value: "默认不使用课表摘要" },
    floatEnabled: { type: Boolean, value: true },
    diagnosticsVisible: { type: Boolean, value: false },
  },
  methods: {
    onClose() { this.triggerEvent("close"); },
    onConversations() { this.triggerEvent("conversations"); },
    onMemory() { this.triggerEvent("memory"); },
    onPrivacy() { this.triggerEvent("privacy"); },
    onCapability() { this.triggerEvent("capability"); },
    onPrivacyHelp() { this.triggerEvent("privacyhelp"); },
    onDiagnostics() { this.triggerEvent("diagnostics"); },
    onClear() { this.triggerEvent("clear"); },
    onFloatChange(event) {
      this.triggerEvent("floatchange", { value: event.detail && event.detail.value === true });
    },
  },
});
