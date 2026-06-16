const assert = require("assert");
const express = require("../server/node_modules/express");

process.env.AI_AGENT_ENABLED = "false";
process.env.AI_PROVIDER = "deepseek";

const aiRouter = require("../server/src/routes/ai");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use("/api/ai", aiRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/ai/agent/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "怎么导入个人课表",
        context: { timezone: "Asia/Shanghai" },
      }),
    });
    assert.strictEqual(response.status, 200);
    const data = await response.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(typeof data.answer, "string");
    assert(Array.isArray(data.cards) && data.cards.length > 0, "cards must be returned");
    assert.notStrictEqual(data.metrics.externalProviderUsed, true, "AI_AGENT_ENABLED=false must not call an external provider");
    assert.notStrictEqual(data.safety.externalProviderUsed, true, "public safety contract must show no external provider");
  } finally {
    server.close();
  }

  console.log("test-ai-agent-mock-fallback passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
