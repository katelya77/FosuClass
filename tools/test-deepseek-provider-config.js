const assert = require("assert");
const axios = require("../server/node_modules/axios");

delete process.env.AI_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.FOSUCLASS_DEEPSEEK_API_KEY;

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");

async function run() {
  await assert.rejects(
    () => deepseekProvider.generate({ message: "hello", toolResults: [] }),
    (error) => error && error.code === "NOT_CONFIGURED"
  );

  process.env["AI_" + "API_KEY"] = "unit-test-value";
  process.env.AI_MODEL = "deepseek-v4-flash";
  process.env.AI_TIMEOUT_MS = "12345";
  process.env.AI_MAX_TOKENS = "999";
  process.env.AI_TEMPERATURE = "0.2";
  process.env.AI_THINKING_ENABLED = "false";
  process.env.AI_PROVIDER_JSON_REPAIR = "true";

  const originalPost = axios.post;
  let captured = null;
  axios.post = async (url, body, options) => {
    captured = { url, body, options };
    return {
      data: {
        choices: [{
          message: {
            content: "```json\n{\"answer\":\"ok\",\"cards\":[],\"suggestions\":[]}\n```",
          },
        }],
      },
    };
  };

  try {
    const result = await deepseekProvider.generate({
      message: "现在有空教室吗？",
      intent: { name: "search_empty_rooms" },
      toolResults: [],
    });
    assert.strictEqual(result.provider, "deepseek");
    assert.strictEqual(result.answer, "ok");
    assert(captured.url.endsWith("/chat/completions"));
    assert.strictEqual(captured.body.stream, false);
    assert.strictEqual(captured.body.max_tokens, 999);
    assert.strictEqual(captured.body.temperature, 0.2);
    assert.deepStrictEqual(captured.body.response_format, { type: "json_object" });
    assert(!captured.body.thinking, "flash mode should not include thinking");
    assert.strictEqual(captured.options.timeout, 12345);
  } finally {
    axios.post = originalPost;
    delete process.env.AI_API_KEY;
  }

  console.log("test-deepseek-provider-config passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
