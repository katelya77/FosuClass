const service = require("../../services/noticeReactionService");
const { CATALOG, formatCount } = require("../../utils/noticeReactions");
function view(summary) {
  const source = summary || {};
  const mine = source.myReaction || "";
  const items = (source.items || []).filter((item) => item.count > 0).map((item) => Object.assign({}, item, { selected: item.id === mine, countText: formatCount(item.count) }));
  const allowed = source.allowedIds || [];
  return {
    summary: source, items, topItems: items.slice(0, 3), totalText: formatCount(source.total),
    choices: CATALOG.filter((item) => allowed.indexOf(item.id) >= 0).map((item) => Object.assign({}, item, { selected: item.id === mine })),
  };
}
Component({
  properties: {
    notice: { type: Object, value: null, observer(notice) {
      if (!notice) return;
      if (this._noticeId === notice.id) {
        if (this.data.compact) this.setData(view(notice.reactions));
        else if (this._noticeVersion !== notice.version && this._attached) this.refresh();
        this._noticeVersion = notice.version;
        return;
      }
      this._noticeId = notice.id;
      this._noticeVersion = notice.version;
      this._generation = (this._generation || 0) + 1;
      this.setData(Object.assign({ pickerOpen: false, busy: false, error: "" }, view(notice.reactions)));
      if (this._attached && !this.data.compact) this.refresh();
    } },
    compact: { type: Boolean, value: false },
  },
  data: { summary: {}, items: [], topItems: [], choices: [], totalText: "0", pickerOpen: false, busy: false, error: "", pulseId: "" },
  lifetimes: {
    attached() { this._attached = true; if (!this.data.compact) this.refresh(); },
    detached() { this._attached = false; this._generation = (this._generation || 0) + 1; clearTimeout(this._pulseTimer); },
  },
  methods: {
    noop() {},
    refresh(options) {
      const notice = this.data.notice;
      if (!notice || String(notice.id).indexOf("temp_") === 0) return;
      const generation = this._generation;
      service.get(notice.id).then((summary) => {
        if (!this._attached || generation !== this._generation || this.data.busy) return;
        const keepError = options && options.failedTarget !== undefined && summary.myReaction !== options.failedTarget;
        this.setData(Object.assign({ error: keepError ? "回应未发送成功，请重新点选表情" : "" }, view(summary)));
        this.triggerEvent("change", { noticeId: notice.id, summary });
      }).catch(() => { if (this._attached && generation === this._generation) this.setData({ error: "表情暂未刷新，点此重试" }); });
    },
    openPicker() {
      if (this.data.compact) { this.triggerEvent("openpicker"); return; }
      if (!this.data.summary.enabled || this.data.busy) return;
      this.setData({ pickerOpen: !this.data.pickerOpen, error: "" });
      if (typeof wx !== "undefined" && wx.vibrateShort) wx.vibrateShort({ type: "light", fail() {} });
    },
    closePicker() { this.setData({ pickerOpen: false }); },
    select(event) {
      if (this.data.busy || !this.data.notice) return;
      const id = event.currentTarget.dataset.id;
      const before = this.data.summary;
      if (!before.enabled && id !== before.myReaction) return;
      const target = before.myReaction === id ? "" : id;
      const items = (before.items || []).map((item) => Object.assign({}, item));
      if (before.myReaction) { const old = items.find((item) => item.id === before.myReaction); if (old) old.count -= 1; }
      if (target) {
        const existing = items.find((item) => item.id === target);
        if (existing) existing.count += 1;
        else { const entry = CATALOG.find((item) => item.id === target); if (!entry) return; items.push(Object.assign({ count: 1 }, entry)); }
      }
      const optimistic = Object.assign({}, before, { items: items.filter((item) => item.count > 0).sort((a, b) => b.count - a.count), myReaction: target, total: (before.total || 0) + (target ? 1 : 0) - (before.myReaction ? 1 : 0) });
      const generation = this._generation, noticeId = this.data.notice.id;
      this.setData(Object.assign({ busy: true, pickerOpen: false, error: "", pulseId: target }, view(optimistic)));
      service.set(noticeId, target).then((summary) => {
        if (!this._attached || generation !== this._generation) return;
        this.setData(Object.assign({ busy: false }, view(summary)));
        this.triggerEvent("change", { noticeId, summary });
        if (typeof wx !== "undefined" && wx.vibrateShort) wx.vibrateShort({ type: "light", fail() {} });
      }).catch((error) => {
        if (!this._attached || generation !== this._generation) return;
        this.setData(Object.assign({ busy: false, error: error.message || "发送失败，点此重试", pulseId: "" }, view(before)));
        // A lost acknowledgement can still mean the server accepted the PUT.
        this.refresh({ failedTarget: target });
      });
      clearTimeout(this._pulseTimer);
      this._pulseTimer = setTimeout(() => { if (this._attached) this.setData({ pulseId: "" }); }, 420);
    },
    retry() { this.refresh(); },
  },
});
