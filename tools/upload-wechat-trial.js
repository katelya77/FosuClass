#!/usr/bin/env node
/**
 * Upload WeChat trial (experience) build via miniprogram-ci.
 *
 * Required (one of):
 *   WECHAT_PRIVATE_KEY_PATH / MP_CI_PRIVATE_KEY  → path to code upload private key PEM
 *   WECHAT_PRIVATE_KEY                           → PEM contents (will write temp file)
 *
 * Optional:
 *   WECHAT_APPID (default from project.config.json)
 *   WECHAT_VERSION (default package.json version + date)
 *   WECHAT_DESC (upload description)
 *
 * Does NOT submit formal review.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "..");
const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function resolvePrivateKeyPath() {
  const fromEnv =
    process.env.WECHAT_PRIVATE_KEY_PATH ||
    process.env.MP_CI_PRIVATE_KEY ||
    process.env.MINIPROGRAM_PRIVATE_KEY ||
    process.env.WX_PRIVATE_KEY_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return path.resolve(fromEnv);
  const candidates = [
    path.join(ROOT, "private.key"),
    path.join(ROOT, "keys", "private.key"),
    path.join(ROOT, "secrets", "private.key"),
    path.join(ROOT, "miniprogram", "private.key"),
    path.join(os.homedir(), ".fosu", "wechat-private.key"),
    path.join(os.homedir(), ".wechat", "private.key"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  if (process.env.WECHAT_PRIVATE_KEY && process.env.WECHAT_PRIVATE_KEY.includes("BEGIN")) {
    const tmp = path.join(os.tmpdir(), `fosu-wx-private-${Date.now()}.key`);
    fs.writeFileSync(tmp, process.env.WECHAT_PRIVATE_KEY, { encoding: "utf8", mode: 0o600 });
    return tmp;
  }
  return null;
}

async function main() {
  let ci;
  try {
    ci = require("miniprogram-ci");
  } catch (e) {
    console.error("miniprogram-ci not installed. Run: npm install miniprogram-ci --no-save");
    process.exit(2);
  }

  const privateKeyPath = resolvePrivateKeyPath();
  if (!privateKeyPath) {
    console.error([
      "BLOCKED: WeChat code-upload private key not found.",
      "Place PEM at one of:",
      "  ./private.key",
      "  ~/.fosu/wechat-private.key",
      "or set WECHAT_PRIVATE_KEY_PATH / MP_CI_PRIVATE_KEY",
      "Download from 微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传",
      `appid=${projectConfig.appid}`,
    ].join("\n"));
    process.exit(3);
  }

  const appid = process.env.WECHAT_APPID || projectConfig.appid;
  const version =
    process.env.WECHAT_VERSION ||
    `${pkg.version || "1.0.0"}-trial-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const desc =
    process.env.WECHAT_DESC ||
    `xiaofu final product convergence trial ${new Date().toISOString()} (no formal review)`;

  console.log(JSON.stringify({ action: "upload-trial", appid, version, privateKeyPath: path.basename(privateKeyPath), projectPath: ROOT }, null, 2));

  const project = new ci.Project({
    appid,
    type: "miniProgram",
    projectPath: ROOT,
    privateKeyPath,
    ignores: ["node_modules/**/*", "server/**/*", "tools/**/*", "docs/**/*", ".git/**/*", "cloudfunctions/**/node_modules/**/*"],
  });

  const result = await ci.upload({
    project,
    version,
    desc,
    setting: {
      es6: true,
      es7: true,
      minify: true,
      codeProtect: false,
      minifyJS: true,
      minifyWXML: true,
      minifyWXSS: true,
      autoPrefixWXSS: true,
    },
    onProgressUpdate: (info) => {
      if (info && (info._status === "done" || info.status === "done")) {
        console.log("progress", info._msg || info.message || info);
      }
    },
  });

  const out = {
    success: true,
    appid,
    version,
    desc,
    result,
    formalReviewSubmitted: false,
    uploadedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(out, null, 2));
  const scratch = process.env.GROK_SCRATCH || path.join(os.tmpdir(), "fosu-upload");
  try {
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(path.join(scratch, "delivery-trial-upload.json"), JSON.stringify(out, null, 2));
    fs.writeFileSync(
      path.join(scratch, "delivery-trial-upload.log"),
      `trial upload SUCCESS\nappid=${appid}\nversion=${version}\nformalReview=false\n${JSON.stringify(result)}\n`,
      "utf8"
    );
  } catch (e) {
    // ignore scratch write
  }
}

main().catch((err) => {
  const msg = String(err && (err.message || err) || "");
  console.error("upload failed", msg);
  if (/invalid ip|errCode.:-10008|-10008/i.test(msg)) {
    console.error([
      "IP whitelist blocked this upload.",
      "Add this machine public IP to 微信公众平台 → 开发管理 → 开发设置 → 小程序代码上传 → IP白名单",
      "Then re-run: npm run upload:wechat-trial",
    ].join("\n"));
  }
  process.exit(1);
});
