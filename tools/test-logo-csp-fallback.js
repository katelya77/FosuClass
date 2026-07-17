const assert = require("assert");
const fs = require("fs");
const path = require("path");

const logo = fs.readFileSync(path.join(__dirname, "../admin-web/src/app/components/AppLogo.vue"), "utf8");
assert(logo.includes('referrerpolicy="no-referrer"'), "logo referrerpolicy required");
assert(logo.includes("logo-fallback"), "local fallback required");
assert(logo.includes("pan.katelya.eu.org"), "remote logo host present");
assert(logo.includes("onError"), "image error handler required");

const appJs = fs.readFileSync(path.join(__dirname, "../server/src/app.js"), "utf8");
assert(appJs.includes("pan.katelya.eu.org"), "CSP allows logo domain");
assert(appJs.includes("img-src"), "CSP img-src present");

const fallback = path.join(__dirname, "../admin-web/public/logo-fallback.svg");
assert(fs.existsSync(fallback), "fallback asset file exists");
assert(fs.existsSync(path.join(__dirname, "../server/public/admin-app/logo-fallback.svg")), "built fallback asset exists");

console.log("Logo CSP/fallback tests passed.");
