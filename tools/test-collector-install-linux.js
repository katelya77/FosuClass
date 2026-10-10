"use strict";
const assert = require("assert/strict"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), { spawnSync } = require("child_process");
if (process.platform !== "linux" || process.getuid() !== 0) { console.error("Linux root is required; run this suite in the isolated CI container"); process.exit(1); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fosu-install-test-"));
let cases = 0;
function check(fn) { fn(); cases++; }
function write(file, content, mode = 0o600) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content, { mode }); }
try {
  const base = path.join(temp, "install"), state = path.join(temp, "state"), etc = path.join(temp, "etc"), bin = path.join(temp, "bin"), source = path.join(temp, "source");
  const root = path.resolve(__dirname, "..");
  const script = fs.readFileSync(path.join(root, "deploy/wyz/install-schedule-collector.sh"), "utf8").replaceAll("/opt/fosuclass/schedule-collector", base).replaceAll("/var/lib/fosuclass/schedule-collector", state).replaceAll("/etc/fosuclass", etc).replaceAll("/etc/systemd/system", path.join(temp, "units")).replaceAll("/usr/local/bin/fosu-collector",path.join(bin,"fosu-collector"));
  write(path.join(temp, "install.sh"), script); fs.copyFileSync(path.join(root, "deploy/wyz/recover-release.py"), path.join(temp, "recover-release.py"));
  fs.mkdirSync(path.join(temp, "units")); fs.mkdirSync(etc);
  const envFile = path.join(etc, "full-sync.env"); write(envFile, "PRIVATE_FIXTURE_ENV_MUST_STAY\n");
  const old = path.join(base, "releases", "b".repeat(40)); fs.mkdirSync(old, { recursive: true }); fs.symlinkSync(old, path.join(base, "current"));
  write(path.join(bin, "systemctl"), '#!/bin/sh\necho "$*" >> "$MOCK_SYSTEMCTL_LOG"\ncase "$1" in is-active|is-enabled) exit 1;; esac\nexit 0\n', 0o700);
  write(path.join(bin, "npm"), '#!/bin/sh\nif [ -f "$MOCK_FAIL_FILE" ]; then exit 42; fi\nmkdir -p "$2/node_modules/.bin"\nprintf "#!/bin/sh\\nexit 0\\n" > "$2/node_modules/.bin/playwright"\nchmod 700 "$2/node_modules/.bin/playwright"\n', 0o700);
  write(path.join(source, "tools/fosu-sync-client/package.json"), '{}'); write(path.join(source, "server/package.json"), '{}');
  write(path.join(source, "deploy/wyz/repair-browser.sh"), '#!/bin/sh\necho BROWSER_FIXTURE_VERIFIED\n');
  write(path.join(source,"deploy/wyz/fosu-collector.sh"),fs.readFileSync(path.join(root,"deploy/wyz/fosu-collector.sh"),"utf8"));
  write(path.join(source, "deploy/wyz/wyz-schedule-collector.service"), '[Service]\n'); write(path.join(source, "deploy/wyz/wyz-schedule-collector.timer"), '[Timer]\n');
  const revision = "a".repeat(40), bundle = path.join(temp, "wyz-schedule-collector-" + revision + ".tar.gz");
  const tar = spawnSync("tar", ["-czf", bundle, "-C", source, "tools", "server", "deploy"]); assert.equal(tar.status, 0);
  const digest = crypto.createHash("sha256").update(fs.readFileSync(bundle)).digest("hex");
  const failFile = path.join(temp, "fail-once"), log = path.join(temp, "systemctl.log"); write(failFile, "fail");
  const env = { ...process.env, PATH: bin + ":" + process.env.PATH, MOCK_FAIL_FILE: failFile, MOCK_SYSTEMCTL_LOG: log };
  const run = (hash = digest) => spawnSync("bash", [path.join(temp, "install.sh"), bundle, hash], { env, encoding: "utf8" });
  const destination = path.join(base, "releases", revision);
  check(() => { const result = run(); assert.equal(result.status, 42); assert.equal(fs.readlinkSync(path.join(base, "current")), old); assert.ok(fs.existsSync(destination)); assert.ok(!fs.existsSync(path.join(destination, ".install-complete.json"))); });
  fs.unlinkSync(failFile);
  check(() => { const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(fs.readlinkSync(path.join(base, "current")), destination); assert.equal(fs.readFileSync(path.join(state, "previous-install.txt"), "utf8").trim(), old); });
  check(() => { const result = run(); assert.equal(result.status, 0, result.stdout + result.stderr); assert.match(result.stdout, /ALREADY_INSTALLED_COMPLETE/); assert.equal(fs.readFileSync(path.join(state, "previous-install.txt"), "utf8").trim(), old); });
  check(() => assert.equal(fs.readFileSync(envFile, "utf8"), "PRIVATE_FIXTURE_ENV_MUST_STAY\n"));
  check(() => assert.ok(!/start|enable|wyz-campus-agent/.test(fs.readFileSync(log, "utf8").split("\n").filter(line => !line.startsWith("is-enabled")).join("\n"))));
  check(() => { assert.notEqual(run("0".repeat(64)).status, 0); assert.equal(fs.readlinkSync(path.join(base, "current")), destination); });
  const sourceFile = path.join(destination, "server/package.json"); write(sourceFile, '{"damaged":true}');
  check(() => { const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /EXISTING_SOURCE_CORRUPTED/); assert.equal(fs.readFileSync(sourceFile, "utf8"), '{"damaged":true}'); });
  console.log("collector-install-linux: " + cases + " PASS (isolated fixture filesystem; no production paths)");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
