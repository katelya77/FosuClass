# 佛大课表 FosuClass

面向佛山大学的原生微信小程序课表模板。V4 开始把脱敏 HAR 样本沉淀为强智教务接口适配层，产品侧采用“云函数同步 + 小程序读取缓存”的长期架构。

## 当前功能

- 首页周课表：彩色课程方块、默认周一到周五、第 1 节到第 14 节、日期范围 + 周次切换、课程详情弹窗；开启周末后只有课表网格内部横向滑动。
- 全校课表：班级 / 教师 / 教室 / 课程四个入口，班级支持学院、年级、专业筛选，教师端已预留搜索与云函数同步结构。
- 今日课程：按当前班级、当前教学周、今天星期筛选课程，显示日期、星期、周次、时间、节次、教室、教师、周次和上课状态。
- 教学周历：展示 2025-2026 学年第二学期第 1-20 周，按当前日期高亮对应周并显示日期范围。
- 作息时间：第 1-14 节可配置 Mock 时间。
- 登录同步：只做 UI 和演示流程，不真实登录、不保存密码。
- 设置页：当前班级、当前学期、当前周、隐藏非当前周课程、显示周末、清除缓存、隐私说明。
- 教务同步架构：云函数适配强智个人、行政班级、教师、教室、课程、专业联动和节次初始化接口；默认不在小程序端请求学校教务系统。

## 运行方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本目录：`C:\Users\Katelya\Documents\VScode\FosuClass`。
4. 使用现有 `project.config.json` 编译运行。
5. 第一阶段前端只依赖本地文件，云函数未上传也不影响首页和 Mock 页面运行。

没有额外 npm 依赖需要安装。

## 真机调试体积优化

微信开发者工具“自动真机调试”对 source size 有 2MB 限制。当前项目已经做了这些处理：

- `project.config.json` 关闭 `setting.uploadWithSourceMap`，保留 `minified`、`minifyWXML`、`minifyWXSS` 为 `true`。
- `packOptions.ignore` 忽略 README、docs、tools、node_modules、miniprogram_npm、source map、日志、密钥占位文件等不会参与小程序运行的文件。
- 删除微信云开发 quickstart 遗留大图和未引用的大图标；首页 logo 缺失时使用“佛”字 CSS fallback，不为了 logo 引入大图。

Windows PowerShell 可用下面命令检查小程序目录内的大文件：

```powershell
Get-ChildItem -Recurse miniprogram | Sort-Object Length -Descending | Select-Object -First 30 FullName,Length
```

如果自动真机调试仍然报 `source size exceed max limit 2MB`，可以先用普通“预览”或“上传体验版”验证功能，后续再继续做分包。

分包预留方案：

- 主包：只保留首页课表、今日课表、设置基础功能。
- 分包：全校课表、教学周历、作息时间、登录同步、开发中查询页。
- 当前 V2 先不强行拆分页面，避免一次性调整路由带来路径风险。

## Logo

logo 是可选资源。请尽量使用极小尺寸 PNG，并放到：

```text
miniprogram/assets/logo/favicon.png
```

当前首页已经引用该路径，并带有缺失时的“佛”字占位回退。不要放大尺寸背景图，也不要在 WXML/WXSS 中塞入大体积 base64 图片。

## 主要目录

```text
miniprogram/
  components/
  data/
  pages/
  utils/
  assets/logo/
cloudfunctions/
  common/
  eduLogin/
  syncSchedule/
  getSchoolSchedule/
  syncSchoolOptions/
  syncClassSchedule/
  syncTeacherSchedule/
  getSchoolOptions/
  getCachedSchedule/
  getCalendar/
  queryTeacherSchedule/
  queryClassroomSchedule/
  queryCourseSchedule/
```

## 统一课程数据结构

前端 Mock 课程遵循 `CourseItem` 结构，字段包括：

```text
id, source, sourceType, audienceType, semester, className, courseName, teacherName, classroom,
weekday, startSection, endSection, startWeek, endWeek, weeks,
weekText, weekType, color, remark, rawText, rawHtml
```

真实教务接口接入后，应先在 adapter/parser 层转换成该结构，再交给页面渲染。

可用轻量 smoke test 验证强智课表文本解析：

```powershell
node tools/parser-smoke-test.js
```

## V3：脱敏 HAR 离线导入课表

V3 先做“真实数据预览”，只从 ProxyPin 导出的脱敏 HAR 中离线提取个人课表 HTML，不做自动登录，也不请求佛大教务系统。

1. 把脱敏 HAR 放到：

```text
docs/captures/ProxyPin5-28_16_57_23.sanitized.har
```

2. 运行：

```powershell
node tools/extract-har-schedule.js
```

3. 脚本会从 `/xskb/xskb_list.do` 的 `table#kbtable` 中解析课程，并生成：

```text
docs/captures/personal-schedule.parsed.json
miniprogram/data/importedCourses.js
```

4. 重新编译微信开发者工具。首页和今日课程页会优先使用 `importedCourses.js`；如果导入数据为空，则自动回退到 `mockCourses`。

5. 如果解析不准确，对照 `docs/captures/personal-schedule.parsed.json` 里的 `rawText` / `rawHtml` 调整 parser，再重新运行导入脚本。

注意：`*.har` 和 `docs/captures/*.har` 已加入 `.gitignore`。仓库可以保留脱敏报告和解析后的 JSON/JS，但不要提交原始 HAR、Cookie、Token、JSESSIONID、Authorization 或密码。

## 后续接入真实佛大教务接口

佛山大学教务系统地址：

```text
https://100.fosu.edu.cn/
```

该系统页面底部显示“湖南强智科技发展有限公司”，因此当前项目按强智教务系统方向预留，不使用正方教务系统方案作为主线。

详细抓包流程见：

```text
docs/API_CAPTURE.md
```

后续抓包建议：

1. 打开 Chrome 浏览器访问 `https://100.fosu.edu.cn/`。
2. 按 F12 打开开发者工具。
3. 切到 Network 面板。
4. 手动登录教务系统。
5. 依次点击这些页面：
   - 我的课表 / 学期理论课表：`/xskb/xskb_list.do`
   - 课表信息 / 行政班级：`/kbcx/kbxx_xzb`
   - 课表信息 / 教师课表：`/kbcx/kbxx_teacher`
   - 课表信息 / 教室课表：`/kbcx/kbxx_classroom`
   - 课表信息 / 课程：`/kbcx/kbxx_kc`
   - 教学日历查看
   - 成绩查询：`/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ`
6. 找到对应请求，复制 URL、Method、Query Params、Form Data、Response。
7. 复制前必须删除 Cookie、密码、Token、JSESSIONID、Authorization 等敏感内容。
8. 把脱敏后的接口信息交给 AI 接入 `cloudfunctions/common/fosuQiangzhiAdapter.js`。

如果导出 HAR 文件，先运行脱敏脚本：

```powershell
node tools/sanitize-har.js ./capture.har
```

脚本会输出 `sanitized.har`。`tools/` 已在 `project.config.json` 的 `packOptions.ignore` 中忽略，不会打进小程序源码包。

## 安全规范

- 不要把真实学号和密码写进代码、README、注释、日志或测试文件。
- 不要把密码、Cookie、Token、Session 写入 Git。
- 不要把密码存入微信本地 Storage 或云数据库。
- 不要尝试绕过验证码、爆破登录或越权访问。
- 不要高频请求学校教务系统。
- 后续真实登录时，密码只在请求时临时使用，请求结束立即丢弃。
- 所有真实请求都必须加入限流、错误提示和脱敏日志。

本地测试密钥可以使用下面任一文件：

```text
local.secrets.json
.env.local
```

这两个文件已经加入 `.gitignore`。仓库只提供占位示例：

```text
local.secrets.example.json
.env.example
```

示例里只能保留占位字段，不要填真实密码后提交。

## 已预留强智路径

`cloudfunctions/common/fosuQiangzhiAdapter.js` 中已预留：

- `/xskb/xskb_list.do`
- `/kbcx/kbxx_xzb`
- `/kbcx/kbxx_teacher`
- `/kbcx/kbxx_classroom`
- `/kbcx/kbxx_kc`
- `/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ`

第一阶段这些方法不会真实请求学校系统，会抛出明确错误：真实教务接口尚未接入，请先提供脱敏抓包信息。

## V4：服务端同步与缓存读取

长期同步策略见：

```text
docs/SYNC_DESIGN.md
```

V4 的原则是：HAR 只作为接口样本，不作为长期产品能力。全校课表和教师课表应由云函数低频同步到缓存，小程序端调用 `getSchoolOptions`、`getCachedSchedule` 等云函数读取缓存。真实请求默认只能在云函数中执行，并且需要显式启用网络、配置合法登录态和限流。
