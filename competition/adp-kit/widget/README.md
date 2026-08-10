# 校园智序 Widget 产品化

本目录承载“校园任务单 / 时间票据”视觉体系的 Widget 展示层。它不是第二套业务逻辑：动态事实仍由 CampusTools 产生并经过 `evidence.verified=true` 核验，Widget 只负责把确定性结果转换成可扫读、可继续操作的交互界面。

## 架构

```text
CampusTools verified envelope
        ↓
widget/adapter.js
        ↓
campus-widget/v2 ViewModel
        ├─→ 腾讯云智能 ADP 原生 Widget
        └─→ widget.js + styles.css H5 fallback / 演示预览
```

### 为什么增加 Adapter

- UI 变化不会重新影响 01–04 已冻结的事实逻辑。
- 原生 ADP Widget 与 H5 fallback 共用同一份 ViewModel，不产生两套字段合同。
- Adapter 会拒绝版本异常或未核验的动态成功结果。
- `sys.chat` Action 只携带用户可理解的自然语言任务，不包含 token、NodeID、VarBizID 或系统提示词。

## C 方案：4 主卡 + 2 辅助卡

- `schedule`：课表 / 教室占用时间轴。
- `classroom`：空教室筛选 chips + 教室列表。
- `conflict`：时间冲突与跨校区赶场分区展示，支持 self-compare 风险检查。
- `day_plan`：课程 / 空档 / 自习建议的日计划时间轴。
- `choice`：歧义候选确认，原生 ADP 中使用等待用户操作模式。
- `error`：错误恢复，不用模型补造动态事实。

## ViewModel

统一 Schema 位于 `widget-schema.json`，版本固定：

```json
{
  "schemaVersion": "campus-widget/v2",
  "cardType": "schedule|classroom|conflict|day_plan|choice|error",
  "success": true,
  "queryId": "...",
  "dataVersion": "competition-demo-v1",
  "title": "...",
  "subtitle": "...",
  "timeText": "...",
  "filters": [],
  "summary": {},
  "items": [],
  "rushWarnings": [],
  "actions": [],
  "interaction": { "waitForUser": false },
  "evidence": { "verified": true },
  "error": null
}
```

## Action 合同

主交互优先使用 `sys.chat`：

```json
{
  "id": "classroom-capacity-60",
  "type": "sys.chat",
  "label": "容量≥60",
  "message": "要能坐60人的"
}
```

H5 fallback 点击后只向宿主发送安全 Action ViewModel：

```js
{
  kind: "action",
  action: { id, type, label, message }
}
```

不会回传完整 CampusTools envelope。

## 样例

样例必须由真实 CampusTools 计算，再经 Adapter 生成：

```powershell
node competition/adp-kit/widget/test-widget-adapter.js
node competition/adp-kit/widget/generate-samples.js
node competition/adp-kit/widget/serve.js
```

浏览器访问本地预览即可切换六种卡片。

## ADP 原生 Widget

原生 Widget 的字段/组件/Action 映射见 `adp-widget-mapping.md`。

如果腾讯云 ADP 当前没有公开、稳定的可编程 Widget 导出格式，则**不猜平台私有 JSON**。只需在 ADP 里建立一次最小 Widget seed 并导出，其要求见 `adp-widget-seed-requirements.md`；之后由 Codex/Kimi/ChatGPT 解析真实 seed 并自动生成其余 4+2 模板。

H5 fallback 始终保留，但比赛主应用优先展示 ADP 原生 Widget。
