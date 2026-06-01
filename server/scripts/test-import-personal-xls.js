/**
 * 个人课表 XLS 导入解析测试
 * NOTE: 在内存中动态创建包含各种复杂情况的 Mock Excel 字节流，验证解析器对合并单元格、多课程、职称清理、单双周、节次等字段的处理正确性。
 */

const XLSX = require("xlsx");
const assert = require("assert");
const { parsePersonalXlsBuffer } = require("../src/utils/personal-xls-parser");

/**
 * 动态在内存构建一个包含复杂边界情况的课表 Workbook 字节流
 * @returns {Buffer} Excel 字节流
 */
function buildMockXlsBuffer() {
  const data = [
    // 0: 标题行
    ["佛山大学 王奕章 学生个人课表", "", "", "", "", "", "", "", ""],
    // 1: 元信息行
    ["学年学期：2025-2026-2", "班级：25动物医学6", "所属班级：动物医学", "学院：动物科技学院", "打印日期：2026-06-01", "", "", "", ""],
    // 2: 星期表头行
    ["节次", "时间", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"],
    // 3: 星期一 1-2 节：普通单课程
    ["[01-02]节", "08:00-09:40", "高等数学\n李勇 教授\n1-16周\nC7-305[01-02]节", "", "", "", "", "", ""],
    // 4: 星期二 3-5 节：间断周次 (5-8,10-15周)
    ["[03-05]节", "10:00-12:25", "", "大学物理\n张伟 副教授\n5-8,10-15周\nB8-209[03-04-05]节", "", "", "", "", ""],
    // 5: 星期三 6-7 节：体育课，教室为空（只有[06-07]节），带有备注
    ["[06-07]节", "14:00-15:40", "", "", "体育(2)\n王强 老师\n1-16周\n[06-07]节\n备注: 操场上课，雨天教室", "", "", "", ""],
    // 6: 星期一 8-10 节：一个单元格内包含多门课 (单/双周交替)
    [
      "[08-10]节", 
      "16:00-18:25", 
      "数据结构\n赵敏 讲师\n5-14周(单)\nC7-305[08-09-10]节\n----------\n算法设计\n钱二 助教\n5-14周(双)\nC7-305[08-09-10]节", 
      "", "", "", "", "", ""
    ],
    // 7: 星期四 11-12 节：重复数据测试（用于验证去重逻辑）
    ["[11-12]节", "19:00-20:40", "", "", "", "高等数学\n李勇 教授\n1-16周\nC7-305[01-02]节", "", "", ""],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // 模拟合并单元格 merges
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // 第一行标题合并
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "MockSheet");

  // 使用 sheet_to_json 生成 buffer
  return XLSX.write(wb, { type: "buffer", bookType: "xls" });
}

function runTests() {
  console.log("[Test] 开始进行 100 网 xls 课表解析测试...");
  
  const buffer = buildMockXlsBuffer();
  const result = parsePersonalXlsBuffer(buffer, "2025-2026-2", "学生个人课表_20250410303.xls");

  // 1. 验证学期提取
  console.log(`[Test] 识别到的学期为: ${result.term}`);
  assert.strictEqual(result.term, "2025-2026-2", "学期提取不正确");
  assert.strictEqual(result.metadata.studentName, "王奕章", "学生姓名 metadata 提取不正确");
  assert.strictEqual(result.metadata.studentId, "20250410303", "学号 metadata 应优先从文件名提取");
  assert.strictEqual(result.metadata.className, "25动物医学6", "班级 metadata 提取不正确");
  assert.strictEqual(result.metadata.majorName, "动物医学", "所属班级 metadata 提取不正确");
  assert.strictEqual(result.metadata.collegeName, "动物科技学院", "学院 metadata 提取不正确");
  assert.strictEqual(result.metadata.printDate, "2026-06-01", "打印日期 metadata 提取不正确");
  assert.strictEqual(result.metadata.source, "fosu-100-print-xls", "source metadata 提取不正确");

  // 2. 验证解析到的课程总数
  console.log(`[Test] 解析出的课程条目数（去重后）: ${result.courses.length}`);
  // 应包含：高等数学(周一)、大学物理(周二)、体育(周三)、数据结构(周一单)、算法设计(周一双)、高等数学(周四)
  assert.strictEqual(result.courses.length, 6, "课程解析数量不正确");

  // 3. 验证课程一：高等数学 (周一 1-2节 1-16周)
  const mathMon = result.courses.find(c => c.courseName === "高等数学" && c.weekDay === 1);
  assert.ok(mathMon, "未找到周一的高等数学");
  assert.strictEqual(mathMon.teacherName, "李勇", "教师职称清理失败，应为李勇");
  assert.strictEqual(mathMon.classroom, "C7-305", "教室解析错误");
  assert.deepStrictEqual(mathMon.sections, [1, 2], "节次范围错误");
  assert.strictEqual(mathMon.weeks.length, 16, "周数错误，应为 16 周");
  console.log("✔ 课程一（普通单课程与职称清理）验证通过");

  // 4. 验证课程二：大学物理 (周二 3-5节 5-8,10-15周)
  const physics = result.courses.find(c => c.courseName === "大学物理");
  assert.ok(physics, "未找到大学物理");
  assert.strictEqual(physics.teacherName, "张伟", "教师姓名错误");
  assert.strictEqual(physics.classroom, "B8-209", "教室错误");
  assert.deepStrictEqual(physics.sections, [3, 4, 5], "节次范围错误");
  // 5-8周 (4) + 10-15周 (6) = 10 周
  assert.strictEqual(physics.weeks.length, 10, "周次列表解析错误");
  assert.ok(!physics.weeks.includes(9), "不应包含第9周");
  console.log("✔ 课程二（间断周次与多节次）验证通过");

  // 5. 验证课程三：体育(2) (周三 6-7节 教室为空 带有备注)
  const pe = result.courses.find(c => c.courseName === "体育(2)");
  assert.ok(pe, "未找到体育课");
  assert.strictEqual(pe.teacherName, "王强", "体育教师解析错误");
  assert.strictEqual(pe.classroom, "", "体育教室应解析为空");
  assert.deepStrictEqual(pe.sections, [6, 7], "节次范围错误");
  assert.ok(pe.note.includes("操场上课"), "备注内容丢失");
  console.log("✔ 课程三（空教室与备注）验证通过");

  // 6. 验证课程四和五：数据结构和算法设计 (同单元格拆分单双周)
  const dataStruct = result.courses.find(c => c.courseName === "数据结构");
  const algo = result.courses.find(c => c.courseName === "算法设计");
  
  assert.ok(dataStruct, "未找到数据结构");
  assert.ok(algo, "未找到算法设计");
  
  assert.strictEqual(dataStruct.teacherName, "赵敏", "数据结构教师错误");
  assert.strictEqual(algo.teacherName, "钱二", "算法设计教师错误");
  
  // 单周 5-14 周：5, 7, 9, 11, 13
  assert.deepStrictEqual(dataStruct.weeks, [5, 7, 9, 11, 13], "数据结构单周解析错误");
  // 双周 5-14 周：6, 8, 10, 12, 14
  assert.deepStrictEqual(algo.weeks, [6, 8, 10, 12, 14], "算法设计双周解析错误");
  console.log("✔ 课程四和五（单单元格多课程分拆单双周）验证通过");

  // 7. 验证去重逻辑：高等数学(周四)应该独立，且不会被作为重复项删除
  const mathThu = result.courses.find(c => c.courseName === "高等数学" && c.weekDay === 4);
  assert.ok(mathThu, "周四的高等数学不应被去重过滤，因为星期不同");
  console.log("✔ 课程六（星期不同防误去重）验证通过");

  console.log("\n[Test] ✔ All personal XLS parser tests passed successfully!");
}

try {
  runTests();
} catch (error) {
  console.error("\n[Test] ✘ Parser test failed:", error);
  process.exit(1);
}
