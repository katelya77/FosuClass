const assert = require("assert");

const week = require("../miniprogram/utils/week");
const termConfigService = require("../miniprogram/services/termConfigService");

function run() {
  week.resetRuntimeTermConfig();
  const fallback = week.getRuntimeTermConfig();
  assert.strictEqual(fallback.termStartDate, "");
  assert.strictEqual(week.getTodayTeachingInfo(new Date("2026-06-08T12:00:00+08:00")).termPhase, "unknown");

  week.setRuntimeTermConfig({
    term: "runtime-a",
    semesterText: "Runtime A",
    termStartDate: "2026-03-02",
    totalWeeks: 20,
    source: "test",
  });
  const weekFromEarlierStart = week.getCurrentTeachingWeek(new Date("2026-06-08T12:00:00+08:00"), [], week.getRuntimeTermConfig());

  week.setRuntimeTermConfig({
    term: "runtime-b",
    semesterText: "Runtime B",
    termStartDate: "2026-03-16",
    totalWeeks: 20,
    source: "test",
  });
  const weekFromLaterStart = week.getCurrentTeachingWeek(new Date("2026-06-08T12:00:00+08:00"), [], week.getRuntimeTermConfig());
  assert.notStrictEqual(weekFromEarlierStart, weekFromLaterStart, "runtime termStartDate should change current teaching week");

  const fromRelease = termConfigService.resolveTermConfigFromSources({
    activeRelease: {
      releaseVersion: "rel-1",
      manifest: {
        termConfig: {
          term: "2026-2027-1",
          semesterText: "2026-2027学年第一学期",
          termStartDate: "2026-09-07",
          totalWeeks: 18,
        },
      },
    },
    appConfig: {
      termConfig: {
        termStartDate: "2026-09-14",
      },
    },
  });
  assert.strictEqual(fromRelease.termStartDate, "2026-09-07");
  assert.strictEqual(fromRelease.source, "activeRelease.manifest.termConfig");

  const fromAppConfig = termConfigService.resolveTermConfigFromSources({
    activeRelease: {},
    appConfig: {
      termConfig: {
        term: "2026-2027-1",
        termStartDate: "2026-09-14",
        totalWeeks: 19,
      },
    },
  });
  assert.strictEqual(fromAppConfig.termStartDate, "2026-09-14");
  assert.strictEqual(fromAppConfig.source, "appConfig.data.termConfig");

  const fromSemester = termConfigService.resolveTermConfigFromSources({
    appConfig: {
      currentSemester: "2026-2027-1",
      dataVersion: {
        termStartDate: "2026-09-21",
        releaseVersion: "rel-2",
      },
    },
  });
  assert.strictEqual(fromSemester.term, "2026-2027-1");
  assert.strictEqual(fromSemester.termStartDate, "2026-09-21");
  assert.strictEqual(fromSemester.source, "appConfig.data.currentSemester");

  week.resetRuntimeTermConfig();
  assert.strictEqual(week.getRuntimeTermConfig().termStartDate, "", "fallback should not guess a term start date");
  console.log("test-term-config-runtime passed");
}

run();
