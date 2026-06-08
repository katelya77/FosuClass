const assert = require("assert");
const fs = require("fs");
const path = require("path");

const files = [
  path.join(__dirname, "..", "miniprogram", "components", "notice-ticker", "notice-ticker.wxss"),
];

const forbidden = [];
files.forEach((file) => {
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach((line, index) => {
    const selector = line.split("{")[0].trim();
    if (!line.includes("{") || selector.startsWith("@") || !selector) return;
    if (/(^|[\s,>+~])(?:view|text|button|input|picker|scroll-view)(?=$|[\s.#:{,>+~])/.test(selector)) {
      forbidden.push(`${path.basename(file)}:${index + 1}:${selector}`);
    }
    if (/(^|[\s,])#[A-Za-z0-9_-]+/.test(selector) || /\[[^\]]+\]/.test(selector)) {
      forbidden.push(`${path.basename(file)}:${index + 1}:${selector}`);
    }
  });
});

assert.deepStrictEqual(forbidden, [], `forbidden wxss selectors: ${forbidden.join(", ")}`);
console.log("test-wxss-selector-sanity passed");
