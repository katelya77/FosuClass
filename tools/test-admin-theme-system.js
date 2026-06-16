const assert = require("assert");
const { adminConsoleHtml } = require("../server/src/routes/adminPages");

function count(pattern) {
  const matches = adminConsoleHtml.match(pattern);
  return matches ? matches.length : 0;
}

function run() {
  const prepaintIndex = adminConsoleHtml.indexOf("fosu-admin-theme");
  const styleIndex = adminConsoleHtml.indexOf("<style>");
  assert(prepaintIndex > 0);
  assert(styleIndex > prepaintIndex, "theme preference must be applied before CSS paints");

  [
    "--page-bg",
    "--surface",
    "--surface-raised",
    "--surface-muted",
    "--border-strong",
    "--text-primary",
    "--text-secondary",
    "--text-muted",
    "--primary-hover",
    "--overlay",
    "--code-bg",
    "--table-hover",
  ].forEach((token) => assert(adminConsoleHtml.includes(token), token));

  assert(adminConsoleHtml.includes('data-theme-choice="system"'));
  assert(adminConsoleHtml.includes('data-theme-choice="light"'));
  assert(adminConsoleHtml.includes('data-theme-choice="dark"'));
  assert(adminConsoleHtml.includes('aria-label="后台主题"'));
  assert(adminConsoleHtml.includes('aria-pressed'));
  assert(adminConsoleHtml.includes("matchMedia(\"(prefers-color-scheme: dark)"));
  assert(adminConsoleHtml.includes("addEventListener(\"change\""));
  assert(adminConsoleHtml.includes("@media (prefers-reduced-motion: reduce)"));
  assert(adminConsoleHtml.includes("localStorage.setItem(THEME_STORAGE_KEY"));
  assert.strictEqual(count(/\/api\/admin\/theme/g), 0, "theme preference must not call the server");
  assert(adminConsoleHtml.includes("AI Agent"));
  assert(adminConsoleHtml.includes("/api/admin/ai-agent/status"));
  assert(adminConsoleHtml.includes("/api/admin/ai-agent/evaluate"));

  const forbiddenLightBackground = /background:\s*(#fff|#ffffff|white|#f8fafc|#f1f5f9|#eff6ff|#dbeafe|#fee2e2|#fecaca)/i;
  assert(!forbiddenLightBackground.test(adminConsoleHtml), "hard-coded light backgrounds should use semantic tokens");

  console.log("test-admin-theme-system passed");
}

run();
