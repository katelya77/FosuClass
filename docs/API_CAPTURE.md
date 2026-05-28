# 佛山大学教务接口抓包说明

## 目标

将佛山大学强智教务系统的数据接入“佛大课表”。第一阶段只整理脱敏抓包信息，不在代码里写真实账号、密码、Cookie、Token 或 JSESSIONID。

## 已知页面

- 个人课表：https://100.fosu.edu.cn/xskb/xskb_list.do
- 行政班级课表：https://100.fosu.edu.cn/kbcx/kbxx_xzb
- 教师课表：https://100.fosu.edu.cn/kbcx/kbxx_teacher
- 教室课表：https://100.fosu.edu.cn/kbcx/kbxx_classroom
- 课程课表：https://100.fosu.edu.cn/kbcx/kbxx_kc
- 成绩查询：https://100.fosu.edu.cn/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ

## 抓包步骤

1. Chrome 打开 `https://100.fosu.edu.cn/`。
2. 按 F12 打开 DevTools。
3. 进入 Network 面板，勾选 Preserve log。
4. 登录教务系统。
5. 依次点击个人课表、行政班级课表、教师课表、教室课表、课程课表、教学日历、成绩查询。
6. 对每个页面点击“查询”。
7. 找到真正返回数据的请求。
8. 记录这些信息：
   - URL
   - Method
   - Query Params
   - Form Data
   - Response Headers 是否返回 HTML/JSON
   - Response Body 的脱敏样例

## 必须脱敏

提交给 AI 或写入文档前，必须删除：

- Cookie
- JSESSIONID
- Token
- Authorization
- 密码
- 身份证
- 手机号
- 任何个人隐私

可以先使用仓库里的 HAR 脱敏脚本：

```powershell
node tools/sanitize-har.js ./capture.har
```

脚本会输出 `sanitized.har`。仍建议人工复查一遍，确认没有 Cookie、Token、JSESSIONID、密码或个人隐私。

## 抓包后交给 AI 的模板

```text
页面名称：
页面地址：
触发动作：
请求 URL：
Method：
Query Params：
Form Data：
Response 类型：HTML / JSON
脱敏 Response 片段：
备注：
```
