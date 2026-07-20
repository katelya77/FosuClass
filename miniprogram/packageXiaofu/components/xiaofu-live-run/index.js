Component({
  properties: {
    visible: { type: Boolean, value: false },
    events: { type: Array, value: [] },
    statusText: { type: String, value: "正在处理" },
    expanded: { type: Boolean, value: false },
  },
  data: {
    displayRows: [],
    canExpand: false,
  },
  observers: {
    "events, statusText, expanded": function observers() {
      this.rebuild();
    },
  },
  methods: {
    rebuild() {
      const events = Array.isArray(this.data.events) ? this.data.events : [];
      const completed = [];
      let current = null;
      events.forEach((event) => {
        const row = {
          key: String(event.sequence || event.type || completed.length),
          label: String(event.label || event.type || "").slice(0, 80),
          type: String(event.type || ""),
          done: /completed|failed|cancelled|degraded|verifying|composing|selected|resolved|sanitized|accepted/.test(String(event.type || ""))
            && !/started/.test(String(event.type || "")),
          active: false,
        };
        if (/started|accepted|selected|resolved|sanitized|composing|verifying/.test(row.type)) {
          current = row;
        } else {
          completed.push(Object.assign({}, row, { done: true }));
        }
      });
      if (!current && this.data.statusText) {
        current = {
          key: "current",
          label: this.data.statusText,
          type: "current",
          done: false,
          active: true,
        };
      } else if (current) {
        current.active = true;
      }
      const recentDone = completed.filter((item) => item.label).slice(-2);
      const rows = recentDone.concat(current ? [current] : []).slice(-3);
      this.setData({
        displayRows: rows,
        canExpand: events.length > 3,
      });
    },
    onToggleExpand() {
      this.triggerEvent("toggleexpand", { expanded: !this.data.expanded });
    },
  },
});
