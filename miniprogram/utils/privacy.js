function canUse(name) {
  return typeof wx !== "undefined" && wx && typeof wx[name] === "function";
}

function getPrivacySetting() {
  return new Promise((resolve) => {
    if (!canUse("getPrivacySetting")) {
      resolve({ needAuthorization: false, privacyContractName: "" });
      return;
    }
    wx.getPrivacySetting({
      success: (res) => resolve(res || { needAuthorization: false }),
      fail: () => resolve({ needAuthorization: false, privacyContractName: "" }),
    });
  });
}

function requirePrivacyAuthorize() {
  return new Promise((resolve) => {
    if (!canUse("requirePrivacyAuthorize")) {
      resolve(true);
      return;
    }
    wx.requirePrivacyAuthorize({
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
    if (!canUse("openPrivacyContract")) {
      reject(new Error("OPEN_PRIVACY_CONTRACT_UNSUPPORTED"));
      return;
    }
    wx.openPrivacyContract({
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
