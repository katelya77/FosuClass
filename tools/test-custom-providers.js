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

  cleanup();
  console.log("test-custom-providers: PASS");
}

main().catch((error) => {
  cleanup();
  console.error("test-custom-providers: FAIL");
  console.error(error);
  process.exit(1);
});
