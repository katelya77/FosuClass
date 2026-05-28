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
      this.emitChange("prev", Math.max(1, this.data.currentWeek - 1));
    },
    nextWeek() {
      this.emitChange("next", Math.min(this.data.totalWeeks, this.data.currentWeek + 1));
    },
    backToCurrent() {
      this.emitChange("current", this.data.currentWeek);
    },
  },
});
