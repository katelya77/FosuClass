# Competition Showcase Phase 2 Report — Hero Quartet Finalization & Verified Storytelling

## Git

- 基线 HEAD：`b750774`（Phase 1 终点）；分支 `feat/campusflow-adp-integration` 不变
- 本轮提交（本目录内，未 push、未动 PR #49）：vendor 化 react-bits → 已核验数据层 → 导演节拍与四场景成片 → 测试与文档；最终以 `git log -- competition/showcase` 为准
- 范围纪律：仅修改 `competition/showcase/**`；runtime / adp-kit / plugin / CloudBase / Agent Prompt 零触碰

## 数据纪律与溯源（核心交付）

四个 Hero 的全部业务事实来自**本机确定性 CampusTools 对 competition-demo-v3 数据集（sha1:842b7959e808）的真实调用**，
证据 JSON 留存于本机 evidence 目录；fixture 内 `provenanceNote` 记录精确到工具名 + 参数 + queryId，可离线复现。
无任何为画面好看而人工编造的教师/教室/数量。

| 场景 | 关键事实（全部工具实测） | 复现调用 |
| --- | --- | --- |
| hero-risk | 教师025 第1周 14 课次大学英语；W1–W4 每周 conflictCount=0、rushWarningCount=4；赶场均为 08:00→10:00、间隔 20min（如 周一 校区C C1-101→校区B B1-103） | query_schedule_range{教师025,week1..4} · compare_schedules{self}×4 · query_teacher_load |
| hero-collaboration | 教师005/006/014 第1周唯一共同空闲=周四 P1-4；全校可用 63 间 → 容量≥120 收敛 7 间 → 推荐 A1-201（阶梯/120/校区A）；三人上午忙碌块取自整周课表 | query_common_free_time · plan_group{minCap 无/100/120} · find_available_classrooms{校区A,P1-4} · query_schedule×3 |
| hero-reschedule | lesson-001 数据结构（2025级计算机类01班·教师003·周一5-6@A1-201）→ 周四7-8节：feasible=true 且 warningCount=1（连续 4 节提示）；spaceAvailability.roomCount=8；suggestedRoom=A1-201(120)；explicit 指定同教室 roomCount=1；**mutatedData=false**；周四7-8节校区A真实候选 18 间 | check_reschedule_feasibility{auto/explicit} · find_available_classrooms{周四P7-8} |
| hero-insight | 第1–4周负载 Top10（Top1=教师025 56课/112课时；rank3/4 与 rank5-8 同为并列组）；下钻：周课次 14×4；风险摘要=冲突0/赶场4/样例 D→A 20′ | query_teacher_load{week1..4,topN10} · query_schedule_range · compare_schedules |

fixture 契约升级：`VerifiedFixture` 新增可选 `provenanceNote`（向后兼容）；四 fixture 全部 `source=adp-runtime-golden / dataVersion=competition-demo-v3 / verified=true / capturedAt=queryId 时间戳`。
Opening 的结构示意 graph 保持 placeholder（非业务事实），HUD 口径改为「已核验演示快照」，指涉的是画面上的业务事实层。

## Architecture 增量

- **数据管线**：`src/fixtures/heroes/*.json` → `src/data/adapters/*Adapter.ts`（ViewModel 层）→ Scene。Scene 禁止直接消费原始工具 JSON；适配器内置语义断言（如 feasible 必须与 warning 并存、mutatedData 必须 false、Top1 与排行首位一致）
- **导演系统**：新增 `src/director/heroes/{risk,collaboration,reschedule,insight}Timeline.ts` + registry——场景级节拍表（id 全局唯一、严格递增、时长与主 SCENES 表一致性有测试防漂移）；`timeline.ts` 组装 PROGRAM_EVENTS
- **深链**：`?scene=` 支持短名别名；`?beat=` 定位到节拍（store.seekToBeat，未知 beat 返回 false 不白屏）；RecordHUD 移至右下安全区
- **React Bits vendor**：`src/vendor/react-bits/{CountUp,ElectricBorder}.tsx`，清单见 docs/REACT-BITS-USAGE.md（采用2、弃用3，全部登记理由与性能影响）

## Visual System — 四英雄各自隐喻（反仪表盘）

| 场景 | 视觉隐喻 | 节拍叙事 |
| --- | --- | --- |
| HeroRisk | 时间轨上的隐形空间风险：五天课块 → 校区色显影 → 四条跨校区转场链逐条点亮 → 20′ 徽标 → 琥珀光晕+「冲突0 × 赶场4」反差结论 | identity 0.8 / schedule 3.2 / campuses 7.6 / routes 11.0 / gap 15.0 / warning 18.2 / summary 21.2（24s） |
| HeroCollaboration | 三条 lane × 五天上午矩阵，唯一空列即答案：周四列光带升起放大时刻标签；右侧 63→7 数字漏斗收敛到 A1-201 主卡 | lanes 0.8 / busy 3.0 / intersection 8.0 / expand 11.6 / rooms 14.4 / recommend 18.4 / verdict 20.8（23s） |
| HeroReschedule | Temporal Surgery 手术台：周一课块提起悬浮 → 落入周四虚位 → 六行约束逐项核验（5 PASS+1 提示，「提示≠失败」明示）→ 18间候选云收敛 8 间 → ElectricBorder 选定 A1-201 → 「可行 · 附带提示」判定；全程挂「模拟调课 What-if」徽标与未改动真实课表小注 | source 0.8 / lift 4.2 / snap 7.6 / constraints 10.6 / candidates 16.4 / select 21.0 / decision 25.0（30s） |
| HeroInsight | Rank Cascade 十行负载瀑布 → Top1 抽取高亮其余降调 → 面包屑下钻（校园态势›负载Top1›教师025）→ 周课次柱 + 56/112 计数 → 风险摘要收束 | cascade 0.8 / top1 6.2 / breadcrumb 9.8 / schedule 12.6 / risk 18.0 / close 22.4（26s） |

色彩纪律延续 Phase 1 双色系：校区A=青绿主线，B/C/D=蓝阶；琥珀仅用于风险/提示语义；红仅 danger。ElectricBorder 全片一次。

## Implemented（工程清单）

- fixtures/heroes/*.json ×4（verified golden）+ adapters ×4 + adapters/types.ts（RiskVM / CollabVM / ReschedVM / InsightVM）
- content/heroCopy.ts（中文优先文案集中管理，单句 8–18 字）+ lib/campus.ts（校区色映射）
- director/heroes/*（4 timeline + types + registry.resolveBeat）+ store.seekToBeat/useHeroClock/reached + urlMode 别名与 beat 解析
- components/hero/ScheduleRail（时间轨+转场链）、visual/VerifiedSourcePill、RecordHUD 右下化；SceneHeader 支持 headline/sub
- 四个 Hero 场景完全重写为节拍门控渲染（reached(local, at)），元素级平滑交给 Motion 独立 transition；setTimeout 禁令遵守（动画全部声明式 delay/duration 或 Director 时钟）

## Verification（全部实跑）

- `npm run build`：PASS（tsc --noEmit + vite build ~2.7s，bundle gzip 128.5KB JS / 6.6KB CSS）
- `npm test`：**8 文件 54/54 PASS**（Phase 1 为 29；新增 fixture 溯源 8、adapters 语义 9、节拍/深链 10 等）
- qa-review.mjs：11 帧布局重叠 0、控制台错误 0、溢出 0、紫色模板像素 0%、headless fps 60、关键文案齐全（含四英雄新文案）
- qa-beats.mjs：18 张逐节拍关键帧（risk-02…insight-05）采集成功，同时实测 ?scene 短名 + ?beat 深链；reduced-motion 下 ElectricBorder `data-electric=off` 静态化
- qa-probe.mjs：光带对齐周四列、ElectricBorder 含 A1-201、矩阵戳记 5 PASS+1 提示、Top1 抽取降调（top>0.9/second<0.6）、HUD 右下贴安全区——全部 PASS
- qa-multires.mjs：1920×1080 / 1600×900 / 1366×768 全 OK

## Known Limitations / Phase 3 展望

- 总时长 169s（Phase 3 目标 4:45 合成轴：Opening 扩写 + Reliability/Closing 扩展 + 整体节奏打磨）
- collaboration 漏斗的 63/7 来自 plan_group/find_available_classrooms 的计数语义；候选 chips 仅展示 ≥120 座的 7 个真实房间名，不做虚构排序动画
- reschedule 候选云展示真实 18 间名单，收敛后的 8 间是工具核验计数（工具未枚举名单，故不虚构具体 8 个名字）
- Record Mode 的 live 徽标文案已就绪，live 数据通路仍待真机联调（Phase 1 即如此，未回退）

## 回滚路径

`git revert` 本轮 4 个提交即可整体回到 Phase 1 终点 b750774；fixtures/adapters/vendor 均为本目录新增文件，无共享状态残留。