# FosuClass HAR 解包报告（已脱敏）

## 结论

- HAR 共包含 63 条请求，已经确认佛山大学教务后台的课表数据主要通过 HTML 表格返回，不是纯 JSON API。
- 个人课表核心页面是 `GET/POST /xskb/xskb_list.do`，返回 `table#kbtable`。
- 全校课表核心数据接口是若干 `_ifr` 页面：`/kbcx/kbxx_xzb_ifr`、`/kbcx/kbxx_teacher_ifr`、`/kbcx/kbxx_classroom_ifr`、`/kbcx/kbxx_kc_ifr`，也返回 `table#kbtable`。
- `GET /kbcx/getZyByAjax?skyx=04&sknj=2025` 返回专业列表 JSON，可用于全校页的学院/年级/专业联动。
- 登录是 CAS 流程：`/authserver/login` POST 后 302 到 `caslogin.jsp`，HAR 里含敏感登录字段；不要把原始 HAR 发给 Codex 或提交 GitHub。

## 关键接口

- 25. `POST /authserver/login?service=http%3A%2F%2F100.fosu.edu.cn%2Fcaslogin.jsp%3FkstzType%3Dnull` -> 302 ``
- 59. `GET /caslogin.jsp?kstzType=null` -> 302 `text/html`
- 60. `GET /caslogin.jsp?kstzType=null&ticket=[REDACTED]` -> 302 ``
- 58. `GET /framework/xsMain.jsp` -> 200 `text/html`
- 20. `GET /xskb/xskb_list.do` -> 200 `text/html`
- 17. `POST /xskb/xskb_list.do` -> 200 `text/html`
- 18. `POST /xskb/xskb_list.do` -> 200 `text/html`
- 10. `POST /kbcx/kbxx_xzb_ifr` -> 200 `text/html`
- 12. `GET /kbcx/getZyByAjax?&skyx=04&sknj=2025` -> 200 `text/html`
- 13. `GET /kbcx/getZyByAjax?&skyx=04&sknj=` -> 200 `text/html`
- 16. `GET /kbcx/kbxx_xzb` -> 200 `text/html`
- 0. `POST /kbcx/kbxx_kc_ifr` -> 200 `text/html`
- 2. `POST /kbcx/kbxx_classroom_ifr` -> 200 `text/html`
- 4. `POST /kbcx/kbxx_teacher_ifr` -> 200 `text/html`
- 5. `GET /kbcx/kbxx_teacher` -> 200 `text/html`
- 3. `GET /kbxx/initJc?xnxq=2025-2026-2` -> 200 `text/html`
- 15. `GET /kbxx/initJc?xnxq=2025-2026-2` -> 200 `text/html`

## 已知请求参数


### 个人课表 POST /xskb/xskb_list.do
- `cj0701id` = ``
- `zc` = ``
- `demo` = ``
- `xnxq01id` = `2025-2026-2`
- `sfFD` = `1`
- `sfBZ` = `1`
- `jx0415zbdiv_*` = `[重复隐藏字段，需从页面表单提取，不要硬编码]`

### 行政班级 POST /kbcx/kbxx_xzb_ifr
- `xnxqh` = `2025-2026-2`
- `skyx` = `04`
- `sknj` = `2025`
- `skzy` = `3C3A6B4C710B4C8C9079446B5F5FCD96`
- `zc1` = ``
- `zc2` = ``
- `jc1` = ``
- `jc2` = ``

### 课程 POST /kbcx/kbxx_kc_ifr
- `xnxqh` = `2025-2026-2`
- `skyx` = `03`
- `kkyx` = ``
- `zzdKcSX` = ``
- `kc` = ``
- `zc1` = ``
- `zc2` = ``
- `jc1` = ``
- `jc2` = ``

### 教室 POST /kbcx/kbxx_classroom_ifr
- `xnxqh` = `2025-2026-2`
- `skyx` = `02`
- `xqid` = `2`
- `jzwid` = ``
- `zc1` = ``
- `zc2` = ``
- `jc1` = ``
- `jc2` = ``

### 教师 POST /kbcx/kbxx_teacher_ifr
- `xnxqh` = `2025-2026-2`
- `skyx` = `02`
- `jszc` = `010`
- `zc1` = ``
- `zc2` = ``
- `jc1` = ``
- `jc2` = ``

## 返回结构观察

- 个人课表: 存在 `table#kbtable`，行数 8，前几行列数 [8, 8, 8]。
- 行政班级课表: 存在 `table#kbtable`，行数 8，前几行列数 [8, 43, 43]。
- 课程课表: 存在 `table#kbtable`，行数 95，前几行列数 [8, 43, 43]。
- 教室课表: 存在 `table#kbtable`，行数 80，前几行列数 [8, 43, 43]。
- 教师课表: 存在 `table#kbtable`，行数 2，前几行列数 [8, 43]。

## 个人课表解析重点

- 个人课表的 `table#kbtable` 第一行是星期一到星期日。
- 后续行是“第一大节、第二大节……”等。每个单元格内可能包含多门课。
- 单元格文本常见格式：`课程名 教师 周次 教室[03-04-05]节`，多门课之间可能使用多段横线分隔。
- 第 17 条个人课表响应已包含完整本学期课程 HTML，下一版可以先做“离线解析 HAR/HTML -> CourseItem JSON”，不必马上实现真实登录。

## 建议的下一步开发顺序

1. 优先优化“今日课程”页面，把时间、教室、教师、周次显示完整。
2. 新增 `tools/extract-har-schedule.js`：从脱敏 HAR 中找到 `/xskb/xskb_list.do` 的 HTML，解析 `table#kbtable`，输出 `miniprogram/data/importedCourses.js` 或 JSON。
3. 小程序前端优先读取解析出的真实课程 JSON；失败时回退 mock 数据。
4. 再接入全校课表 `_ifr` 页面，先做行政班级 `/kbcx/kbxx_xzb_ifr`。
5. 最后再做自动登录，因为 CAS 登录存在加密字段和会话处理，复杂度高于课表 HTML 解析。

## 安全提醒

- 原始 HAR 包含 Cookie、CAS ticket、登录 POST 字段等敏感信息，不能发给 Codex，不能上传 GitHub。
- 使用本报告或 `.sanitized.har` 给 Codex 即可。