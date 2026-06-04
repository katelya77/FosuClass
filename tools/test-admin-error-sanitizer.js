const assert = require("assert");

process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "test-admin-password";

const adminPages = require("../server/src/routes/adminPages");

const html = adminPages.adminConsoleHtml || "";
assert(html.includes("sanitizeHttpErrorText"), "admin page should include HTTP error sanitizer");
assert(html.includes("源站响应超时，可能正在执行重任务或 CPU 过高"), "admin page should include friendly Cloudflare timeout message");
assert(html.includes("Ray ID="), "admin timeout summary should preserve Ray ID");
assert(!html.includes("data = { success: false, message: text || res.statusText }"), "admin API parser must not use raw HTML as message");

console.log("test-admin-error-sanitizer passed");
