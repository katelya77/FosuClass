# 校园任务结果卡

一套移动端优先、无框架依赖的通用Widget/H5兜底，支持 `schedule`、`classroom`、`conflict`、`day_plan`、`error`、`choice` 六种卡片。

## 设计方向

采用“校园任务单/课表票据”视觉：纸张色、墨绿色索引边、核验印章和高密度表格式分区。它强调事实状态与快速扫读，不使用常见AI紫色渐变或聊天气泡外观。

## 接入

```html
<link rel="stylesheet" href="styles.css">
<div id="result"></div>
<script src="widget.js"></script>
<script>CampusTaskWidget.render(document.querySelector('#result'), toolEnvelope)</script>
```

按钮会冒泡触发 `campus-task-widget` 自定义事件；嵌入iframe时也会发送 `postMessage`。ADP原生Widget可直接映射同一 `widget-schema.json`；若平台Widget能力受限，部署本目录静态H5作为匿名演示端。

## 样例与本地预览

```powershell
node competition/adp-kit/widget/generate-samples.js
node competition/adp-kit/widget/serve.js
```

样例由真实 CampusTools 计算生成，避免手写卡片事实与工具结果漂移。
