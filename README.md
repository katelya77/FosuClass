# 佛大课表 FosuClass

面向佛山大学的原生微信小程序课表模板。第一阶段使用本地 Mock 数据，不依赖后端服务器，也不真实请求佛山大学教务系统。

## 当前功能

- 首页周课表：彩色课程方块、周一到周日、第 1 节到第 13 节、周次切换、课程详情弹窗。
- 全校课表：班级、学院、年级、专业搜索筛选，当前使用 Mock 班级数据。
- 今日课程：按当前班级、当前周、今天星期筛选课程。
- 教学周历：展示 2025-2026 学年第二学期第 1-20 周 Mock 周历。
- 作息时间：第 1-13 节可配置 Mock 时间。
- 登录同步：只做 UI 和 Mock 流程，不真实登录、不保存密码。
- 设置页：当前班级、当前学期、当前周、隐藏非当前周课程、显示周末、清除缓存、隐私说明。

## 运行方式

1. 打开微信开发者工具。
2. 选择“导入项目”。
3. 项目目录选择本目录：`C:\Users\Katelya\Documents\VScode\FosuClass`。
4. 使用现有 `project.config.json` 编译运行。
5. 第一阶段前端只依赖本地文件，云函数未上传也不影响首页和 Mock 页面运行。

没有额外 npm 依赖需要安装。

## Logo

请把准备好的 logo 放到：

```text
miniprogram/assets/logo/favicon.png
```

当前首页已经引用该路径，并带有缺失时的“佛”字占位回退。

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
  getCalendar/
  queryTeacherSchedule/
  queryClassroomSchedule/
  queryCourseSchedule/
```

## 统一课程数据结构

前端 Mock 课程遵循 `CourseItem` 结构，字段包括：

```text
id, source, semester, className, courseName, teacherName, classroom,
weekday, startSection, endSection, startWeek, endWeek, weeks,
weekText, weekType, color, remark, rawText, rawHtml
```

真实教务接口接入后，应先在 adapter/parser 层转换成该结构，再交给页面渲染。

## 后续接入真实佛大教务接口

佛山大学教务系统地址：

```text
https://100.fosu.edu.cn/
```

该系统页面底部显示“湖南强智科技发展有限公司”，因此当前项目按强智教务系统方向预留，不使用正方教务系统方案作为主线。

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
