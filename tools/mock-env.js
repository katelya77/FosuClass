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
  getSystemInfoSync: () => ({ platform: "devtools" }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } })
};

// 拦截 Page 定义
let lastPageConfig = null;
global.Page = (config) => {
  lastPageConfig = config;
};

// Mock 微信 App
global.getApp = () => ({
  globalData: {}
});

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

module.exports = {
  storage: STORAGE_MAP,
  createPageInstance,
  clearStorage: () => STORAGE_MAP.clear()
};
