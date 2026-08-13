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
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const projectConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "project.config.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const { makeBuildInfo, renderBuildInfo } = require("./generate-miniprogram-build-info");

const WECHAT_DIRECT_HOSTS = ["servicewechat.com", ".servicewechat.com"];
const PROXY_ENV_KEYS = [
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "all_proxy",
];

function mergeNoProxy(current, requiredHosts = WECHAT_DIRECT_HOSTS) {
  const values = String(current || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const seen = new Set(values.map((item) => item.toLowerCase()));
  for (const host of requiredHosts) {
    if (!seen.has(host.toLowerCase())) {
      values.push(host);
      seen.add(host.toLowerCase());
    }
  }
  return values.join(",");
}

function prepareWechatDirectNetworkEnvironment(env = process.env) {
  for (const key of PROXY_ENV_KEYS) delete env[key];
  const noProxy = mergeNoProxy(env.NO_PROXY || env.no_proxy);
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return { proxyDisabled: true, noProxyHosts: [...WECHAT_DIRECT_HOSTS] };
}

function isWechatUploadIpError(error) {
  return /invalid ip|errCode.:-10008|-10008/i.test(String(error && (error.message || error) || ""));
}

function resolveWechatDevtoolsCli(env = process.env) {
  const candidates = [
    env.WECHAT_DEVTOOLS_CLI,
    "D:\\微信web开发者工具\\cli.bat",
    "C:\\Program Files (x86)\\Tencent\\微信web开发者工具\\cli.bat",
    "C:\\Program Files\\Tencent\\微信开发者工具\\cli.bat",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function assertSafeCmdValue(value, label) {
  const text = String(value || "");
  if (!text || /["&|<>^%\r\n]/.test(text)) {
    throw new Error(`${label} contains unsupported command characters`);
  }
  return text;
}

function quoteCmdValue(value, label) {
  return `"${assertSafeCmdValue(value, label)}"`;
}

async function withEphemeralBuildInfo(task, options = {}) {
  const target = options.target || path.join(ROOT, "miniprogram", "config", "buildInfo.js");
  const original = fs.readFileSync(target);
  const info = makeBuildInfo(options.buildInfo || {});
  fs.writeFileSync(target, renderBuildInfo(info), "utf8");
  try {
    return await task(info);
  } finally {
    fs.writeFileSync(target, original);
  }
}

function uploadWithWechatDevtoolsCli({ version, desc }, env = process.env) {
  const cli = resolveWechatDevtoolsCli(env);
  if (!cli) return null;
  const infoOutput = path.join(os.tmpdir(), `fosu-wechat-upload-${Date.now()}.json`);
  const command = [
    "call", quoteCmdValue(cli, "WeChat DevTools CLI path"),
    "upload",
    "--project", quoteCmdValue(ROOT, "project path"),
    "--version", quoteCmdValue(version, "version"),
    "--desc", quoteCmdValue(desc, "description"),
    "--info-output", quoteCmdValue(infoOutput, "info output path"),
  ].join(" ");
  const result = spawnSync(env.ComSpec || process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], {
    encoding: "utf8",
    env,
    shell: false,
    windowsVerbatimArguments: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw result.error || new Error(`WeChat DevTools CLI upload failed with status ${result.status}`);
  }
  return {
    transport: "wechat-devtools-cli",
    cli: path.basename(cli),
    infoOutputCreated: fs.existsSync(infoOutput),
  };
}

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

async function runUpload(buildInfo) {
  const network = prepareWechatDirectNetworkEnvironment(process.env);
  const appid = process.env.WECHAT_APPID || projectConfig.appid;
  const version =
    process.env.WECHAT_VERSION ||
    `${pkg.version || "1.0.0"}-trial-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  const desc =
    process.env.WECHAT_DESC ||
    `xiaofu final product convergence trial ${new Date().toISOString()} (no formal review)`;
  const preferredTransport = String(process.env.WECHAT_UPLOAD_TRANSPORT || "auto").trim().toLowerCase();
  const devtoolsCli = resolveWechatDevtoolsCli(process.env);

  if (preferredTransport !== "ci" && devtoolsCli) {
    console.log(JSON.stringify({ action: "upload-trial", appid, version, projectPath: ROOT, network, transport: "wechat-devtools-cli", buildInfo }, null, 2));
    const result = uploadWithWechatDevtoolsCli({ version, desc }, process.env);
    console.log(JSON.stringify({
      success: true,
      appid,
      version,
      desc,
      result,
      transport: "wechat-devtools-cli",
      formalReviewSubmitted: false,
      uploadedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  let ci;
  try {
    ci = require("miniprogram-ci");
  } catch (e) {
    console.error("miniprogram-ci not installed. Run: npm install miniprogram-ci --no-save");
    process.exit(2);
  }
  // miniprogram-ci can auto-discover the Windows system proxy even when the
  // usual proxy environment variables are empty.  Explicitly keep WeChat CI
  // on the domestic/direct route used by this project.
  if (typeof ci.proxy === "function") ci.proxy("");

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

  console.log(JSON.stringify({ action: "upload-trial", appid, version, privateKeyPath: path.basename(privateKeyPath), projectPath: ROOT, network, buildInfo }, null, 2));

  const project = new ci.Project({
    appid,
    type: "miniProgram",
    projectPath: ROOT,
    privateKeyPath,
    // 忽略列表必须覆盖仓库根一切非小程序运行所需内容，尤其是私钥/密钥/环境变量：
    // ci 的 ignores 语义（覆盖还是合并 packOptions.ignore）不应成为安全假设。
    ignores: [
      "node_modules/**/*",
      "server/**/*",
      "tools/**/*",
      "docs/**/*",
      ".git/**/*",
      ".github/**/*",
      "cloudfunctions/**/*",
      "output/**/*",
      "staging/**/*",
      "dist/**/*",
      "deploy/**/*",
      "specs/**/*",
      "test-results/**/*",
      "tmp/**/*",
      ".tmp/**/*",
      ".local/**/*",
      ".codex-artifacts/**/*",
      ".claude/**/*",
      ".agents/**/*",
      "secrets/**/*",
      "shared/**/*",
      "*.key",
      "*.pem",
      ".env*",
      "local.secrets*",
      "*.log",
      "*.md",
      "*.cmd",
    ],
  });

  let result;
  let transport = "miniprogram-ci";
  try {
    result = await ci.upload({
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
  } catch (error) {
    if (!isWechatUploadIpError(error)) throw error;
    console.warn("miniprogram-ci IP whitelist rejected the direct upload; trying the logged-in WeChat DevTools CLI.");
    result = uploadWithWechatDevtoolsCli({ version, desc }, process.env);
    if (!result) throw error;
    transport = result.transport;
  }

  const out = {
    success: true,
    appid,
    version,
    desc,
    result,
    transport,
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

async function main() {
  return withEphemeralBuildInfo((buildInfo) => runUpload(buildInfo));
}

if (require.main === module) main().catch((err) => {
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

module.exports = {
  assertSafeCmdValue,
  isWechatUploadIpError,
  mergeNoProxy,
  prepareWechatDirectNetworkEnvironment,
  resolveWechatDevtoolsCli,
  uploadWithWechatDevtoolsCli,
  withEphemeralBuildInfo,
};
