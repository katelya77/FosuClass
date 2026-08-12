#!/usr/bin/env node
"use strict";

const assert = require("assert");
const stagingSafetyService = require("../server/src/services/stagingSafetyService");

function scopeSource(scope, mode, count) {
  return { scope, sourceMode: mode, requested: count, succeeded: count, failed: 0, cacheHits: 0 };
}

function snapshot(term, counts) {
  const classSchedules = Array.from({ length: counts.classes }, (_, index) => ({
    classId: `class-${index}`,
    className: `Class ${index}`,
    courses: [{ courseName: `Course ${index}`, teacherName: `Teacher ${index}`, roomName: `Room ${index}` }],
  }));
  return {
    schemaVersion: "1.0",
    releaseVersion: `${term}-candidate`,
    term,
    semester: term,
    termStartDate: "2026-09-07",
    generatedAt: "2026-08-12T00:00:00Z",
    termConfig: { term, semesterText: term, termStartDate: "2026-09-07", totalWeeks: 20, weekStart: "monday", status: "ready", releaseVersion: `${term}-candidate`, dataAvailable: true },
    classSchedules,
    teacherSchedules: Array.from({ length: counts.teachers }, (_, index) => ({ id: `t-${index}`, items: [] })),
    classroomSchedules: Array.from({ length: counts.rooms }, (_, index) => ({ id: `r-${index}`, items: [] })),
    courseSchedules: Array.from({ length: counts.courses }, (_, index) => ({ id: `c-${index}`, items: [] })),
    teachers: Array.from({ length: counts.teachers }, (_, index) => ({ id: `t-${index}` })),
    classrooms: Array.from({ length: counts.rooms }, (_, index) => ({ id: `r-${index}` })),
    courses: Array.from({ length: counts.courses }, (_, index) => ({ id: `c-${index}` })),
    meta: {
      includeScopes: ["classSchedules", "teacherSchedules", "classroomSchedules", "courseSchedules", "teachers", "classrooms", "courses"],
      scopeSources: {
        classSchedules: scopeSource("classSchedules", "network-direct", counts.classes),
        teacherSchedules: scopeSource("teacherSchedules", "derived-current-run", counts.teachers),
        classroomSchedules: scopeSource("classroomSchedules", "derived-current-run", counts.rooms),
        courseSchedules: scopeSource("courseSchedules", "derived-current-run", counts.courses),
      },
    },
  };
}

const active = snapshot("2025-2026-2", { classes: 3, teachers: 3, rooms: 3, courses: 3 });
const candidate = snapshot("2026-2027-1", { classes: 2, teachers: 2, rooms: 2, courses: 2 });
const regular = stagingSafetyService.buildStagingSafety(candidate, active, { currentTerm: active.term });
assert.strictEqual(regular.allowPublish, false);
assert(regular.blockerCodes.includes("SCOPE_FILTER_MISMATCH"));
const ready = stagingSafetyService.buildStagingSafety(candidate, active, {
  currentTerm: active.term,
  crossTermReadyCandidate: true,
});
assert.strictEqual(ready.allowPublish, true);
assert.strictEqual(ready.crossTermReadyCandidate, true);
assert.strictEqual(ready.requiresForceConfirm, false);
assert(ready.warnings.some((value) => value.includes("activation remains disabled")));

const publishMode = stagingSafetyService.resolveStagingPublishMode(candidate, active, {
  registryTerm: { term: candidate.term, status: "planned" },
  activeRegistryTerm: { term: active.term, status: "current" },
});
assert.deepStrictEqual(publishMode, {
  activeTerm: active.term,
  stagingTerm: candidate.term,
  registryStatus: "planned",
  crossTermReadyCandidate: true,
  readyOnly: true,
  publishMode: "ready-only",
});

const unavailableMode = stagingSafetyService.resolveStagingPublishMode(candidate, active, {
  registryTerm: null,
  activeRegistryTerm: { term: active.term, status: "current" },
});
assert.strictEqual(unavailableMode.crossTermReadyCandidate, false);
assert.strictEqual(unavailableMode.readyOnly, false);

const currentMode = stagingSafetyService.resolveStagingPublishMode(active, active, {
  registryTerm: { term: active.term, status: "current" },
  activeRegistryTerm: { term: active.term, status: "current" },
});
assert.strictEqual(currentMode.publishMode, "activate-current");
assert.strictEqual(currentMode.readyOnly, false);

console.log("test-cross-term-ready-candidate passed");
