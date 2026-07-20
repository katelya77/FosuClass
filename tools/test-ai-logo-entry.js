const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOGO_REF = "/assets/icons/ai-campus-butler.png";
const logoPath = path.join(ROOT, "miniprogram/assets/icons/ai-campus-butler.png");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function run() {
  [
    "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml",
    "miniprogram/pages/index/index.wxml",
    "miniprogram/pages/school/school.wxml",
    "miniprogram/pages/today/today.wxml",
  ].forEach((file) => {
    assert(read(file).includes(LOGO_REF), `${file} should reference ${LOGO_REF}`);
  });

  if (!fs.existsSync(logoPath)) {
    console.warn(`warning: ${LOGO_REF} is referenced but the local file does not exist; text fallback should still render on the AI page.`);
  }

  console.log("test-ai-logo-entry passed");
}

run();
