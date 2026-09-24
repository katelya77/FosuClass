const assert = require("assert");
const { resolveSchoolRedirect, MAX_REDIRECTS } = require("../miniprogram/services/fosuDirectRedirect");

function codeOf(fn) {
  try {
    fn();
    return "";
  } catch (error) {
    return error.code;
  }
}

function run() {
  assert.ok(MAX_REDIRECTS >= 5 && MAX_REDIRECTS <= 8);
  const upgraded = resolveSchoolRedirect(
    "https://authserver.fosu.edu.cn/authserver/login",
    "http://100.fosu.edu.cn/caslogin.jsp?kstzType=null&ticket=ST-TEST"
  );
  assert.strictEqual(upgraded.upgraded, true);
  assert.strictEqual(
    upgraded.url,
    "https://100.fosu.edu.cn/caslogin.jsp?kstzType=null&ticket=ST-TEST"
  );
  assert.strictEqual(
    codeOf(() => resolveSchoolRedirect("https://100.fosu.edu.cn/xskb/xskb_list.do", "http://evil.example/ticket=ST-TEST")),
    "HTTP_REQUEST_FORBIDDEN"
  );
  assert.strictEqual(
    codeOf(() => resolveSchoolRedirect("https://authserver.fosu.edu.cn/authserver/login", "https://evil.example/cas")),
    "UNTRUSTED_REDIRECT"
  );
  const same = resolveSchoolRedirect(
    "https://100.fosu.edu.cn/caslogin.jsp",
    "https://100.fosu.edu.cn/framework/xsMain.jsp"
  );
  assert.strictEqual(same.upgraded, false);
  assert.strictEqual(same.host, "100.fosu.edu.cn");
  console.log("test-fosu-direct-redirect passed");
}

run();
