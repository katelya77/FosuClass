const LEGAL_STUDENT_STAGES = new Set(["loading", "identity-confirm", "preview", "done"]);
const PLACEHOLDER_CLASS = /班级未确认|班级待确认|未知班级|未识别|待确认/;

function normalizeImportSurface(method, stage) {
  const activeImportMethod = method === "xls" ? "xls" : (method === "student" ? "student" : "method");
  const studentImportStage = stage || "form";
  if (activeImportMethod === "student" && !LEGAL_STUDENT_STAGES.has(studentImportStage)) {
    return { activeImportMethod: "method", studentImportStage: "form", corrected: true };
  }
  return { activeImportMethod, studentImportStage, corrected: false };
}

function hasPrimarySyncBody(state) {
  const surface = normalizeImportSurface(state && state.activeImportMethod, state && state.studentImportStage);
  if (surface.corrected) return false;
  if (surface.activeImportMethod === "method" || surface.activeImportMethod === "xls") return true;
  return LEGAL_STUDENT_STAGES.has(surface.studentImportStage);
}

function reliableClassName(value) {
  const text = String(value || "").trim();
  if (!text || PLACEHOLDER_CLASS.test(text)) return "";
  return text;
}

function buildPersonalSyncSubtitle(className, term) {
  return [reliableClassName(className), term || "", "学号同步"].filter(Boolean).join(" · ");
}

function isFullStudentId(value) {
  return /^\d{6,20}$/.test(String(value || "").trim());
}

function mergeDisplayStudentId(preferred, fallback) {
  if (isFullStudentId(preferred)) return String(preferred).trim();
  if (isFullStudentId(fallback)) return String(fallback).trim();
  return "";
}

function summarizePageRemarks(remarks, expanded) {
  const list = (Array.isArray(remarks) ? remarks : [])
    .map((item) => String(item || "").replace(/[\u0000-\u001F\u007F]/g, "").trim())
    .filter(Boolean);
  if (!list.length) {
    return { visible: false, text: "", expanded: false, canToggle: false };
  }
  const fullText = list.join("\n");
  const canToggle = fullText.length > 72 || list.length > 3;
  const summary = list.slice(0, 3).join("\n");
  return {
    visible: true,
    text: expanded || !canToggle ? fullText : summary,
    expanded: Boolean(expanded) && canToggle,
    canToggle,
  };
}

module.exports = {
  LEGAL_STUDENT_STAGES,
  normalizeImportSurface,
  hasPrimarySyncBody,
  reliableClassName,
  buildPersonalSyncSubtitle,
  isFullStudentId,
  mergeDisplayStudentId,
  summarizePageRemarks,
};
