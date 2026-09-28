const LABELS = ["姓名", "学号", "班级"];
const IGNORED_LABELS = [
  "身份证编号", "身份证号", "身份证", "联系电话", "手机", "手机号",
  "家庭地址", "地址", "民族", "性别", "籍贯", "政治面貌", "出生日期",
  "入学日期", "照片", "学籍异动",
];

function stripTags(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (match, code) => {
      const number = Number(code);
      return number > 0 && number < 65536 ? String.fromCharCode(number) : "";
    })
    .replace(/[\u0000-\u001F\u007F]/g, " ");
}

function compact(value) {
  return stripTags(value).replace(/\s+/g, "").replace(/[：:]/g, "");
}

function cleanValue(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function isLabel(value) {
  const text = compact(value);
  return LABELS.indexOf(text) >= 0 || IGNORED_LABELS.indexOf(text) >= 0;
}

function cellTexts(html) {
  const source = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const cells = [];
  const pattern = /<(td|th|dt|dd|label)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match = pattern.exec(source);
  while (match) {
    cells.push(match[2]);
    match = pattern.exec(source);
  }
  return cells;
}

function inlineValue(cell, label) {
  const text = cleanValue(cell);
  const matched = new RegExp("^" + label + "\\s*[：:]\\s*(.+)$").exec(text);
  if (!matched) return "";
  const value = String(matched[1] || "").trim();
  if (!value || isLabel(value)) return "";
  return value;
}

function labeledValue(cells, label) {
  for (let index = 0; index < cells.length; index += 1) {
    if (compact(cells[index]) === label) {
      for (let next = index + 1; next < cells.length; next += 1) {
        const value = cleanValue(cells[next]);
        if (!value) continue;
        if (isLabel(value)) break;
        return value;
      }
    }
    const inline = inlineValue(cells[index], label);
    if (inline) return inline;
  }
  return "";
}

function parseStudentProfileHtml(html) {
  const cells = cellTexts(html);
  const studentId = labeledValue(cells, "学号").replace(/\s+/g, "");
  return {
    studentName: labeledValue(cells, "姓名").replace(/\s+/g, ""),
    studentId: /^\d{6,20}$/.test(studentId) ? studentId : "",
    className: labeledValue(cells, "班级"),
  };
}

function parseXsMainIdentity(html) {
  const text = cleanValue(String(html || "").slice(0, 4000));
  const matched = /([\u4e00-\u9fa5·]{2,20})\s*[（(]\s*(\d{6,20})\s*[)）]/.exec(text);
  if (!matched) return { studentName: "", studentId: "" };
  return { studentName: matched[1], studentId: matched[2] };
}

module.exports = {
  parseStudentProfileHtml,
  parseXsMainIdentity,
};
