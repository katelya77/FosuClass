// Generated from shared/termVisibility.js by tools/generate-miniprogram-runtime-compat.js.
// Do not edit this packaged compatibility module directly.
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

function selectVisibleTerms(records, options = {}) {
  const activeTerm = String(options.activeTerm || "");
  const resolver = typeof options.releaseResolver === "function" ? options.releaseResolver : () => null;
  const visible = (Array.isArray(records) ? records : []).reduce((result, item) => {
    if (!item || !item.term || !["current", "ready", "archived"].includes(item.status)) return result;
    if (!item.dataAvailable || !item.releaseVersion) return result;
    const manifest = resolver(item.releaseVersion, item);
    const healthy = releaseIsHealthy(manifest, item.term);
    if (!healthy) return result;
    result.push(Object.assign({}, item, { releaseHealthy: true }));
    return result;
  }, []);
  return sortVisibleTerms(visible, activeTerm);
}

function sanitizeClientTerms(cachedTerms, canonicalTerms) {
  const canonical = Array.isArray(canonicalTerms) ? canonicalTerms : [];
  const allowed = new Set(canonical.map((item) => item && item.term).filter(Boolean));
  const cached = new Map((Array.isArray(cachedTerms) ? cachedTerms : [])
    .filter((item) => item && allowed.has(item.term)).map((item) => [item.term, item]));
  return canonical.map((item) => Object.assign({}, cached.get(item.term) || {}, item));
}

function resolveSelectedTerm(selectedTerm, canonicalTerms, activeTerm) {
  const terms = (Array.isArray(canonicalTerms) ? canonicalTerms : []).map((item) => item && item.term).filter(Boolean);
  if (selectedTerm && terms.includes(selectedTerm)) return { term: selectedTerm, changed: false, reason: "" };
  const fallback = terms.includes(activeTerm) ? activeTerm : (terms[0] || "");
  return { term: fallback, changed: Boolean(selectedTerm && selectedTerm !== fallback), reason: selectedTerm ? "GHOST_TERM_FALLBACK" : "" };
}

module.exports = { compareTerms, releaseIsHealthy, resolveSelectedTerm, sanitizeClientTerms, selectVisibleTerms, sortVisibleTerms };
