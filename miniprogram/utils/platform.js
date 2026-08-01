function callWx(name) {
  try {
    if (wx && typeof wx[name] === "function") {
      return wx[name]() || {};
    }
  } catch (error) {
    return {};
  }
  return {};
}

function getWxSystemInfo() {
  const windowInfo = callWx("getWindowInfo");
  const deviceInfo = callWx("getDeviceInfo");
  const appBaseInfo = callWx("getAppBaseInfo");
  const legacy = (!Object.keys(windowInfo).length && !Object.keys(deviceInfo).length && !Object.keys(appBaseInfo).length)
    ? callWx("getSystemInfoSync")
    : {};
  return Object.assign({}, legacy, windowInfo, deviceInfo, appBaseInfo);
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
    const runtime = wxLike || (typeof wx !== "undefined" ? wx : null);
    const account = runtime && typeof runtime.getAccountInfoSync === "function" ? runtime.getAccountInfoSync() : {};
    return normalizeMiniProgramEnvVersion(account && account.miniProgram && account.miniProgram.envVersion);
  } catch (error) {
    return "release";
  }
}

function isDeveloperEnv() {
  const info = getWxSystemInfo();
  const envVersion = getMiniProgramEnvVersion();
  return info.platform === "devtools" || envVersion === "develop" || envVersion === "trial";
}

module.exports = {
  getMiniProgramEnvVersion,
  getWxSystemInfo,
  isDeveloperEnv,
  normalizeMiniProgramEnvVersion,
};
