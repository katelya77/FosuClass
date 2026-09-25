const assert = require("assert");
const { buildColumns, buildDefaultDays, layoutSize } = require("../miniprogram/components/schedule-preview-grid/index.js");

function cell(weekday, courseName, conflict) {
  return {
    weekday,
    courseName,
    startSection: 1,
    endSection: 2,
    sections: [1, 2],
    conflict: Boolean(conflict),
    selected: true,
    weeks: [1],
  };
}

function run() {
  assert.strictEqual(buildDefaultDays().length, 5);
  assert.strictEqual(buildDefaultDays(7).length, 7);
  assert.deepStrictEqual(buildDefaultDays(7).map((day) => day.label), ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);

  const grid = {
    week: 3,
    days: buildDefaultDays(7),
    sections: Array.from({ length: 14 }, (_, index) => ({ section: index + 1 })),
    cells: [cell(6, "周六课"), cell(7, "周日课"), cell(6, "冲突课", true)],
  };
  const columns = buildColumns(grid, 66, 96, 7);
  assert.strictEqual(columns.length, 7);
  assert.strictEqual(columns[5].weekday, 6);
  assert.strictEqual(columns[6].weekday, 7);
  assert.ok(columns[5].courses.some((course) => course.courseName === "周六课"));
  assert.ok(columns[6].courses.some((course) => course.courseName === "周日课"));
  assert.strictEqual(columns[5].courses.length, 2);
  assert.ok(columns[5].courses.some((course) => course.badgeText === "冲突"));
  const empty = buildColumns({ days: buildDefaultDays(7), cells: [], week: 8 }, 66, 96, 7);
  assert.strictEqual(empty.length, 7);
  assert.strictEqual(empty[5].courses.length, 0);
  assert.strictEqual(empty[6].courses.length, 0);
  const switched = buildColumns(Object.assign({}, grid, { week: 12 }), 66, 96, 7);
  assert.strictEqual(switched.length, 7);
  const size = layoutSize(columns.length, 96, 66, 14);
  assert.strictEqual(size.dayTrackWidth, 96 * 7);
  assert.strictEqual(size.gridWidth, 64 + 96 * 7);
  assert.strictEqual(size.scheduleHeight, 66 * 14);
  console.log("campus-sync-seven-day-preview PASS");
}

run();
