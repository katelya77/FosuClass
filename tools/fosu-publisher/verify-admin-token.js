#!/usr/bin/env node

const { spawnSync } = require("child_process");
const {
  getPublisherAdminToken,
} = require("./admin-token-utils");

const DEFAULT_BASE_URL = "https://class.katelya.eu.org";

function parseArgs(argv) {
  const args = {};
  (argv || []).forEach((item) => {
    if (!item.startsWith("--")) return;
    const body = item.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) args[body.slice(0, eq)] = body.slice(eq + 1);
    else args[body] = true;
  });
  return args;
}

function joinUrl(baseUrl, ...parts) {
  const base = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/g, "");
  const suffix = parts.map((part) => String(part || "").replace(/^\/+|\/+$/g, "")).filter(Boolean).join("/");
  return `${base}/${suffix}`;
}

function detectGithubSecretName(secretName = "ADMIN_API_TOKEN") {
  try {
    const result = spawnSync("gh", ["secret", "list", "--json", "name"], {
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    });
    if (result.status !== 0 || result.error) return false;
    const secrets = JSON.parse(result.stdout || "[]");
    return Array.isArray(secrets) && secrets.some((item) => item && item.name === secretName);
  } catch (error) {
    return false;
  }
}

function status() {
  const tokenStatus = getPublisherAdminToken({ allowOracleAlias: false });
  return {
    localConfigured: Boolean(tokenStatus.token),
    githubSecretNameDetected: detectGithubSecretName("ADMIN_API_TOKEN"),
  };
}

async function verify(options = {}) {
  const tokenStatus = options.token
    ? { token: String(options.token), source: "explicit", terminalRefreshRecommended: false }
    : getPublisherAdminToken({ allowOracleAlias: false });
  if (!tokenStatus.token) {
    return {
      ok: false,
      status: 0,
      code: "ADMIN_API_TOKEN_REQUIRED",
      message: "尚未配置管理员同步令牌。请先运行：npm run publisher:token:setup",
    };
  }

  const baseUrl = options.baseUrl || process.env.FOSU_ADMIN_BASE_URL || process.env.ORACLE_API_BASE_URL || process.env.FOSU_API_BASE_URL || DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 15000));
  if (timer.unref) timer.unref();
  try {
    const response = await fetch(joinUrl(baseUrl, "api", "admin", "publisher", "receipt"), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Admin-Token": tokenStatus.token,
        Authorization: `Bearer ${tokenStatus.token}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch (error) {
      payload = null;
    }
    if (response.status === 200 && payload && payload.success === true) {
      return {
        ok: true,
        status: response.status,
        success: true,
        tokenSource: tokenStatus.source,
        terminalRefreshRecommended: Boolean(tokenStatus.terminalRefreshRecommended),
      };
    }
    if (response.status === 401) {
      return {
        ok: false,
        status: 401,
        code: "ADMIN_API_TOKEN_MISMATCH",
        message: "本机令牌与服务器不一致，请运行：npm run publisher:token:verify 或重新执行 publisher:token:setup -- --rotate",
      };
    }
    if (response.status === 503) {
      return {
        ok: false,
        status: 503,
        code: "SERVER_ADMIN_TOKEN_NOT_CONFIGURED",
        message: "服务器未配置管理员凭据，请确认 GitHub Actions Secret ADMIN_API_TOKEN 已配置并完成部署。",
      };
    }
    return {
      ok: false,
      status: response.status,
      code: payload && payload.code || `HTTP_${response.status}`,
      message: payload && payload.message || `unexpected HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      code: error.name === "AbortError" ? "ADMIN_TOKEN_VERIFY_TIMEOUT" : (error.code || "ADMIN_TOKEN_VERIFY_FAILED"),
      message: error.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.status) {
    const current = status();
    console.log(`localConfigured=${current.localConfigured ? "true" : "false"}`);
    console.log(`githubSecretNameDetected=${current.githubSecretNameDetected ? "true" : "false"}`);
    return 0;
  }
  const result = await verify({
    baseUrl: args["base-url"] || args.baseUrl,
    timeoutMs: args.timeout || args.timeoutMs,
  });
  if (result.terminalRefreshRecommended) {
    console.error("请关闭并重新打开 PowerShell，或设置当前进程环境变量。");
  }
  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exit(code);
  }).catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      code: error.code || "ADMIN_TOKEN_VERIFY_FAILED",
      message: error.message,
    }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  detectGithubSecretName,
  joinUrl,
  parseArgs,
  status,
  verify,
};
