const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildWeekPickerOptions } = require("../miniprogram/utils/weekPicker");

const calendar = {
  termConfig: { term: "2026-2027-1", termStartDate: "2026-09-07", totalWeeks: 20 },
  weeks: [],
};
const options = buildWeekPickerOptions(calendar);
assert.equal(options.length, 20);
assert.deepEqual(options.map((item) => item.week), Array.from({ length: 20 }, (_, index) => index + 1));
assert.match(options[1].rangeText, /9月14日/);

let definition;
global.Component = (value) => { definition = value; };
require("../miniprogram/components/week-switcher/index");
const emitted = [];
const instance = {
  data: { currentWeek: 2, totalWeeks: 20, pickerVisible: false },
  setData(patch) { Object.assign(this.data, patch); },
  triggerEvent(name, detail) { emitted.push({ name, detail }); },
};
Object.assign(instance, definition.methods);
instance.openPicker();
assert.equal(instance.data.pickerVisible, true);
assert.equal(instance.data.scrollToId, "week-option-2");
assert.deepEqual(emitted.pop(), { name: "modalchange", detail: { visible: true } });
instance.selectWeek({ currentTarget: { dataset: { week: 18 } } });
assert.deepEqual(emitted.pop(), { name: "change", detail: { type: "select", week: 18 } });
assert.deepEqual(emitted.pop(), { name: "modalchange", detail: { visible: false } });
assert.equal(instance.data.pickerVisible, false);
instance.backToCurrent();
assert.deepEqual(emitted.pop(), { name: "change", detail: { type: "current", week: 2 } });
instance.openPicker();
assert.deepEqual(emitted.pop(), { name: "modalchange", detail: { visible: true } });
definition.pageLifetimes.hide.call(instance);
assert.equal(instance.data.pickerVisible, false);
assert.deepEqual(emitted.pop(), { name: "modalchange", detail: { visible: false } });

const root = path.resolve(__dirname, "..");
for (const page of ["index/index", "schedule-view/schedule-view", "custom-courses/custom-courses", "today/today"]) {
  const wxml = fs.readFileSync(path.join(root, "miniprogram/pages", `${page}.wxml`), "utf8");
  assert.match(wxml, /^<page-meta page-style="\{\{[^\n]*overflow: hidden;/);
  if (page === "index/index" || page === "schedule-view/schedule-view") {
    assert.match(wxml, /bind:modalchange="onWeekPickerModalChange"/);
  }
}
for (const component of ["week-switcher/index", "course-detail-popup/index"]) {
  const wxml = fs.readFileSync(path.join(root, "miniprogram/components", `${component}.wxml`), "utf8");
  assert.match(wxml, /class="(?:week-picker-mask|popup-mask)"[^>]*catchtouchmove="noop"/);
}
const formWxml = fs.readFileSync(path.join(root, "miniprogram/pages/custom-courses/custom-courses.wxml"), "utf8");
const formWxss = fs.readFileSync(path.join(root, "miniprogram/pages/custom-courses/custom-courses.wxss"), "utf8");
assert.match(formWxml, /class="popup-mask"[^>]*catchtouchmove="noop"/);
assert.match(formWxml, /<scroll-view scroll-y enhanced bounces="\{\{false\}\}" class="form-scroll">/);
assert.match(formWxss, /\.form-scroll\s*\{[^}]*height:\s*52vh;/);
console.log("week picker: passed");
