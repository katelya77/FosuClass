const assert = require("assert");
const { inspectSchoolResponse, resolveSchoolRedirect, directError, MAX_REDIRECTS } = require("../miniprogram/services/fosuDirectRedirect");

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
  let blocked = null;
  try {
    resolveSchoolRedirect(
      "https://authserver.fosu.edu.cn/authserver/login",
      "https://evil.example/cas?ticket=ST-SECRET"
    );
  } catch (error) {
    blocked = error;
  }
  assert.strictEqual(blocked && blocked.code, "UNTRUSTED_REDIRECT");
  assert.deepStrictEqual(blocked.safeRedirect, {
    scheme: "https",
    host: "evil.example",
    pathname: "/cas",
  });
  assert.ok(!JSON.stringify(blocked.safeRedirect).includes("ST-SECRET"));
  assert.ok(!JSON.stringify(blocked.safeRedirect).includes("ticket"));
  assert.ok(!String(blocked.locationPath).includes("?"));
  assert.ok(blocked.safeRedirect.host);
  const success = inspectSchoolResponse("https://authserver.fosu.edu.cn/authserver/login", 200, undefined);
  assert.strictEqual(success.redirect, false);
  assert.strictEqual(codeOf(() => inspectSchoolResponse("https://100.fosu.edu.cn/", 302, "")), "REDIRECT_LOCATION_MISSING");
  const cas = inspectSchoolResponse("https://100.fosu.edu.cn/", 302, "https://100.fosu.edu.cn/caslogin.jsp");
  assert.strictEqual(cas.redirect, true);
  assert.strictEqual(cas.host, "100.fosu.edu.cn");
  assert.strictEqual(cas.path, "/caslogin.jsp");
  const auth = inspectSchoolResponse("https://100.fosu.edu.cn/caslogin.jsp", 302, "https://authserver.fosu.edu.cn/authserver/login");
  assert.strictEqual(auth.host, "authserver.fosu.edu.cn");
  assert.strictEqual(auth.path, "/authserver/login");
  const emptyHost = directError("UNTRUSTED_REDIRECT", { locationHost: "" });
  assert.notStrictEqual(emptyHost.code, "UNTRUSTED_REDIRECT");
  assert.strictEqual(emptyHost.code, "REDIRECT_LOCATION_MISSING");
  assert.strictEqual(codeOf(() => resolveSchoolRedirect("https://100.fosu.edu.cn/", "")), "REDIRECT_LOCATION_MISSING");
  const same = resolveSchoolRedirect(
    "https://100.fosu.edu.cn/caslogin.jsp",
    "https://100.fosu.edu.cn/framework/xsMain.jsp"
  );
  assert.strictEqual(same.upgraded, false);
  assert.strictEqual(same.host, "100.fosu.edu.cn");
  console.log("test-fosu-direct-redirect passed");
}

run();
