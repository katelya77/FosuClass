function assertPersonalSyncRenderableState(state) {
  const method = state && state.activeImportMethod || "";
  const stage = state && state.studentImportStage || "";
  const loading = Boolean(state && state.studentImportLoading);
  const preview = Boolean(state && state.studentPreviewResult);
  const error = Boolean(state && state.syncErrorTitle);
  if (method === "xls") return { ok: true, surface: "xls" };
  if ((method === "method" || method === "" || stage === "form") && !loading) {
    return { ok: true, surface: error ? "form-error" : "form" };
  }
  if (method === "student" && stage === "loading" && loading) return { ok: true, surface: "loading" };
  if (method === "student" && stage === "identity-confirm" && preview && !loading) return { ok: true, surface: "identity-confirm" };
  if (method === "student" && stage === "preview" && preview && !loading) return { ok: true, surface: "preview" };
  if (method === "student" && stage === "done" && !loading) return { ok: true, surface: "success" };
  if (!loading && error) return { ok: true, surface: "error" };
  return { ok: false, reason: "blank" };
}

module.exports = {
  assertPersonalSyncRenderableState,
};
