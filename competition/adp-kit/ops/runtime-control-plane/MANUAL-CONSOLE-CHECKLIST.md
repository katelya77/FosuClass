# Manual Console Checklist

Only complete rows reported by `npm run adp:diff`.

- [ ] Open 腾讯智能 ADP → 应用 → 校园智序·小序 → 智能体. Open each of the four Agents, replace its Prompt with the matching file shown in `desired-state/agents.json`, save, then verify the next snapshot Prompt hash matches.
- [ ] Open 小序-主协调 → 工具. Remove every CampusTools plugin selection; keep the platform transfer/knowledge capabilities already in use. Verify CampusTools count is 0.
- [ ] Open 课程空间 / 风险规划 / 校园洞察 → 工具. Set the exact lists in `desired-state/campus-tools.json`. Verify the totals shown by export audit are 13 unique operations and 14 bindings.
- [ ] Open 小序-主协调 → 工具 → 添加平台工具. Select the official 图片理解/视觉理解 tool. Do not add it to any Child. Upload one image in Preview and verify the image is observed before claiming multimodal live.
- [ ] Open 插件 → CampusTools → 导入/更新 OpenAPI. Use `r49-ma/tools/openapi/campus-agent-tools.adp-import.json`; keep the existing bearer credential in Console and never paste it into a file. Verify 13 operations are visible.
- [ ] Open Widget settings. Keep `小序-校园智序结果卡`; do not create another Decision or Vision Widget.
- [ ] Open workflow/release settings. Confirm no legacy workflow is active and do not click 创建发布 / 发布.
- [ ] Export the CampusTools plugin ZIP. Run `npm run adp:audit:plugin -- <zip-path>` and require PASS.
- [ ] In Preview, ask three semantically equivalent “larger capacity preferred” requests. Verify each makes one business query and the first call already contains the structured preference.
- [ ] Rerun `npm run adp:snapshot` and `npm run adp:diff`; verify no unexplained drift remains. Keep the application unpublished.

Rollback: reopen the changed Agent/tool page, restore the immediately preceding saved value from the redacted pre-change snapshot or prior Git Prompt, save, and rerun snapshot/diff. Never use release creation as rollback.
