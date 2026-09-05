/**
 * 自定义 Provider（OpenAI / Anthropic 协议，CCSwitch 式）契约测试：
 * - customProviderStore：条目清洗 / 加密列表序列化 / 脱敏视图 / 合并保存 / 解析生效条目
 * - providerChainService：注册、别名、isProviderConfigured
 * - providerConfigService：saveCustomProvider / deleteCustomProvider / getStatus 脱敏暴露
 * 全部离线运行，不触达真实网络。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// 放在独立子目录内：runtimeStore 会 chmod 配置目录，直接落 /tmp 在 CI 会 EPERM。
const TEST_CONFIG_DIR = path.join(os.tmpdir(), `fosu-custom-providers-test-${process.pid}`);
process.env.FOSU_AI_PROVIDER_CONFIG_PATH = path.join(TEST_CONFIG_DIR, "ai-provider-config.json");
process.env.FOSU_AI_CONFIG_ENCRYPTION_KEY = "a".repeat(64);

const customProviderStore = require("../server/src/services/ai/customProviderStore");
const providerChainService = require("../server/src/services/ai/providerChainService");
const providerConfigService = require("../server/src/services/ai/providerConfigService");
const customOpenaiProvider = require("../server/src/services/ai/providers/customOpenaiProvider");
const customAnthropicProvider = require("../server/src/services/ai/providers/customAnthropicProvider");

function cleanup() {
  try { fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch (error) { /* ignore */ }
}

async function main() {
  cleanup();

  // group1: 条目清洗
  {
    const openai = customProviderStore.sanitizeEntry({
      label: "OpenRouter",
      protocol: "openai",
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: "sk-or-test-1234",
      model: "openai/gpt-4o-mini",
    });
    assert.strictEqual(openai.protocol, "openai", "g1 openai protocol");
    assert.strictEqual(openai.baseUrl, "https://openrouter.ai/api/v1", "g1 trailing slash stripped");
    assert.ok(openai.id.startsWith("cp_"), "g1 id generated");
    assert.strictEqual(openai.enabled, true, "g1 default enabled");
    assert.strictEqual(openai.strictJsonMode, true, "g1 default strictJsonMode");

    const claude = customProviderStore.sanitizeEntry({
      protocol: "claude",
      baseUrl: "https://api.anthropic.com",
      apiKey: "sk-ant-test",
      model: "claude-sonnet-4-5",
    });
    assert.strictEqual(claude.protocol, "anthropic", "g1 claude alias -> anthropic");
    assert.strictEqual(claude.baseUrl, "https://api.anthropic.com/v1", "g1 anthropic auto /v1");

    const insecure = customProviderStore.sanitizeEntry({ protocol: "openai", baseUrl: "http://evil.example.com/v1" });
    assert.strictEqual(insecure.baseUrl, "", "g1 non-https rejected");
    assert.ok(!customProviderStore.isEntryUsable(insecure), "g1 insecure not usable");
    console.log("  PASS group1 sanitize/normalize");
  }

  // group2: 列表序列化 + 脱敏视图不泄钥
  {
    const list = customProviderStore.upsertEntry("", {
      label: "A",
      protocol: "openai",
      baseUrl: "https://a.example.com/v1",
      apiKey: "sk-secret-aaaa",
      model: "m1",
    });
    const json = customProviderStore.serializeList(list);
    const view = customProviderStore.publicView(json);
    assert.strictEqual(view.length, 1, "g2 one entry");
    assert.strictEqual(view[0].apiKey, undefined, "g2 publicView has no apiKey field");
    assert.strictEqual(view[0].apiKeyLast4, "aaaa", "g2 last4 exposed");
    assert.ok(!JSON.stringify(view).includes("sk-secret"), "g2 no key leak in view JSON");
    console.log("  PASS group2 serialize/publicView redaction");
  }

  // group3: upsert 保留/清除密钥 + 删除 + 生效条目解析
  {
    let list = customProviderStore.upsertEntry("", {
      id: "cp_one",
      label: "One",
      protocol: "openai",
      baseUrl: "https://one.example.com/v1",
      apiKey: "sk-one-1111",
      model: "m1",
    });
    // 编辑时 apiKey 留空 = 保留
    list = customProviderStore.upsertEntry(list, { id: "cp_one", label: "One", protocol: "openai", baseUrl: "https://one.example.com/v1", model: "m2" });
    assert.strictEqual(list[0].apiKey, "sk-one-1111", "g3 blank key keeps previous");
    assert.strictEqual(list[0].model, "m2", "g3 model updated");
    // __clear__ 清除
    list = customProviderStore.upsertEntry(list, { id: "cp_one", protocol: "openai", baseUrl: "https://one.example.com/v1", apiKey: "__clear__", model: "m2" });
    assert.strictEqual(list[0].apiKey, "", "g3 __clear__ wipes key");
    assert.ok(!customProviderStore.isEntryUsable(list[0]), "g3 wiped key not usable");
    // 再加 anthropic 条目，resolveEntry 按协议与 activeId 解析
    list = customProviderStore.upsertEntry(list, {
      id: "cp_two",
      label: "Two",
      protocol: "anthropic",
      baseUrl: "https://two.example.com",
      apiKey: "sk-two-2222",
      model: "claude-x",
    });
    const runtimeConfig = {
      AI_CUSTOM_PROVIDERS: customProviderStore.serializeList(list),
      AI_CUSTOM_ACTIVE_ID: "cp_two",
    };
    const anthropic = customProviderStore.resolveEntry(runtimeConfig, "anthropic");
    assert.strictEqual(anthropic && anthropic.id, "cp_two", "g3 resolveEntry anthropic hit");
    const openai = customProviderStore.resolveEntry(runtimeConfig, "openai");
    assert.strictEqual(openai, null, "g3 openai unresolved (key wiped)");
    list = customProviderStore.removeEntry(list, "cp_one");
    assert.strictEqual(list.length, 1, "g3 removeEntry");
    console.log("  PASS group3 upsert/remove/resolve");
  }

  // group4: chain 注册 + isProviderConfigured
  {
    assert.strictEqual(providerChainService.normalizeProviderName("custom-openai"), "custom-openai", "g4 custom-openai canonical");
    assert.strictEqual(providerChainService.normalizeProviderName("openai-compatible"), "custom-openai", "g4 openai-compatible alias");
    assert.strictEqual(providerChainService.normalizeProviderName("anthropic"), "custom-anthropic", "g4 anthropic alias");
    assert.strictEqual(providerChainService.normalizeProviderName("claude"), "custom-anthropic", "g4 claude alias");
    const runtimeConfig = {
      AI_CUSTOM_PROVIDERS: customProviderStore.serializeList([{
        id: "cp_x",
        label: "X",
        protocol: "openai",
        baseUrl: "https://x.example.com/v1",
        apiKey: "sk-x-1234",
        model: "mx",
        enabled: true,
      }]),
      AI_CUSTOM_ACTIVE_ID: "",
    };
    assert.strictEqual(providerChainService.isProviderConfigured("custom-openai", runtimeConfig), true, "g4 custom-openai configured");
    assert.strictEqual(providerChainService.isProviderConfigured("custom-anthropic", runtimeConfig), false, "g4 custom-anthropic not configured");
    assert.strictEqual(providerChainService.getProviderModule("custom-openai").name, "custom-openai", "g4 module resolve");
    console.log("  PASS group4 chain registration");
  }

  // group5: provider 未配置时 fail-closed（NOT_CONFIGURED，不发请求）
  {
    let openaiError = null;
    try {
      await customOpenaiProvider.generate({ message: "hi", intent: null, toolResults: [], providerRuntimeConfig: { AI_CUSTOM_PROVIDERS: "" } });
    } catch (error) {
      openaiError = error;
    }
    assert.strictEqual(openaiError && openaiError.code, "NOT_CONFIGURED", "g5 custom-openai fail-closed");
    let anthropicError = null;
    try {
      await customAnthropicProvider.generateStructured({ messages: [], providerRuntimeConfig: { AI_CUSTOM_PROVIDERS: "" } });
    } catch (error) {
      anthropicError = error;
    }
    assert.strictEqual(anthropicError && anthropicError.code, "NOT_CONFIGURED", "g5 custom-anthropic fail-closed");
    const probe = await customOpenaiProvider.testConnection({ providerRuntimeConfig: { AI_CUSTOM_PROVIDERS: "" } });
    assert.strictEqual(probe.ok, false, "g5 probe not ok");
    assert.strictEqual(probe.code, "NOT_CONFIGURED", "g5 probe code");
    console.log("  PASS group5 fail-closed without entry");
  }

  // group6: config service 保存/删除 + getStatus 脱敏
  {
    providerConfigService.saveCustomProvider({
      entry: {
        id: "cp_admin",
        label: "AdminEntry",
        protocol: "openai",
        baseUrl: "https://admin.example.com/v1",
        apiKey: "sk-admin-9999",
        model: "test-model",
      },
      setActive: true,
    });
    const status = providerConfigService.getStatus("trial");
    const entries = status.customProviders || [];
    assert.strictEqual(entries.length, 1, "g6 one entry in status");
    assert.strictEqual(entries[0].label, "AdminEntry", "g6 label");
    assert.strictEqual(entries[0].apiKey, undefined, "g6 status redacted");
    assert.strictEqual(entries[0].apiKeyLast4, "9999", "g6 last4");
    assert.strictEqual(entries[0].usable, true, "g6 usable");
    // 存储文件里必须是密文
    const rawOnDisk = fs.readFileSync(process.env.FOSU_AI_PROVIDER_CONFIG_PATH, "utf8");
    assert.ok(!rawOnDisk.includes("sk-admin-9999"), "g6 disk has no plaintext key");
    assert.ok(rawOnDisk.includes("enc:v1:"), "g6 disk encrypted");
    // active id 已设置（运行时配置层）
    const runtimeConfig = providerConfigService.getRuntimeConfigForEnvironment("trial");
    const resolved = customProviderStore.resolveEntry(runtimeConfig, "openai");
    assert.strictEqual(resolved && resolved.id, "cp_admin", "g6 resolveEntry via runtime config");
    // fetch-models 缺参数 fail fast
    let fetchError = null;
    try {
      await providerConfigService.fetchCustomProviderModels({ protocol: "openai", baseUrl: "", apiKey: "" });
    } catch (error) {
      fetchError = error;
    }
    assert.strictEqual(fetchError && fetchError.code, "bad_request", "g6 fetch-models validates input");
    providerConfigService.deleteCustomProvider({ id: "cp_admin" });
    const after = providerConfigService.getStatus("trial");
    assert.strictEqual((after.customProviders || []).length, 0, "g6 deleted");
    console.log("  PASS group6 config service save/delete/redaction");
  }

  // group7: normalizeProvider / chain 名白名单（public 锁死不受影响）
  {
    const status = providerConfigService.getStatus("public");
    assert.strictEqual(status.provider, "mock", "g7 public locked to mock");
    const auth = providerConfigService.getAuthoritativeProviderConfig("public");
    assert.deepStrictEqual(auth.effectiveChain, ["mock"], "g7 public chain mock only");
    console.log("  PASS group7 public safety invariant");
  }

  // group7b: 通用 /models 响应兼容 + OpenRouter 免费文本模型目录筛选
  {
    const axios = require("../server/node_modules/axios");
    const originalGet = axios.get;
    const calls = [];
    axios.get = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes("openrouter.ai")) {
        return {
          data: {
            data: [
              {
                id: "vendor/strong-text:free",
                name: "Strong Text (free)",
                context_length: 131072,
                pricing: { prompt: "0", completion: "0" },
                architecture: { output_modalities: ["text"] },
                supported_parameters: ["response_format", "structured_outputs", "tools"]
              },
              {
                id: "vendor/basic-text:free",
                name: "Basic Text (free)",
                context_length: 32768,
                pricing: { prompt: "0", completion: "0" },
                architecture: { output_modalities: ["text"] },
                supported_parameters: []
              },
              {
                id: "openrouter/free",
                name: "OpenRouter Free Models Router",
                context_length: 16384,
                pricing: { prompt: "0", completion: "0" },
                architecture: { output_modalities: ["text"] },
                supported_parameters: ["response_format"]
              },
              {
                id: "vendor/embedding:free",
                name: "Embedding (free)",
                pricing: { prompt: "0", completion: "0" },
                architecture: { output_modalities: ["embeddings"] }
              },
              {
                id: "vendor/paid-chat",
                name: "Paid chat",
                pricing: { prompt: "0.000001", completion: "0.000001" },
                architecture: { output_modalities: ["text"] }
              },
              {
                id: "vendor/expired:free",
                name: "Expired (free)",
                expiration_date: "2020-01-01T00:00:00.000Z",
                pricing: { prompt: "0", completion: "0" },
                architecture: { output_modalities: ["text"] }
              }
            ]
          }
        };
      }
      return { data: { data: { models: [{ id: "deepseek-chat" }, { model: "deepseek-reasoner" }, "gateway-model"] } } };
    };
    try {
      const generic = await customProviderStore.fetchModelList({
        protocol: "openai",
        baseUrl: "https://newapi.example.com/v1",
        apiKey: "sk-test-only"
      });
      assert.deepStrictEqual(generic.models, ["deepseek-chat", "deepseek-reasoner", "gateway-model"], "g7b common NewAPI/Sub2API shapes normalized");
      assert.strictEqual(generic.source, "provider-models", "g7b generic source");

      const openrouter = await customProviderStore.fetchModelList({
        protocol: "openai",
        baseUrl: "https://openrouter.ai/api/v1",
        catalog: "openrouter-free"
      });
      assert.deepStrictEqual(openrouter.models, ["vendor/strong-text:free", "openrouter/free", "vendor/basic-text:free"], "g7b filters paid, expired and non-text models");
      assert.strictEqual(openrouter.items[0].supportsStructured, true, "g7b structured capability exposed");
      assert.strictEqual(openrouter.items[0].supportsJsonSchema, true, "g7b strict JSON-Schema capability exposed");
      assert.strictEqual(openrouter.items[0].supportsTools, true, "g7b tool capability exposed");
      assert.deepStrictEqual(openrouter.recommendedModels, ["vendor/strong-text:free", "openrouter/free"], "g7b fast strict JSON-Schema model precedes the durable free router fallback");
      assert.strictEqual(new Set(openrouter.recommendedModels).size, openrouter.recommendedModels.length, "g7b router must not be duplicated when the upstream catalogue also lists it");
      assert.ok(!calls[1].options.headers.Authorization, "g7b public OpenRouter catalog does not require or invent a key");

      const throughService = await providerConfigService.fetchProviderModels({
        provider: "openrouter",
        environment: "trial",
        baseUrl: "https://openrouter.ai/api/v1"
      });
      assert.strictEqual(throughService.source, "openrouter-free", "g7b config service selects OpenRouter free catalog");
      console.log("  PASS group7b generic/OpenRouter model discovery");
    } finally {
      axios.get = originalGet;
    }
  }

  // group8: 回复阶段对话历史注入（三协议共用 buildHistoryMessages 口径）
  {
    const axios = require("../server/node_modules/axios");
    const deepseekProvider = require("../server/src/services/ai/providers/deepseekProvider");
    const calls = [];
    const originalPost = axios.post;
    axios.post = async (url, body) => {
      const payload = JSON.stringify({ answer: "ok", cards: [], suggestions: [] });
      calls.push({ url: String(url), body });
      if (/\/messages$/.test(String(url))) {
        return { data: { content: [{ type: "text", text: payload }] } };
      }
      return { data: { choices: [{ message: { content: payload } }] } };
    };
    try {
      const openaiConfig = {
        AI_CUSTOM_PROVIDERS: customProviderStore.serializeList([{
          id: "cp_h1", label: "H", protocol: "openai",
          baseUrl: "https://h.example.com/v1", apiKey: "sk-h-1234", model: "mh", enabled: true,
        }]),
        AI_CUSTOM_ACTIVE_ID: "cp_h1",
      };
      const openaiResult = await customOpenaiProvider.generate({
        message: "明天呢",
        intent: { name: "query_courses" },
        toolResults: [],
        history: [
          { role: "user", content: "今天有什么课" },
          { role: "assistant", content: "今天有三节课" },
          { role: "user", content: "明天呢" },
        ],
        providerRuntimeConfig: openaiConfig,
      });
      assert.strictEqual(openaiResult.answer, "ok", "g8 openai answer");
      const openaiBody = calls[calls.length - 1].body;
      assert.strictEqual(openaiBody.messages[0].role, "system", "g8 openai system first");
      assert.deepStrictEqual(
        openaiBody.messages.slice(1, -1),
        [
          { role: "user", content: "今天有什么课" },
          { role: "assistant", content: "今天有三节课" },
        ],
        "g8 openai history injected, trailing duplicate of current message dropped"
      );
      const openaiLast = openaiBody.messages[openaiBody.messages.length - 1];
      assert.strictEqual(openaiLast.role, "user", "g8 openai last is user");
      assert.ok(openaiLast.content.includes("明天呢"), "g8 openai last user carries current message");

      const anthropicConfig = {
        AI_CUSTOM_PROVIDERS: customProviderStore.serializeList([{
          id: "cp_h2", label: "HA", protocol: "anthropic",
          baseUrl: "https://ha.example.com", apiKey: "sk-ha-1234", model: "claude-x", enabled: true,
        }]),
        AI_CUSTOM_ACTIVE_ID: "cp_h2",
      };
      await customAnthropicProvider.generate({
        message: "后天呢",
        intent: { name: "query_courses" },
        toolResults: [],
        history: [
          { role: "user", content: "u1" },
          { role: "user", content: "u2" },
          { role: "assistant", content: "a1" },
        ],
        providerRuntimeConfig: anthropicConfig,
      });
      const anthBody = calls[calls.length - 1].body;
      assert.strictEqual(anthBody.messages[0].role, "user", "g8 anthropic first must be user");
      for (let i = 1; i < anthBody.messages.length; i += 1) {
        assert.notStrictEqual(anthBody.messages[i].role, anthBody.messages[i - 1].role, "g8 anthropic roles alternate");
      }
      assert.ok(anthBody.messages[0].content.includes("u1\nu2"), "g8 anthropic consecutive users merged");
      assert.ok(anthBody.messages[anthBody.messages.length - 1].content.includes("后天呢"), "g8 anthropic last carries current message");

      await deepseekProvider.generate({
        message: "大后天呢",
        intent: { name: "query_courses" },
        toolResults: [],
        history: [{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }],
        providerRuntimeConfig: { AI_API_KEY: "sk-test-1234", AI_BASE_URL: "https://ds.example.com/v1" },
      });
      const dsBody = calls[calls.length - 1].body;
      assert.deepStrictEqual(
        dsBody.messages.slice(1, -1),
        [{ role: "user", content: "u1" }, { role: "assistant", content: "a1" }],
        "g8 deepseek history injected"
      );
      console.log("  PASS group8 response-stage history injection");
    } finally {
      axios.post = originalPost;
    }
  }

  cleanup();
  console.log("test-custom-providers: PASS");
}

main().catch((error) => {
  cleanup();
  console.error("test-custom-providers: FAIL");
  console.error(error);
  process.exit(1);
});
