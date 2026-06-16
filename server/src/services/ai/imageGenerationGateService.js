function getStatus(runtimeMode = "public") {
  const enabled = runtimeMode === "competition" &&
    String(process.env.AI_IMAGE_GENERATION_ENABLED || "false").toLowerCase() === "true" &&
    String(process.env.AI_IMAGE_GENERATION_PREFLIGHT_OK || "false").toLowerCase() === "true";
  return {
    enabled,
    runtimeMode,
    provider: enabled ? "cloudbase-node-sdk" : "disabled",
    model: enabled ? (process.env.AI_IMAGE_MODEL || "hunyuan-image") : "",
    blocker: enabled ? "" : "CloudBase Node SDK image preflight has not been verified in this environment.",
    allowedScenes: [
      "study_plan_card",
      "schedule_share_poster",
      "campus_activity_illustration",
      "competition_demo_asset",
    ],
  };
}

function buildDisabledResult(runtimeMode) {
  const status = getStatus(runtimeMode);
  return {
    success: false,
    code: "IMAGE_GENERATION_DISABLED",
    sourceId: "image-generation-gate:v1",
    status,
    summary: status.blocker,
  };
}

module.exports = {
  buildDisabledResult,
  getStatus,
};
