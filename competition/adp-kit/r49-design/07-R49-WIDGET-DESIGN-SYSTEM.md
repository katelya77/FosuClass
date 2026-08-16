# R49 07 — Widget 设计系统（Design System for Hero Widgets）

> 阶段：R49 设计/审计阶段 — DESIGN DRAFT
> 基线：r48-v3 design-tokens.json「Campus Operations Pass」的延续与扩展

---

## 1. 设计原则

1. **商业级校园效率工具**：高密度、可扫读、安静。
2. Neutral base：暖白 `#F7F8F6` 页底 / 近白 `#FFFFFF` 卡片，不发黄。
3. 少装饰：极轻或无阴影、1px 低对比中性边框。
4. 无 AI 紫渐变、无玻璃拟态、无巨型头像、无整片风险底色。
5. 已核验 = 右上角小 Badge，不做大绿章。
6. 课程色 deterministic，禁随机。
7. 禁止外部 CDN / 字体 / 图标库（赛事环境依赖与 r48-v3 一致）。
8. `prefers-reduced-motion` 下关闭非必要动画。

## 2. Token 扩展（在 r48-v3 design-tokens.json 之上）

### 2.1 课程色板（新增 `courseColors`，5~7 个低饱和色）

| token | hex | 用途 |
|---|---|---|
| course-01 | #DCE9E1（moss 浅） | 课程块 A |
| course-02 | #E8E0D2（沙） | 课程块 B |
| course-03 | #D9E3EC（雾蓝） | 课程块 C |
| course-04 | #EADFD8（陶土浅） | 课程块 D |
| course-05 | #E4E6D6（橄榄浅） | 课程块 E |
| course-06 | #DED9E8（灰紫浅，不显紫感） | 课程块 F |
| course-07 | #F0E3D6（杏） | 课程块 G |

> 注意：色板全为低饱和浅底 + 深字（ink `#1F2521`），色块仅作区域划分，不是品牌色堆叠。

### 2.2 Deterministic 映射规则

```text
index = stableHash(courseName 归一化) % palette.length
```

- 同一课程名（含别名归一化：科学计算 / 高等数学A）恒得同一色。
- 冲突/赶场时：色块不变，仅在右上角加 Badge（warning/danger 语义色）。
- 周切换、日切换、重查都不变色。

### 2.3 版式

| token | 值 | 说明 |
|---|---|---|
| radius | card 14 / inner 10 / chip 999 | 沿用 r48-v3 |
| spacing | [4,8,12,16,20,24] | 沿用 |
| 触控目标 | ≥ 40px | ADP Button size=sm 由平台保证，H5 fallback 显式保证 |
| 标题 | 17/700 | 课程卡主标题 |
| 课程名 | 14/600 | 方块主文字 |
| body | 13/400 | 细节 |
| caption | 12/400 | 次级 |
| micro | 11/400 | 角标/元信息 |

## 3. 组件规范（ADP 原生组件）

| 组件 | 规范 |
|---|---|
| Card | 白底、radius 14、1px `#E4E8E3` 边框、无阴影 |
| Box/Row/Col | 网格间距 8~12px；课程块高度自适应内容 |
| Clickable | 每个课程块 1 个 Clickable → sys.chat 完整消息（state-complete） |
| Badge | 语义色：info=已核验/信息、success=正常、warning=赶场、danger=冲突、secondary=中性 |
| Button | 主操作实底（brand `#173F35` 或 accent `#2563EB`）、次操作描边 |
| Form/DatePicker/RadioGroup/Checkbox/Select | 筛选表单（06 文档 §5），提交生成独立 query |
| ListView | detail 模式楼栋/教室/教师/班级明细 |
| Chart | 05 态势扩展预留（非本轮） |

## 4. 语义色用法（沿用 r48-v3）

- 风险=琥珀橙 `#8A5A00`（warning）；冲突=克制红 `#A54232`（danger）。
- 不整片底色；只做文字/角标/图标级别。

## 5. 无障碍

- 深字浅底对比度 ≥ 4.5:1（ink on course-* 全部满足）。
- 触控 ≥ 40px；键盘可达（H5 fallback）。
- prefers-reduced-motion：关闭转场动画。

## 6. 与 r48-v3 的关系

- r48-v3 design-tokens.json / css 是「Campus Operations Pass」基础；R49 增加 courseColors 与 viewMode 扩展（detail/picker）。
- 实施阶段以**新增 token + 兼容旧 token** 的方式演进，不删除既有字段。
- 原型阶段先在 `r49-design/widget-prototype/` 用静态 HTML/CSS 呈现（无 WidgetID），评审通过后再进契约。

## 7. 禁则清单（照抄进原型与实施）

- 禁 AI 紫渐变、玻璃拟态、光效/辉光。
- 禁巨型标题、禁装饰插画、禁 emoji 图标装饰（语义图标除外）。
- 禁随机颜色、禁每轮变色。
- 禁把事实数据改成 UI 需要的值（视觉层只呈现 evidence）。
- 禁外部依赖（CDN 字体、图标库、图片托管）。