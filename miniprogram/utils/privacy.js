const platform = require("./platform");

function getRuntime() {
  return typeof wx !== "undefined" ? wx : null;
}

function getApi(name) {
  const runtime = getRuntime();
  if (!runtime) return null;
  const owner = platform.isMultiEndApp(runtime) ? runtime.miniapp : runtime;
  if (!owner || typeof owner[name] !== "function") return null;
  return owner[name].bind(owner);
}

function getPrivacySetting() {
  return new Promise((resolve) => {
    const isMultiEndApp = platform.isMultiEndApp(getRuntime());
    const api = getApi("getPrivacySetting");
    if (!api) {
      resolve({ needAuthorization: false, privacyContractName: "", unavailable: true });
      return;
    }
    api({
      success: (res) => resolve(res || { needAuthorization: false }),
      fail: () => resolve({ needAuthorization: isMultiEndApp, privacyContractName: "", unavailable: true }),
    });
  });
}

function requirePrivacyAuthorize() {
  return new Promise((resolve) => {
    const api = getApi(platform.isMultiEndApp(getRuntime()) ? "agreePrivacyAuthorization" : "requirePrivacyAuthorize");
    if (!api) {
      // Non-browse native privacy mode blocks app entry until consent, so an older SDK
      // without the query API has already enforced the gate before JavaScript starts.
      resolve(true);
      return;
    }
    api({
      success: () => resolve(true),
      fail: () => resolve(false),
    });
  });
}

async function ensurePrivacyAuthorized() {
  const setting = await getPrivacySetting();
  if (!setting || setting.needAuthorization !== true) return true;
  return requirePrivacyAuthorize();
}

function openPrivacyContract() {
  return new Promise((resolve, reject) => {
    const api = platform.isMultiEndApp(getRuntime()) ? null : getApi("openPrivacyContract");
    if (!api) {
      reject(new Error("OPEN_PRIVACY_CONTRACT_UNSUPPORTED"));
      return;
    }
    api({
      success: resolve,
      fail: reject,
    });
  });
}

module.exports = {
  ensurePrivacyAuthorized,
  getPrivacySetting,
  openPrivacyContract,
  requirePrivacyAuthorize,
};
