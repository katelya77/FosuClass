Component({
  properties: {
    currentWeek: {
      type: Number,
      value: 1,
    },
    totalWeeks: {
      type: Number,
      value: 20,
    },
    weekLabel: {
      type: String,
      value: "",
    },
    weekOptions: {
      type: Array,
      value: [],
    },
  },

  data: {
    pickerVisible: false,
    scrollToId: "",
  },

  pageLifetimes: {
    hide() {
      this.closePicker();
    },
  },

  methods: {
    emitChange(type, week) {
      this.triggerEvent("change", {
        type,
        week,
      });
    },
    prevWeek() {
      if (this.data.currentWeek <= 1) return;
      this.emitChange("prev", this.data.currentWeek - 1);
    },
    nextWeek() {
      if (this.data.currentWeek >= this.data.totalWeeks) return;
      this.emitChange("next", this.data.currentWeek + 1);
    },
    backToCurrent() {
      this.closePicker();
      this.emitChange("current", this.data.currentWeek);
    },
    openPicker() {
      if (this.data.pickerVisible) return;
      this.setData({
        pickerVisible: true,
        scrollToId: `week-option-${this.data.currentWeek}`,
      });
      this.triggerEvent("modalchange", { visible: true });
    },
    closePicker() {
      if (!this.data.pickerVisible) return;
      this.setData({ pickerVisible: false });
      this.triggerEvent("modalchange", { visible: false });
    },
    selectWeek(event) {
      const week = Number(event.currentTarget.dataset.week);
      if (!Number.isInteger(week) || week < 1 || week > this.data.totalWeeks) return;
      this.closePicker();
      this.emitChange("select", week);
    },
    noop() {},
  },
});
