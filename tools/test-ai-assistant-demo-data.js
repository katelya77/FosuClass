const assert = require("assert");

const demoData = require("../miniprogram/packageXiaofu/pages/ai-assistant/demo-data");

const MODES = ["empty-room", "today", "diagnosis", "guide", "teacher", "meeting"];
const SENSITIVE_PATTERNS = [
  /学号/,
  /密码/,
  /\btoken\b/i,
  /\bsecret\b/i,
  /\bapi[-_\s]?key\b/i,
  /\bsk-[A-Za-z0-9_-]{8,}/,
];

function run() {
  MODES.forEach((mode) => {
    assert.strictEqual(demoData.normalizeDemoMode(mode), mode, `${mode} should be a valid demo mode`);
    const messages = demoData.getDemoMessages(mode);
    assert(Array.isArray(messages), `${mode} demo messages must be an array`);
    assert(messages.length > 0, `${mode} demo should include at least one message`);
    const text = JSON.stringify(messages);
    assert(text.includes("演示数据"), `${mode} demo must be clearly marked as demo data`);
    SENSITIVE_PATTERNS.forEach((pattern) => {
      assert(!pattern.test(text), `${mode} demo must not contain sensitive marker: ${pattern}`);
    });
  });

  console.log("test-ai-assistant-demo-data passed");
}

run();
