const axios = require("axios");

const API_BASE = process.env.TEST_API_BASE || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || "test-admin-token";
process.env.NO_PROXY = "*";
process.env.no_proxy = "*";
axios.defaults.proxy = false;

const admin = axios.create({
  baseURL: API_BASE,
  proxy: false,
  headers: {
    Authorization: `Bearer ${ADMIN_TOKEN}`,
    "Content-Type": "application/json",
  },
  validateStatus: () => true,
});

const publicApi = axios.create({
  baseURL: API_BASE,
  proxy: false,
  validateStatus: () => true,
});

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  console.log("=== app-config / admin API smoke test ===");
  console.log("API_BASE:", API_BASE);

  const unauth = await publicApi.get("/api/admin/notices");
  assert(unauth.status === 401, "未登录访问 /api/admin/notices 应返回 401");

  const suffix = Date.now();
  const activeTitle = `自动化公告-${suffix}`;
  const disabledTitle = `停用公告-${suffix}`;
  const futureTitle = `未来公告-${suffix}`;
  const expiredTitle = `过期公告-${suffix}`;
  const createdIds = [];

  async function createNotice(payload) {
    const res = await admin.post("/api/admin/notices", payload);
    assert(res.status === 200 && res.data.success, `创建公告失败: ${JSON.stringify(res.data)}`);
    createdIds.push(res.data.item.id);
    return res.data.item;
  }

  try {
    await createNotice({
      title: activeTitle,
      content: "这条公告应出现在公开 app-config 中",
      type: "info",
      priority: "urgent",
      displayMode: "banner",
      targetPage: "all",
      enabled: true,
      closable: true,
      version: `test-${suffix}`,
    });
    await createNotice({
      title: disabledTitle,
      content: "disabled notice",
      enabled: false,
    });
    await createNotice({
      title: futureTitle,
      content: "future notice",
      enabled: true,
      startAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    await createNotice({
      title: expiredTitle,
      content: "expired notice",
      enabled: true,
      endAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    });

    const appConfig = await publicApi.get("/api/fosu/app-config");
    assert(appConfig.status === 200 && appConfig.data.success, "公开 app-config 应正常返回");
    const serialized = JSON.stringify(appConfig.data);
    assert(!serialized.includes(ADMIN_TOKEN), "公开 app-config 不应包含后台 token");
    const notices = appConfig.data.data.notices || [];
    assert(notices.some((item) => item.title === activeTitle), "公开 app-config 应包含启用且当前有效公告");
    assert(!notices.some((item) => item.title === disabledTitle), "公开 app-config 应过滤 disabled 公告");
    assert(!notices.some((item) => item.title === futureTitle), "公开 app-config 应过滤未到 startAt 的公告");
    assert(!notices.some((item) => item.title === expiredTitle), "公开 app-config 应过滤已过 endAt 的公告");

    const target = notices.find((item) => item.title === activeTitle);
    const edited = await admin.put(`/api/admin/notices/${target.id}`, {
      title: activeTitle,
      content: "公告已编辑",
      priority: "important",
      enabled: true,
    });
    assert(edited.status === 200 && edited.data.item.content === "公告已编辑", "应能编辑公告");

    const configRes = await admin.post("/api/admin/config", {
      dataVersion: {
        releaseNote: "自动化测试写入数据版本",
        dataSourceLabel: "自动化测试",
      },
    });
    assert(configRes.status === 200 && configRes.data.success, "应能更新数据版本配置");

    console.log("✅ app-config / admin API smoke test passed");
  } finally {
    for (const id of createdIds) {
      await admin.delete(`/api/admin/notices/${id}`);
    }
  }
}

run().catch((error) => {
  console.error("❌ test failed:", error.message);
  process.exit(1);
});
