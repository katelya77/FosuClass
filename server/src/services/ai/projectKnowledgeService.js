const PROJECT_KNOWLEDGE_PROMPT = [
  "FosuClass（佛课小表）是面向佛山大学学生的微信小程序和配套 Node.js 后端。",
  "小程序核心页面包括：首页课表、全校查询、今日安排、教学周历、设置、AI 助手、个人 XLS 导入、空教室、自定义课程和课表详情。",
  "课程、教师、教室、空教室和数据状态事实必须来自确定性工具、Release Pack、全校索引、空教室索引或本地 XLS 课表摘要，不能由模型编造。",
  "后端能力包括 Release Pack 构建与发布、Staging 上传、Admin 后台、AI Provider 配置、个人 XLS 导入解析、全校索引和空教室索引。",
  "AI Provider 支持 mock、DeepSeek 和 Coze。auto 模式下，确定性课表查询默认走本地工具；项目知识问答、自然聊天、使用引导和复杂解释可以调用 DeepSeek/Coze。",
  "合规边界：AI 不接收学号、姓名、密码、Cookie、JSESSIONID、ticket、Authorization、token、原始 XLS 内容、文件 base64 或任何密钥。",
  "个人课表方案是 XLS-only：用户从 100 网导出 XLS，在小程序导入；系统只解析课程名、教师、教室、星期、节次和教学周等最小字段。",
  "新学期同步链路：维护者在校园网本地采集公开课表，生成 staging，上传到后端，管理员在后台校验 counts/diff/健康状态，发布 Release Pack，小程序刷新 active release。",
  "比赛展示重点：工具优先、事实可追溯、无 key 可演示、DeepSeek 只做脱敏后的项目解释和复杂总结，课程事实仍由工具验证。",
].join("\n");

function getProjectKnowledgePrompt() {
  return PROJECT_KNOWLEDGE_PROMPT;
}

function getProjectCapabilityCards() {
  return [{
    type: "generic",
    title: "FosuClass 能做什么",
    subtitle: "项目知识来自内置摘要；课程事实仍由工具核验",
    badges: ["XLS-only", "工具优先", "Release Pack"],
    items: [
      { title: "课表与今日安排", subtitle: "首页、今日页和 AI 今日课程共用教学周事实", value: "工具核验" },
      { title: "全校与空教室", subtitle: "基于 Release Pack 索引查询教师、教室、课程和空闲空间", value: "可追溯" },
      { title: "新学期发布", subtitle: "本地校园网采集、staging 上传、后台校验、发布 Release Pack", value: "统一链路" },
    ],
    actions: [
      { label: "打开 XLS 导入", type: "bind", url: "/pages/personal-sync/personal-sync?tab=xls", payload: {} },
      { label: "查看今日安排", type: "navigate", url: "/pages/today/today", payload: {} },
    ],
  }];
}

function generateFallbackResponse(intentName) {
  const isConversation = intentName === "conversational_help";
  return {
    provider: "mock",
    answer: isConversation
      ? "我是小佛，FosuClass 的 AI 校园管家。你可以问我怎么查课、找空教室、导入 XLS 个人课表、理解 Release Pack 和比赛展示逻辑；涉及具体课程事实时，我会先调用项目工具核验。"
      : "FosuClass 是佛山大学课表与校园空间工具。当前 AI 管家的设计是：课程事实走确定性工具，DeepSeek/Coze 负责项目知识问答、自然聊天、使用引导和复杂解释；个人课表坚持 XLS-only，不接收学号密码。",
    cards: getProjectCapabilityCards(),
    suggestions: [
      "这个小程序怎么用",
      "怎么同步新学期课表",
      "AI 管家架构是什么",
      "为什么要 XLS 导入",
    ],
  };
}

module.exports = {
  generateFallbackResponse,
  getProjectCapabilityCards,
  getProjectKnowledgePrompt,
};
