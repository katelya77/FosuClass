/**
 * Typed admin settings schema (non-secret fields only).
 * Secrets are never returned as plaintext.
 */
const SETTINGS_FIELDS = [
  {
    key: "appName",
    type: "string",
    label: "应用名称",
    description: "小程序与后台展示的产品名称",
    default: "佛课小表",
    sensitive: false,
    requiresRestart: false,
    scope: "app",
    maxLength: 80,
  },
  {
    key: "currentSemester",
    type: "string",
    label: "展示学期",
    description: "后台展示用学期（课表 Active 仍由学期注册表/指针控制）",
    default: "",
    sensitive: false,
    requiresRestart: false,
    scope: "term",
    maxLength: 40,
  },
  {
    key: "publishStatus",
    type: "enum",
    label: "发布状态",
    description: "应用层发布态标签",
    default: "online",
    enumValues: ["online", "maintenance", "offline"],
    sensitive: false,
    requiresRestart: false,
    scope: "app",
  },
  {
    key: "appConfig.enableFosuStudentImport",
    type: "boolean",
    label: "个人课表导入开关",
    description: "是否允许学生端导入个人课表",
    default: true,
    sensitive: false,
    requiresRestart: false,
    scope: "import",
  },
  {
    key: "dataVersion.releaseNote",
    type: "string",
    label: "数据版本说明",
    description: "面向用户的数据更新说明",
    default: "全校课表数据已更新",
    sensitive: false,
    requiresRestart: false,
    scope: "data",
    maxLength: 600,
  },
  {
    key: "dataVersion.dataSourceLabel",
    type: "string",
    label: "数据来源标签",
    description: "展示在客户端的数据来源文案",
    default: "教务系统快照 / 用户反馈修正 / 本地维护",
    sensitive: false,
    requiresRestart: false,
    scope: "data",
    maxLength: 200,
  },
  {
    key: "disclaimer",
    type: "string",
    label: "免责声明",
    description: "课表免责声明文案",
    default: "课表仅供参考，以任课教师及教务通知为准。",
    sensitive: false,
    requiresRestart: false,
    scope: "app",
    maxLength: 500,
  },
];

function getByPath(obj, dotted) {
  return String(dotted)
    .split(".")
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setByPath(obj, dotted, value) {
  const parts = String(dotted).split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function validateField(field, value) {
  if (field.type === "boolean") {
    if (typeof value !== "boolean") {
      return `${field.key} must be boolean`;
    }
    return null;
  }
  if (field.type === "enum") {
    if (!field.enumValues.includes(value)) {
      return `${field.key} must be one of ${field.enumValues.join(", ")}`;
    }
    return null;
  }
  const text = value == null ? "" : String(value);
  if (field.maxLength && text.length > field.maxLength) {
    return `${field.key} exceeds max length ${field.maxLength}`;
  }
  return null;
}

module.exports = {
  SETTINGS_FIELDS,
  getByPath,
  setByPath,
  validateField,
};
