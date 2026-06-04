// tools/mock-env.js
const STORAGE_MAP = new Map();

global.wx = {
  request: (options) => {
    if (global.wx.mockRequest) {
      return global.wx.mockRequest(options);
    }
    options.success({ statusCode: 200, data: { success: true } });
  },
  getStorageSync: (key) => {
    return STORAGE_MAP.get(key);
  },
  setStorageSync: (key, val) => {
    STORAGE_MAP.set(key, val);
  },
  removeStorageSync: (key) => {
    STORAGE_MAP.delete(key);
  },
  getStorageInfoSync: () => {
    return { keys: Array.from(STORAGE_MAP.keys()) };
  },
  showLoading: () => {},
  hideLoading: () => {},
  showToast: (opt) => {
    if (global.wx.onToast) global.wx.onToast(opt);
  },
  showModal: (opt) => {
    if (global.wx.onModal) global.wx.onModal(opt);
  },
  setClipboardData: (opt) => {
    STORAGE_MAP.set("__clipboard", opt && opt.data);
    if (opt && typeof opt.success === "function") opt.success();
  },
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }),
  getDeviceInfo: () => ({ platform: "devtools", system: "iOS 17" }),
  getAppBaseInfo: () => ({ SDKVersion: "3.8.0" }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } })
};

// 拦截 Page 定义
let lastPageConfig = null;
let lastAppConfig = null;
global.Page = (config) => {
  lastPageConfig = config;
};

global.App = (config) => {
  lastAppConfig = config;
};

// Mock 微信 App
let currentApp = { globalData: {} };
global.getApp = () => currentApp;

function createPageInstance() {
  if (!lastPageConfig) {
    throw new Error("Page not registered. Please require school.js first.");
  }
  
  const instance = Object.assign({
    data: JSON.parse(JSON.stringify(lastPageConfig.data || {}))
  }, lastPageConfig);
  
  instance.setData = function(patch, cb) {
    Object.assign(this.data, patch);
    if (cb) cb();
  };
  
  return instance;
}

function createAppInstance() {
  if (!lastAppConfig) {
    throw new Error("App not registered. Please require app.js first.");
  }
  currentApp = Object.assign({
    globalData: JSON.parse(JSON.stringify(lastAppConfig.globalData || {}))
  }, lastAppConfig);
  return currentApp;
}

module.exports = {
  storage: STORAGE_MAP,
  createPageInstance,
  createAppInstance,
  clearStorage: () => STORAGE_MAP.clear()
};
