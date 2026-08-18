# Shared Policy · Temporal Policy（R50.1）

所有时间解析由 **Temporal Semantic Core（temporal-core.js）** 确定性计算；Agent 只输出结构化 temporal intent，不得用 Prompt 猜测日期 / 教学周 / 窗口。

## 1. 「未来 / 接下来 N 个教学周」唯一契约

- 从 referenceDate 所在有效教学周开始；若 referenceDate 不在学期教学周内（开学前 / 学期后 / 假期），则从**之后第一个有效教学周**开始。
- 例：开学前（第 1 周开始前）→ 未来 4 个教学周 = 第 1..4 周；第 6 教学周内 → 未来 4 个教学周 = 第 6..9 周。
- 窗口越界 → 在学期末尾截断并保留 note，不虚构学期外周次。

## 2. 「最近 N 个教学周」唯一契约

- referenceDate 在教学周内 → [week-N+1, week]（含当前周）。
- referenceDate 在学期后 → [totalWeeks-N+1, totalWeeks]。
- referenceDate 在开学前 → 无已开展教学周，返回 pre_semester + null，由上层澄清或退化为「即将开始的第 1 周」。

## 3. 显式 > 继承

- 当前轮用户显式给出的日期 / 周次 / 周窗口 > 任何继承值。
- 未显式给出时间窗口的排名下钻：只继承选中实体与 detailWindow（多周）或显式单周；**没有有效单周/日期参数时不得静默默认 week=1**。
- overview 的聚合窗口计数（overviewWindow.count）**绝不是**教学周参数，不得继承为 week。

## 4. temporalContext 输出契约（内部协议）

```ts
{
  referenceDate: string,
  semesterId: string,
  inSemester: boolean,
  currentAcademicWeek: number | null,
  resolvedDate: string | null,
  resolvedWeek: number | null,
  resolvedWeekStart: number | null,
  resolvedWeekEnd: number | null,
  resolutionKind: string,   // absolute | relative_day | ... | pre_semester | post_semester | none
  note?: string
}
```

- temporalContext 原始 JSON 属于内部协议，**不得默认展示给用户**；用户看到的只是解析后的业务结果。
- 非法 intent → fail-closed（不猜测）；语义核心对同一输入重复调用字节级一致。