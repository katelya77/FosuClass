#!/usr/bin/env node
const assert = require("assert");
const http = require("http");
const cozeProvider = require("../server/src/services/ai/providers/cozeProvider");

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res, server));
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

async function run() {
  // expired skip
  assert.strictEqual(cozeProvider.isExpired({ COZE_EXPIRES_AT: "2000-01-01T00:00:00.000Z" }), true);
  assert.strictEqual(cozeProvider.isEnabled({
    COZE_ENABLED: "true",
    COZE_API_KEY: "k",
    COZE_BOT_ID: "b",
    COZE_EXPIRES_AT: "2000-01-01T00:00:00.000Z",
  }), false);

  // principal-based user id isolation
  const u1 = cozeProvider.buildPseudoUserId({ principalKey: "p1", runtimeMode: "trial", deployEnv: "test" });
  const u2 = cozeProvider.buildPseudoUserId({ principalKey: "p2", runtimeMode: "trial", deployEnv: "test" });
  assert.notStrictEqual(u1, u2);
  assert.ok(u1.startsWith("fosu-"));
  assert.ok(!u1.includes("openid"));

  // sensitive context must not include student id
  const safe = cozeProvider.buildSafeUserContent({
    message: "你好",
    intent: { name: "conversational_help" },
    toolResults: [{ name: "get_today_courses", status: "success", summary: "3 courses" }],
    context: { conversationSummary: "追问周三" },
  });
  assert.ok(!/password|cookie|token|学号/i.test(safe));

  let sawUserId = "";
  const { server, baseUrl } = await startMockServer(async (req, res) => {
    const url = req.url || "";
    if (req.method === "POST" && url.startsWith("/v3/chat")) {
      const body = JSON.parse(await readBody(req));
      sawUserId = body.user_id || "";
      assert.ok(body.bot_id);
      assert.ok(Array.isArray(body.additional_messages));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: {
          chat_id: "chat-1",
          conversation_id: "conv-1",
          status: "in_progress",
        },
      }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/v3/chat/retrieve")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: {
          chat_id: "chat-1",
          conversation_id: "conv-1",
          status: "completed",
        },
      }));
      return;
    }
    if (req.method === "GET" && url.startsWith("/v3/chat/message/list")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        data: [
          { role: "assistant", type: "answer", content: "小佛增强能力连接成功" },
        ],
      }));
      return;
    }
    res.writeHead(404);
    res.end("missing");
  });

  try {
    const result = await cozeProvider.generate({
      message: "你好",
      intent: { name: "conversational_help" },
      toolResults: [],
      principal: { principalKey: "principal-a", runtimeMode: "trial", deployEnv: "test" },
      providerRuntimeConfig: {
        COZE_ENABLED: "true",
        COZE_API_KEY: "test-token",
        COZE_BOT_ID: "bot-1",
        COZE_API_BASE_URL: baseUrl,
        COZE_CHAT_ENDPOINT: "/v3/chat",
        COZE_POLL_INTERVAL_MS: "50",
        COZE_POLL_MAX_ATTEMPTS: "5",
        COZE_TIMEOUT_MS: "3000",
      },
    });
    assert.strictEqual(result.provider, "coze");
    assert.ok(String(result.answer).includes("小佛增强能力连接成功"));
    assert.ok(sawUserId.startsWith("fosu-"));
    assert.notStrictEqual(sawUserId, "fosuclass-user");

    // 401 mapping
    const { server: s401, baseUrl: b401 } = await startMockServer((req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 401, msg: "unauthorized" }));
    });
    try {
      await cozeProvider.generate({
        message: "hi",
        intent: { name: "conversational_help" },
        providerRuntimeConfig: {
          COZE_ENABLED: "true",
          COZE_API_KEY: "bad",
          COZE_BOT_ID: "bot",
          COZE_API_BASE_URL: b401,
          COZE_CHAT_ENDPOINT: "/v3/chat",
        },
      });
      assert.fail("expected 401");
    } catch (error) {
      assert.strictEqual(error.code, "unauthorized");
    } finally {
      s401.close();
    }

    // expired throws
    try {
      await cozeProvider.generate({
        message: "hi",
        providerRuntimeConfig: {
          COZE_ENABLED: "true",
          COZE_API_KEY: "k",
          COZE_BOT_ID: "b",
          COZE_EXPIRES_AT: "2000-01-01T00:00:00.000Z",
          COZE_API_BASE_URL: baseUrl,
        },
      });
      assert.fail("expected expired");
    } catch (error) {
      assert.strictEqual(error.code, "PROVIDER_EXPIRED");
    }
  } finally {
    server.close();
  }

  console.log("test-coze-provider-v3: PASS");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
