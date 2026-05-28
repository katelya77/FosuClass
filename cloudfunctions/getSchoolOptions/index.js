const cloud = require("wx-server-sdk");
const { getSchoolOptions } = require("../common/cache");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async () => ({
  success: true,
  source: "local-cache",
  options: getSchoolOptions(),
});
