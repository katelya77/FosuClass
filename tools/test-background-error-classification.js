const assert = require("assert");

const store = {};
global.wx = {
  getStorageSync(key) { return store[key]; },
  setStorageSync(key, value) { store[key] = value; },
  request(options) {
    setTimeout(() => options.fail({ errMsg: "request:fail timeout" }), 1);
  },
  showLoading() {},
  hideLoading() {},
  showToast() {},
};

const request = require("../miniprogram/utils/request");

request.get("/api/fosu/periodic-data", {}, { showLoading: false, silentError: true, timeout: 10, retries: 0 })
  .catch(() => {
    const diag = request.getRequestDiagnostics();
    assert(diag.backgroundLastError, "periodic-data error should be background");
    assert(!diag.criticalLastError, "background error should not become critical");
    console.log("test-background-error-classification passed");
  });
