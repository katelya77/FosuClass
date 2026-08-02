Component({
  properties: {
    visible: { type: Boolean, value: false },
    running: { type: Boolean, value: false },
    report: { type: Object, value: null },
    envVersion: { type: String, value: "trial" },
    apiHostname: { type: String, value: "" },
  },
  methods: {
    onClose() { this.triggerEvent("close"); },
    onRun() { this.triggerEvent("run"); },
    onCopy() { this.triggerEvent("copy"); },
  },
});
