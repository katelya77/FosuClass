const BASELINE_KEY = "FOSU_AI_SCHEDULE_CHANGE_BASELINE_V1";
const PENDING_KEY = "FOSU_AI_SCHEDULE_CHANGE_PENDING_V1";
const MAX_COURSES = 80;

function safeText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 80);
}

function read(key) {
  try {
    const value = wx.getStorageSync(key);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    return true;
  } catch (error) {
    return false;
  }
}

function remove(key) {
  try { wx.removeStorageSync(key); } catch (error) { /* local tracking is best-effort */ }
}

function sanitizeCourse(course) {
  const source = course && typeof course === "object" ? course : {};
  return {
    courseName: safeText(source.courseName || source.name || "", 60),
    teacherName: safeText(source.teacherName || source.teacher || "", 40),
    classroom: safeText(source.classroom || source.roomName || "", 60),
    campus: safeText(source.campus || "", 24),
    weekday: Math.max(0, Math.min(7, Number(source.weekday || 0) || 0)),
    startSection: Math.max(0, Math.min(14, Number(source.startSection || 0) || 0)),
    endSection: Math.max(0, Math.min(14, Number(source.endSection || source.startSection || 0) || 0)),
    weeks: Array.isArray(source.weeks)
      ? source.weeks.slice(0, 40).map(Number).filter((item) => Number.isFinite(item) && item >= 1 && item <= 30)
      : [],
    weekText: safeText(source.weekText || source.rawWeek || "", 80),
  };
}

function sanitizeSummary(summary) {
  const source = summary && typeof summary === "object" ? summary : {};
  if (!source.enabled || !Array.isArray(source.courses) || !source.courses.length) return null;
  return {
    enabled: true,
    fingerprint: safeText(source.fingerprint, 80),
    term: safeText(source.term || source.semester, 32),
    courses: source.courses.slice(0, MAX_COURSES).map(sanitizeCourse),
    capturedAt: new Date().toISOString(),
  };
}

function sameSummary(left, right) {
  if (!left || !right) return false;
  if (left.fingerprint && right.fingerprint) return left.fingerprint === right.fingerprint;
  return JSON.stringify(left.courses || []) === JSON.stringify(right.courses || []);
}

function capture(summary) {
  const current = sanitizeSummary(summary);
  if (!current) return { pending: false, baseline: null, currentFingerprint: "" };
  const pending = read(PENDING_KEY);
  if (pending && pending.baseline && pending.currentFingerprint === current.fingerprint) {
    return {
      pending: true,
      baseline: pending.baseline,
      currentFingerprint: pending.currentFingerprint,
      detectedAt: pending.detectedAt || "",
    };
  }
  const baseline = read(BASELINE_KEY);
  if (!baseline) {
    write(BASELINE_KEY, current);
    return { pending: false, baseline: null, currentFingerprint: current.fingerprint };
  }
  if (sameSummary(baseline, current)) {
    return { pending: false, baseline: null, currentFingerprint: current.fingerprint };
  }
  const nextPending = {
    baseline: pending && pending.baseline || baseline,
    currentFingerprint: current.fingerprint,
    detectedAt: new Date().toISOString(),
  };
  write(PENDING_KEY, nextPending);
  write(BASELINE_KEY, current);
  return {
    pending: true,
    baseline: nextPending.baseline,
    currentFingerprint: nextPending.currentFingerprint,
    detectedAt: nextPending.detectedAt,
  };
}

function getPending() {
  return read(PENDING_KEY);
}

function acknowledge(summary) {
  const current = sanitizeSummary(summary);
  if (current) write(BASELINE_KEY, current);
  remove(PENDING_KEY);
  return { success: true };
}

function clear() {
  remove(BASELINE_KEY);
  remove(PENDING_KEY);
}

module.exports = {
  BASELINE_KEY,
  PENDING_KEY,
  acknowledge,
  capture,
  clear,
  getPending,
  sanitizeSummary,
};
