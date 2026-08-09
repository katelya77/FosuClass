// 助手品牌统一配置（用户可见名称唯一事实源）
// 迁移说明：正式产品仍名「佛课小表」；内置助手用户可见名称统一为「小序」。
// 历史名称「小佛助手」「小佛AI」仅用于兼容识别（legacyNames），不再向用户展示。
// 注意：packageXiaofu、xiaofu 开头的文件名/组件路径/存储键/数据库字段/API 协议字段
// 属于内部标识符，不在本配置管理范围内，必须保持不变以兼容旧缓存、旧会话与组件引用。

const ASSISTANT_BRAND = {
  // 助手用户可见名称
  assistantName: '小序',
  // 所属系统名称
  systemName: '校园智序',
  // 参赛完整作品名
  competitionName: '校园智序 · 小序',
  // 助手副标题
  subtitle: '校园任务助手',
  // 历史名称（仅用于兼容识别与迁移提示，禁止再用于新 UI 文案）
  legacyNames: ['小佛助手', '小佛AI'],

  // 常用用户可见文案（统一从此处取词，避免散落硬编码）
  text: {
    querying: '小序正在查询',
    settings: '小序设置',
    knowledgeBase: '小序知识库',
    serviceStatus: '小序服务状态',
    assistantEntry: '小序',
    assistantWithSuffix: '小序助手'
  }
};

module.exports = ASSISTANT_BRAND;
