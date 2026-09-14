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
      this.emitChange("current", this.data.currentWeek);
    },
  },
});
