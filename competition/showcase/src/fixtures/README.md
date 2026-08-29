# fixtures/

Showcase 数据目录。纪律见 `../data/types/fixture.ts`：

- **Golden**：`source: "adp-runtime-golden"` + `verified: true`，只允许来自真实 ADP / CampusTools 已核验输出或 Runtime Golden 导出。
- **Placeholder**：`source: "placeholder"` + `verified: false`，UI 必须以「占位示意数据」明示。

Phase 1 全部为 placeholder。Phase 2 计划从
`competition/adp-kit/reports/current-adp-checkpoint.md` 与 final acceptance 载荷
导出 VerifiedFixture（含 capturedAt / dataVersion 溯源），并接入 provenance 门禁测试。
