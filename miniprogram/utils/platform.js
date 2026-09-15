function getRuntime(wxLike) {
  if (wxLike) return wxLike;
  return typeof wx !== "undefined" ? wx : null;
}

function callWx(name, wxLike) {
  try {
    const runtime = getRuntime(wxLike);
    if (runtime && typeof runtime[name] === "function") {
      return runtime[name]() || {};
    }
  } catch (error) {
    return {};
  }
  return {};
}

function getWxSystemInfo(wxLike) {
  const windowInfo = callWx("getWindowInfo", wxLike);
  const deviceInfo = callWx("getDeviceInfo", wxLike);
  const appBaseInfo = callWx("getAppBaseInfo", wxLike);
  const legacy = (!Object.keys(windowInfo).length && !Object.keys(deviceInfo).length && !Object.keys(appBaseInfo).length)
    ? callWx("getSystemInfoSync", wxLike)
    : {};
  return Object.assign({}, legacy, windowInfo, deviceInfo, appBaseInfo);
}

function getAccountInfo(wxLike) {
  return callWx("getAccountInfoSync", wxLike);
}

function isMultiEndApp(wxLike) {
  const appBaseInfo = callWx("getAppBaseInfo", wxLike);
  const hostEnv = String(appBaseInfo && appBaseInfo.host && appBaseInfo.host.env || "").toUpperCase();
  if (hostEnv === "SAAASDK") return true;

  // Some early multi-end SDK builds expose miniapp account metadata before host.env.
  const account = getAccountInfo(wxLike);
  return Boolean(account && account.miniapp && !account.miniProgram);
}

function getRuntimePlatform(wxLike) {
  if (!isMultiEndApp(wxLike)) return "miniprogram";
  const info = getWxSystemInfo(wxLike);
  const platform = String(info.platform || info.system || "").toLowerCase();
  if (/harmony|ohos/.test(platform)) return "harmonyos";
  if (/ios|iphone|ipad/.test(platform)) return "ios";
  if (/android/.test(platform)) return "android";
  return "multi-end";
}

function normalizeMiniProgramEnvVersion(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "develop" || normalized === "development" || normalized === "dev" || normalized === "devtools") {
    return "develop";
  }
  if (normalized === "trial") return "trial";
  return "release";
}

function getMiniProgramEnvVersion(wxLike) {
  try {
    const account = getAccountInfo(wxLike);
    const multiEndEnvVersion = account && account.miniapp && account.miniapp.envVersion;
    const miniProgramEnvVersion = account && account.miniProgram && account.miniProgram.envVersion;
    return normalizeMiniProgramEnvVersion(
      isMultiEndApp(wxLike) ? multiEndEnvVersion || miniProgramEnvVersion : miniProgramEnvVersion
    );
  } catch (error) {
    return "release";
  }
}

function isDeveloperEnv(wxLike) {
  const info = getWxSystemInfo(wxLike);
  const envVersion = getMiniProgramEnvVersion(wxLike);
  return info.platform === "devtools" || envVersion === "develop" || envVersion === "trial";
}

module.exports = {
  getAccountInfo,
  getMiniProgramEnvVersion,
  getRuntimePlatform,
  getWxSystemInfo,
  isDeveloperEnv,
  isMultiEndApp,
  normalizeMiniProgramEnvVersion,
};
