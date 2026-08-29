"use strict";

function parseTerm(term) {
  const match = String(term || "").match(/^(\d{4})-(\d{4})-([12])$/);
  return match ? [Number(match[1]), Number(match[3])] : [0, 0];
}

function compareTerms(left, right) {
  const leftDate = Date.parse(`${left && left.termStartDate || ""}T00:00:00Z`);
  const rightDate = Date.parse(`${right && right.termStartDate || ""}T00:00:00Z`);
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && leftDate !== rightDate) return rightDate - leftDate;
  const a = parseTerm(left && left.term);
  const b = parseTerm(right && right.term);
  if (a[0] !== b[0]) return b[0] - a[0];
  return b[1] - a[1];
}

function sortVisibleTerms(records, activeTerm) {
  return (Array.isArray(records) ? records : []).slice().sort((left, right) => {
    if (left.term === activeTerm && right.term !== activeTerm) return -1;
    if (right.term === activeTerm && left.term !== activeTerm) return 1;
    return compareTerms(left, right);
  });
}

function classScheduleCount(manifest) {
  const counts = manifest && manifest.counts || {};
  return Number(counts.classScheduleCount || counts.classSchedules || counts.classCount || 0);
}

function releaseIsHealthy(manifest, expectedTerm) {
  if (!manifest || manifest.healthy === false || manifest.success === false) return false;
  const manifestTerm = manifest.term || manifest.semester || manifest.termConfig && manifest.termConfig.term || "";
  if (manifestTerm && expectedTerm && manifestTerm !== expectedTerm) return false;
  return classScheduleCount(manifest) > 0;
}

module.exports = { compareTerms, releaseIsHealthy, sortVisibleTerms };
