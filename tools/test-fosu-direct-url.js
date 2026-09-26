const assert = require("assert");
const { getHost, getPathname, getScheme, resolveRelativeUrl, upgradeHttpHost } = require("../miniprogram/services/fosuDirectUrl");
const { resolveLoginPostUrl } = require("../miniprogram/services/fosuDirectHtml");

assert.strictEqual(getScheme("https://100.fosu.edu.cn/caslogin.jsp"), "https");
assert.strictEqual(getHost("https://100.fosu.edu.cn/caslogin.jsp"), "100.fosu.edu.cn");
assert.strictEqual(getPathname("https://100.fosu.edu.cn/caslogin.jsp"), "/caslogin.jsp");
assert.strictEqual(
  resolveRelativeUrl("https://authserver.fosu.edu.cn/authserver/login?service=1", "/authserver/login"),
  "https://authserver.fosu.edu.cn/authserver/login"
);
assert.strictEqual(
  upgradeHttpHost("http://100.fosu.edu.cn/a?b=1", "100.fosu.edu.cn"),
  "https://100.fosu.edu.cn/a?b=1"
);
assert.strictEqual(
  resolveLoginPostUrl("https://authserver.fosu.edu.cn/authserver/login?service=1", "/authserver/login"),
  "https://authserver.fosu.edu.cn/authserver/login?service=1"
);
console.log("fosu-direct-url PASS");
