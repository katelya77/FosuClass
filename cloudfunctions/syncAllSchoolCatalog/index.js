const cloud = require("wx-server-sdk");
const { safeLog } = require("../common/safeLogger");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

exports.main = async (event) => {
  safeLog("sync-all-school-catalog-called", { event });
  return {
    success: true,
    message: "syncAllSchoolCatalog 接口调用成功。当前系统设计优先实时查询及缓存，无需全量离线爬取。",
    timestamp: new Date().toISOString(),
  };
};
