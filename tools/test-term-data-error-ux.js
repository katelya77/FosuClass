"use strict";

const assert = require("assert");
const mockEnv = require("./mock-env");

mockEnv.clearStorage();
let modal = null;
global.wx.onModal = (options) => { modal = options; };
global.wx.mockRequest = (options) => {
  options.success({
    statusCode: 409,
    data: {
      success: false,
      code: "TERM_DATA_MISSING",
      reasonCode: "TERM_DATA_MISSING",
      message: "TERM_DATA_MISSING",
    },
  });
};

const request = require("../miniprogram/utils/request");

request.get("/api/fosu/release-pack/search", {
  term: "2026-2027-1",
  releaseVersion: "cutover-test",
}, {
  showLoading: false,
  retries: 0,
  suppressWarn: true,
})
  .then(() => {
    throw new Error("TERM_DATA_MISSING response must reject");
  })
  .catch((error) => {
    assert.strictEqual(error.code, "TERM_DATA_MISSING");
    assert(!error.message.includes("TERM_DATA_MISSING"), "technical term error must not reach users");
    assert(modal && modal.content === error.message, "modal must use the translated error message");
    assert(/课表|版本|更新/.test(modal.content), "translated message should explain schedule cutover recovery");
    console.log("test-term-data-error-ux passed");
  });
