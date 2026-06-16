const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();

const aiAssistantService = require("../miniprogram/services/aiAssistantService");

function run() {
  const saved = aiAssistantService.saveUserPreferences({
    campus: "\u4ed9\u6eaa\u6821\u533a",
    favoriteBuildings: ["C7", "B8", "library", "x1", "x2", "x3", "x4", "x5", "x6"],
    defaultEmptyRoomDurationSections: 99,
    allowMinimalScheduleSummary: true,
    answerDetail: "detailed",
    weatherAdviceEnabled: false,
  });

  assert.strictEqual(saved.campus, "\u4ed9\u6eaa\u6821\u533a");
  assert.strictEqual(saved.favoriteBuildings.length, 8);
  assert.strictEqual(saved.defaultEmptyRoomDurationSections, 12);
  assert.strictEqual(saved.allowMinimalScheduleSummary, true);
  assert.strictEqual(saved.answerDetail, "detailed");
  assert.strictEqual(saved.weatherAdviceEnabled, false);
  assert.strictEqual(aiAssistantService.isPersonalContextAllowed(), true);

  const remembered = aiAssistantService.getRememberedPersonalization();
  assert.strictEqual(remembered.localOnly, true);
  assert.strictEqual(remembered.userPreferences.campus, "\u4ed9\u6eaa\u6821\u533a");

  const context = aiAssistantService.buildClientContext();
  assert.strictEqual(context.userPreferences.campus, "\u4ed9\u6eaa\u6821\u533a");
  assert.strictEqual(context.userPreferences.localOnly, true);

  aiAssistantService.clearPersonalization();
  const cleared = aiAssistantService.getUserPreferences();
  assert.strictEqual(cleared.campus, "");
  assert.strictEqual(cleared.allowMinimalScheduleSummary, false);
  assert.strictEqual(aiAssistantService.isPersonalContextAllowed(), false);

  console.log("test-ai-user-preferences passed");
}

run();
