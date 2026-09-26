const assert = require("assert");
const { createCookieJar } = require("../miniprogram/services/fosuDirectCookieJar");

function run() {
  let clock = Date.parse("2026-09-24T00:00:00Z");
  const jar = createCookieJar({ now: () => clock });
  jar.absorb("https://authserver.fosu.edu.cn/authserver/login", {
    header: {
      "Set-Cookie": "CASTGC=auth-value; Domain=authserver.fosu.edu.cn; Path=/authserver; Secure",
    },
    cookies: [
      { name: "JSESSIONID", value: "auth-session", path: "/", secure: true },
    ],
  });
  jar.absorb("https://100.fosu.edu.cn/caslogin.jsp", {
    header: {
      "set-cookie": "JSESSIONID=edu-session; Path=/; Secure; Max-Age=60",
    },
  });

  const authHeader = jar.cookieHeader("https://authserver.fosu.edu.cn/authserver/login");
  assert.ok(authHeader.includes("CASTGC=auth-value"));
  assert.ok(authHeader.includes("JSESSIONID=auth-session"));
  assert.strictEqual(jar.cookieHeader("https://100.fosu.edu.cn/xskb/xskb_list.do"), "JSESSIONID=edu-session");
  assert.ok(!jar.cookieHeader("https://100.fosu.edu.cn/xskb/xskb_list.do").includes("CASTGC"));
  assert.ok(!jar.cookieHeader("https://authserver.fosu.edu.cn/authserver/login").includes("edu-session"));

  clock += 61 * 1000;
  assert.strictEqual(jar.cookieHeader("https://100.fosu.edu.cn/xskb/xskb_list.do"), "");
  assert.ok(jar.cookieHeader("https://authserver.fosu.edu.cn/authserver/login").includes("CASTGC"));

  jar.clear();
  assert.strictEqual(jar.size(), 0);
  assert.strictEqual(jar.cookieHeader("https://authserver.fosu.edu.cn/authserver/login"), "");
  console.log("test-fosu-direct-cookie-jar passed");
}

run();
