const assert = require("assert");
const mockEnv = require("./mock-env");

const OLD_TERM = "2025-2026-2";
const OLD_RELEASE = "2026-07-07T15-02-30";
const NEW_TERM = "2026-2027-1";
const NEW_RELEASE = "2026-08-12T22-25-38";

mockEnv.clearStorage();

const platformDataService = require("../miniprogram/services/platformDataService");
const releasePackService = require("../miniprogram/services/releasePackService");
const teachingCalendarService = require("../miniprogram/services/teachingCalendarService");
const request = require("../miniprogram/utils/request");
const { SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY } = require("../miniprogram/utils/storage");

function snapshot(term, releaseVersion, savedAt) {
  return {
    savedAt,
    success: true,
    activeSnapshot: {
      term,
      releaseVersion,
      updatedAt: new Date(savedAt).toISOString(),
      cacheEpoch: savedAt,
    },
  };
}

const oldSavedAt = Date.parse("2026-08-12T20:15:00+08:00");
const newSavedAt = Date.parse("2026-08-13T13:42:00+08:00");

// This is the real cutover shape: WeChat prefetch and the school page cache still
// point at the previous term, while periodic data and runtime/active.json already
// point at the newly activated release.
mockEnv.storage.set(
  platformDataService.PLATFORM_PREFETCH_CACHE_KEY,
  snapshot(OLD_TERM, OLD_RELEASE, oldSavedAt)
);
mockEnv.storage.set(
  platformDataService.PLATFORM_PERIODIC_CACHE_KEY,
  snapshot(NEW_TERM, NEW_RELEASE, newSavedAt)
);
mockEnv.storage.set(SCHOOL_ACTIVE_SNAPSHOT_CACHE_KEY, {
  savedAt: oldSavedAt,
  term: OLD_TERM,
  releaseVersion: OLD_RELEASE,
  cacheEpoch: oldSavedAt,
});
releasePackService.writeRuntimePointerCache({
  success: true,
  activeTerm: NEW_TERM,
  term: NEW_TERM,
  releaseVersion: NEW_RELEASE,
  updatedAt: new Date(newSavedAt).toISOString(),
  cacheEpoch: newSavedAt,
  termConfig: {
    term: NEW_TERM,
    semesterText: "2026-2027学年第一学期",
    termStartDate: "2026-09-07",
    totalWeeks: 20,
    weekStart: "monday",
  },
});

const platformSnapshot = platformDataService.getCachedPlatformSnapshot();
assert.strictEqual(
  `${platformSnapshot.term}:${platformSnapshot.releaseVersion}`,
  `${NEW_TERM}:${NEW_RELEASE}`,
  "the newest coherent platform snapshot must win over stale WeChat prefetch data"
);

const immediateCalendar = teachingCalendarService.getImmediateActiveCalendar();
assert.strictEqual(
  `${immediateCalendar.term}:${immediateCalendar.releaseVersion}`,
  `${NEW_TERM}:${NEW_RELEASE}`,
  "calendar first paint must follow the cached runtime pointer instead of the previous built-in term"
);
assert.strictEqual(immediateCalendar.termConfig.termStartDate, "2026-09-07");
assert.strictEqual(immediateCalendar.weeks.length, 20, "new-term first paint should render the pointer-derived calendar skeleton");

const friendlyTermError = request.normalizeRequestError(new Error("TERM_DATA_MISSING"), {
  payload: { success: false, code: "TERM_DATA_MISSING", message: "TERM_DATA_MISSING" },
  code: "TERM_DATA_MISSING",
  reasonCode: "TERM_DATA_MISSING",
});
assert.strictEqual(friendlyTermError.code, "TERM_DATA_MISSING");

require("../miniprogram/pages/school/school.js");
const page = mockEnv.createPageInstance();
page._schoolRequestSeq = 0;
page._activeInitSeq = 0;

page.resolveActiveSnapshot({ forceNetwork: false })
  .then((result) => {
    assert(result && result.activeSnapshot, "school page must resolve an active snapshot");
    assert.strictEqual(
      `${result.activeSnapshot.term}:${result.activeSnapshot.releaseVersion}`,
      `${NEW_TERM}:${NEW_RELEASE}`,
      "school page must not combine the previous term cache with the new active release"
    );
    console.log("test-active-term-cutover-coherence passed");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
