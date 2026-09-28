const { presentPersonalSyncError } = require("./personalSyncErrorPresenter");
const { assertPersonalSyncRenderableState } = require("./personalSyncRenderableState");

function applyPersonalSyncFailure(error, credential, options) {
  const view = presentPersonalSyncError(error || {});
  const keepSurface = Boolean(options && options.keepSurface);
  const usingSavedPassword = Boolean(credential && credential.usingSavedPassword);
  const patch = {
    studentImportLoading: false,
    studentImportStatusMessage: "",
    syncErrorTitle: view.title,
    syncErrorContent: view.content,
    passwordInputFocus: view.action === "reenter-password",
  };
  if (!keepSurface) {
    patch.activeImportMethod = "method";
    patch.studentImportStage = "form";
    patch.studentPreviewResult = null;
    patch.studentPreviewToken = "";
  }
  return {
    view: view,
    patch: patch,
    credentialPatch: {
      clearSavedPassword: view.code === "INVALID_CREDENTIALS" && usingSavedPassword,
      saveCredential: view.code === "EMPTY_PERSONAL_SCHEDULE" && Boolean(credential && credential.password),
    },
    renderable: assertPersonalSyncRenderableState(Object.assign({
      activeImportMethod: keepSurface ? (options && options.activeImportMethod) || "student" : "method",
      studentImportStage: keepSurface ? (options && options.studentImportStage) || "preview" : "form",
      studentImportLoading: false,
      studentPreviewResult: keepSurface ? { kept: true } : null,
      syncErrorTitle: view.title,
    }, patch)),
  };
}

module.exports = {
  applyPersonalSyncFailure,
};
