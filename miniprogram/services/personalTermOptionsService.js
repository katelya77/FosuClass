"use strict";

function semanticTermParts(term) {
  const match = String(term || "").match(/^(\d{4})-(\d{4})-([12])$/);
  return match ? [Number(match[1]), Number(match[3])] : [0, 0];
}

function buildImportTermOptions(availableTerms, currentSemesterId, fallbackTerm) {
  const records = (Array.isArray(availableTerms) ? availableTerms : [])
    .filter((item) => item && item.term && ["current", "ready", "archived"].includes(item.status))
    .filter((item) => item.dataAvailable === true && Boolean(item.releaseVersion))
    .map((item) => ({
      term: item.term,
      label: item.semesterText || item.term,
      status: item.status || "",
      dataAvailable: true,
      importable: true,
      archived: item.status === "archived",
    }));
  const preferred = currentSemesterId || fallbackTerm;
  records.sort((left, right) => {
    if (left.term === preferred && right.term !== preferred) return -1;
    if (right.term === preferred && left.term !== preferred) return 1;
    const a = semanticTermParts(left.term);
    const b = semanticTermParts(right.term);
    return b[0] - a[0] || b[1] - a[1];
  });
  const semesterOptions = records.map((item) => item.term);
  const semesterOptionLabels = records.map((item) => item.label);
  const selectedIndex = Math.max(0, records.findIndex((item) => item.term === preferred));
  return {
    records,
    semesterOptions,
    semesterOptionLabels,
    selectedIndex,
    pickerEnabled: records.length >= 2,
  };
}

module.exports = { buildImportTermOptions };
