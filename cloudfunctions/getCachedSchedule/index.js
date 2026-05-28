const cloud = require("wx-server-sdk");
const { getCachedSchedule } = require("../common/cache");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  const cached = getCachedSchedule(event || {});
  if (!cached) {
    return {
      success: false,
      needSync: true,
      message: "该课表尚未同步，请稍后或由管理员同步",
    };
  }
  return {
    success: true,
    source: "local-cache",
    schedule: cached,
    updatedAt: cached.updatedAt,
  };
};
