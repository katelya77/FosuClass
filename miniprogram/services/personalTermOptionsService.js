function buildImportTermOptions(availableTerms, currentSemesterId, fallbackTerm) {
  const records = (Array.isArray(availableTerms) ? availableTerms : [])
    .filter((item) => item && item.term && item.status !== "disabled")
    .map((item) => ({
      term: item.term,
      label: item.semesterText || item.term,
      status: item.status || "",
      dataAvailable: item.dataAvailable !== false,
      importable: item.status !== "planned" && item.dataAvailable !== false,
      archived: item.status === "archived",
    }));
  if (!records.some((item) => item.term === currentSemesterId) && currentSemesterId) {
    records.unshift({
      term: currentSemesterId,
      label: currentSemesterId,
      status: "current",
      dataAvailable: true,
      importable: true,
      archived: false,
    });
  }
  if (!records.length && fallbackTerm) {
    records.push({
      term: fallbackTerm,
      label: fallbackTerm,
      status: "current",
      dataAvailable: true,
      importable: true,
      archived: false,
    });
  }
  const semesterOptions = records.map((item) => item.term);
  const semesterOptionLabels = records.map((item) => item.importable ? item.label : `${item.label}（尚未发布）`);
  const importableCount = records.filter((item) => item.importable).length;
  const selectedIndex = Math.max(0, records.findIndex((item) => item.term === currentSemesterId));
  return {
    records,
    semesterOptions,
    semesterOptionLabels,
    selectedIndex,
    pickerEnabled: importableCount >= 2,
  };
}

module.exports = {
  buildImportTermOptions,
};
