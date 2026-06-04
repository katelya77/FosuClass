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

function getMiniProgramEnvVersion() {
  try {
    const account = wx && typeof wx.getAccountInfoSync === "function" ? wx.getAccountInfoSync() : {};
    return account && account.miniProgram && account.miniProgram.envVersion || "release";
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
};
