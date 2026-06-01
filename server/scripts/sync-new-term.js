/**
 * 新学期课表一键同步聚合脚本 (sync-new-term)
 * 职责：
 * 1. 校验学期代码和学期开始日期格式
 * 2. 检查学校统一身份认证与教务网连通状态
 * 3. 执行全量课表与资源派生同步抓取
 * 4. 运行课表格式标准化校验 assert 测试
 * 5. 将抓取成果整合生成 Staging JSON 文件
 * 6. 统计打印同步摘要信息
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};
  for (const arg of args) {
    if (arg.startsWith("--")) {
      const match = arg.match(/^--([^=]+)=(.*)$/);
      if (match) {
        params[match[1]] = match[2];
      } else {
        const flagMatch = arg.match(/^--([^=]+)$/);
        if (flagMatch) {
          params[flagMatch[1]] = true;
        }
      }
    }
  }
  return params;
}

async function main() {
  console.log("=============================================");
  console.log("🚀 开始执行新学期一键同步聚合脚本 (sync-new-term) ...");
  console.log("=============================================");

  const params = parseArgs();

  // 1. 校验 term 格式 (例如 2026-2027-1)
  const term = params.term;
  if (!term || !/^\d{4}-\d{4}-\d$/.test(term)) {
    console.error("❌ 错误: 缺少 --term 参数，或格式不正确！(正确格式例如: --term=2026-2027-1)");
    process.exit(1);
  }

  // 2. 校验 start 开始日期 (例如 2026-09-01)
  const start = params.start || "2026-09-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    console.error("❌ 错误: --start 日期格式不正确！(正确格式例如: --start=2026-09-01)");
    process.exit(1);
  }

  const note = params.note || `${term} 新学期课表首版`;
  const output = params.output || `./staging/${term}-full.json`;
  const publish = params.publish === "true" || params.publish === true;

  console.log(`📅 学期: ${term}`);
  console.log(`📅 开始日期: ${start}`);
  console.log(`📝 版本说明: ${note}`);
  console.log(`📁 输出路径: ${output}`);
  console.log(`🔔 自动发布: ${publish ? "是" : "否 (仅生成 Staging JSON)"}`);
  console.log("---------------------------------------------");

  // 3. 网络环境诊断
  console.log("🔍 正在诊断学校教务网和统一身份认证连通性...");
  const diagnoseScript = path.join(__dirname, "../../tools/fosu-sync-client/diagnose.js");
  const diagnoseRes = spawnSync("node", [diagnoseScript], { stdio: "inherit", shell: true });
  if (diagnoseRes.status !== 0) {
    console.warn("⚠️ 警告: 网络连通性诊断未通过，可能是未连接校园网 VPN 或教务网暂时关停。");
    console.warn("若要进行离线缓存数据打包，可忽略此警告；若需实时同步，请确认网络后再试。");
  } else {
    console.log("✅ 校园教务网诊断通过！");
  }
  console.log("---------------------------------------------");

  // 4. 执行全量抓取与资源派生 (若 publish=false 则使用 dry-run 阻止直接激活线上)
  console.log("🔄 正在执行全量抓取及派生数据转换 (fresh sync) ...");
  const syncScript = path.join(__dirname, "../../tools/fosu-sync-client/sync.js");
  const syncArgs = [
    "fresh",
    `--term=${term}`,
    `--start=${start}`,
    `--note=${note}`,
    `--output=${output}`,
    `--publish=${publish ? "true" : "false"}`
  ];
  
  const syncRes = spawnSync("node", [syncScript, ...syncArgs], { stdio: "inherit", shell: true });
  if (syncRes.status !== 0) {
    console.error("❌ 错误: 数据抓取与同步逻辑执行异常，同步中止！");
    process.exit(1);
  }
  console.log("---------------------------------------------");

  // 5. 运行 course-normalizer
  console.log("🧪 正在运行课表格式标准化校验 (course-normalizer) ...");
  const normalizerScript = path.join(__dirname, "../../tools/test-course-normalizer.js");
  const normRes = spawnSync("node", [normalizerScript], { stdio: "inherit", shell: true });
  if (normRes.status !== 0) {
    console.error("❌ 错误: 课表标准化校验测试未通过，请检查课程及地点解析器逻辑！");
    process.exit(1);
  }
  console.log("✅ 课表标准化校验全部通过！");
  console.log("---------------------------------------------");

  // 6. 读取并输出生成的 Staging JSON 统计摘要
  const resolvedOutputPath = path.resolve(process.cwd(), output);
  if (!fs.existsSync(resolvedOutputPath)) {
    console.error(`❌ 错误: 未能在目标路径找到生成的 Staging 文件: ${resolvedOutputPath}`);
    process.exit(1);
  }

  try {
    const stagingData = JSON.parse(fs.readFileSync(resolvedOutputPath, "utf-8"));
    const coverage = stagingData.coverage || {};
    
    console.log("📊 ================= [同步完成统计摘要] ================= 📊");
    console.log(`- 学期代码 (term): ${stagingData.term}`);
    console.log(`- 开始日期 (termStartDate): ${stagingData.termStartDate}`);
    console.log(`- 生成版本 (releaseVersion): ${stagingData.releaseVersion}`);
    console.log(`- 生成时间 (generatedAt): ${stagingData.generatedAt}`);
    console.log(`- 学院总数: ${coverage.collegeCount || 0} 个`);
    console.log(`- 包含专业数: ${coverage.majorCount || 0} 个`);
    console.log(`- 班级课表总数: ${coverage.classScheduleCount || 0} 条`);
    console.log(`- 行政班级数: ${coverage.adminClassCount || 0} 个`);
    console.log(`- 专业共享课表数: ${coverage.majorAggregateCount || 0} 个`);
    console.log(`- 教师课表数: ${coverage.teacherScheduleCount || 0} 条`);
    console.log(`- 教室课表数: ${coverage.classroomScheduleCount || 0} 条`);
    console.log(`- 课程课表数: ${coverage.courseScheduleCount || 0} 条`);
    console.log(`- 无排课专业数: ${coverage.noScheduleMajorCount || 0} 个`);
    console.log("=============================================================");
    console.log(`🎉 新学期 Staging 数据包已成功生成并写入：\n👉 ${resolvedOutputPath}`);
  } catch (err) {
    console.error("❌ 错误: 解析生成的 Staging JSON 文件失败: " + err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌ 执行同步聚合脚本异常:", err);
  process.exit(1);
});
