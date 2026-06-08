const assert = require("assert");
const axios = require("../server/node_modules/axios");

process.env.AI_PROVIDER_IGNORE_ENV_FILE = "true";
process.env.AI_API_KEY = "unit-test-provider-key-not-real";
process.env.AI_MODEL = "deepseek-v4-flash";
process.env.AI_PROVIDER_JSON_REPAIR = "true";
process.env.DEEPSEEK_STRICT_JSON_MODE = "false";
process.env.AI_THINKING_ENABLED = "false";

const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");

async function run() {
  assert.strictEqual(deepseekProvider.shouldUseJsonMode({ name: "project_qa" }), false);
  assert.strictEqual(deepseekProvider.shouldUseJsonMode({ name: "search_empty_rooms" }), true);

  const originalPost = axios.post;
  const originalWarn = console.warn;
  const calls = [];
  console.warn = () => {};
  axios.post = async (url, body, options) => {
    calls.push({ url, body, options });
    if (body.messages[0].content.includes("不要输出 JSON")) {
      return {
        data: {
          choices: [{ message: { content: "FosuClass 是课表与校园空间查询小程序。" } }],
        },
      };
    }
    return {
      data: {
        choices: [{ message: { content: "{\"answer\":\"ok\",\"cards\":[],\"suggestions\":[]}" } }],
      },
    };
  };

  try {
    const textResult = await deepseekProvider.generate({
      message: "FosuClass 是什么？",
      intent: { name: "project_qa" },
      toolResults: [],
      projectKnowledge: "FosuClass 项目知识",
    });
    assert.strictEqual(textResult.provider, "deepseek");
    assert.strictEqual(textResult.cards[0].type, "generic");
    assert(!calls[0].body.response_format, "project_qa text mode should not force response_format");

    const jsonResult = await deepseekProvider.generate({
      message: "现在有空教室吗？",
      intent: { name: "search_empty_rooms" },
      toolResults: [],
    });
    assert.strictEqual(jsonResult.answer, "ok");
    assert.deepStrictEqual(calls[1].body.response_format, { type: "json_object" });
    assert(/json/.test(calls[1].body.messages[0].content), "json mode prompt should mention json");
    assert(calls[1].body.messages[0].content.includes('{"answer"'), "json mode prompt should include a short example");

    axios.post = async () => {
      const error = new Error("bad request");
      error.code = "ERR_BAD_REQUEST";
      error.response = { status: 400, data: { error: { message: "bad request" } } };
      throw error;
    };
    await assert.rejects(
      () => deepseekProvider.generate({
        message: "FosuClass 是什么？",
        intent: { name: "project_qa" },
        toolResults: [],
      }),
      (error) => {
        assert.strictEqual(error.code, "provider_bad_request");
        assert.deepStrictEqual(Object.keys(error.diagnostics).sort(), [
          "baseUrlHost",
          "model",
          "responseStatus",
          "thinkingEnabled",
          "useJsonMode",
        ]);
        const text = JSON.stringify(error.diagnostics);
        assert(!text.includes(process.env.AI_API_KEY), "diagnostics must not include keys");
        assert(!text.includes("FosuClass 是什么"), "diagnostics must not include prompts");
        return true;
      }
    );
  } finally {
    axios.post = originalPost;
    console.warn = originalWarn;
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER_IGNORE_ENV_FILE;
    delete process.env.DEEPSEEK_STRICT_JSON_MODE;
    delete process.env.AI_PROVIDER_JSON_REPAIR;
    delete process.env.AI_THINKING_ENABLED;
  }

  console.log("test-deepseek-provider-json-text-modes passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
