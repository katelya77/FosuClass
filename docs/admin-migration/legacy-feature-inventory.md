# Legacy Admin Feature Inventory (Phase A)

- Stable input fingerprint: `ab33c3a8d2f50faf7543a90849f44426f926db85ae3cae0aa3bfdac5cdc3e8a0`
- Generator version: `2`
- Rollout manifest version: `2026-07-18.c1-foundation.1`
- Production primary remains: **legacy**
- API routes inventoried: **164**
- Write routes: **95**
- Total matrix rows (API + UI): **167**

## Goals

```text
/admin        → full Vue admin (after Phase E cutover)
/admin-next   → parallel Vue entry during migration
/admin-legacy → emergency Legacy fallback during migration
```

Phase A does **not** change production primary admin.

## Architecture constraint

```text
Legacy UI ─┐
           ├─→ Domain Controller → Domain Service → Repository
Vue UI ────┘
```

No duplicated business logic between Legacy handlers and Vue-only handlers.

## Legacy navigation

| Group | Section | Label | Domain | Vue route | Vue baseline |
|-------|---------|-------|--------|-----------|--------------|
| 总览 | `dashboard` | 数据概览 | dashboard | `/dashboard` | read-only |
| 数据与课表 | `catalog` | 数据资源 | catalog | `/catalog` | write-implemented |
| 数据与课表 | `terms` | 学期管理 | term | `/terms` | read-only |
| 数据与课表 | `quality` | 数据质量 | quality | `/quality` | write-implemented |
| 发布与运维 | `sync` | 同步中心 | sync | `/sync` | read-only |
| 发布与运维 | `config` | 数据版本 | settings | `/settings` | write-implemented |
| 内容管理 | `notices` | 公告管理 | content | `/content` | write-implemented |
| 内容管理 | `news` | 最新动态 | content | `/content` | write-implemented |
| 内容管理 | `campus-map` | 校园地图 | campus-map | `/campus-map` | read-only |
| 内容管理 | `feedback` | 反馈管理 | feedback | `/feedback` | write-implemented |
| 内容管理 | `assistant-kb` | 助手知识库 | assistant | `/assistant` | missing |
| 系统与安全 | `ai-provider` | 查询服务 | provider | `/provider` | missing |
| 系统与安全 | `security` | 安全状态 | security | `/security` | read-only |
| 系统与安全 | `settings` | 系统设置 | settings | `/settings` | write-implemented |

## Domain summary

| Domain | Features | Target module |
|--------|----------|---------------|
| assistant | 9 | `assistant` |
| audit | 2 | `audit` |
| auth | 3 | `auth` |
| backups | 9 | `backups` |
| campus-map | 17 | `campus-map` |
| catalog | 11 | `catalog` |
| content | 8 | `content` |
| dashboard | 5 | `dashboard` |
| feedback | 5 | `feedback` |
| jobs | 2 | `jobs` |
| misc | 8 | `settings` |
| provider | 5 | `provider` |
| quality | 5 | `quality` |
| relay | 6 | `relay` |
| release | 31 | `release` |
| security | 4 | `security` |
| settings | 11 | `settings` |
| staging | 17 | `staging` |
| term | 9 | `term` |

## nextStatus distribution

| Status | Count |
|--------|-------|
| browser-verified | 24 |
| contract-verified | 26 |
| missing | 31 |
| read-only | 82 |
| write-implemented | 4 |

## Risk distribution

| Risk | Count |
|------|-------|
| critical | 22 |
| high | 52 |
| low | 37 |
| medium | 56 |

## Critical write / control-plane APIs

| API | Domain | Confirmation | Idempotency | Production smoke |
|-----|--------|--------------|-------------|------------------|
| `POST /api/admin/assistant-kb/publish` | assistant | true | true | false |
| `POST /api/admin/assistant-kb/rollback` | assistant | true | true | false |
| `POST /api/admin/campus-map/publish` | campus-map | true | true | false |
| `POST /api/admin/campus-map/rollback` | campus-map | true | true | false |
| `POST /api/admin/release-pack/rebuild/start` | release | true | true | true |
| `POST /api/admin/release/activate` | release | true | true | false |
| `POST /api/admin/snapshot/activate` | backups | true | true | false |
| `POST /api/admin/staging/upload/rebuild-index` | staging | true | true | true |
| `POST /api/admin/static-release-sync/start` | release | true | true | true |
| `POST /api/admin/storage/maintenance/run` | settings | true | true | false |
| `POST /api/admin/sync/releases/rebuild-index` | release | true | true | true |
| `POST /api/admin/sync/releases/rollback` | release | true | true | false |
| `POST /api/admin/sync/staging/publish` | staging | true | true | false |
| `POST /api/admin/sync/staging/publish/start` | staging | true | true | false |
| `POST /api/admin/terms/:term/activate` | term | true | true | false |
| `POST /api/admin/terms/:term/bind-release` | term | true | false | true |
| `POST /api/admin/terms/:term/rebuild-runtime-pointer` | term | true | true | true |
| `POST /api/admin/terms/:term/repair-release/start` | release | true | true | false |
| `POST /api/admin/release/activate` | release | true | true | false |

## Vue baseline (PR #7 shell)

- ExperimentalPage used: **true**
- Experimental legacy sections: `assistant-kb`, `ai-provider`
- Pages still calling `legacyAdminUrl()`: `CampusMapPage.vue`, `ExperimentalPage.vue`, `SyncCenterPage.vue`, `TermsPage.vue`

## Feature matrix schema

Each feature row includes:

```json
{
  "domain": "content",
  "legacyPage": "notices",
  "action": "create-notice",
  "legacyApi": "POST /api/admin/notices",
  "risk": "medium",
  "writesData": true,
  "requiresCsrf": true,
  "requiresConfirmation": false,
  "auditAction": "create",
  "nextStatus": "missing"
}
```

Canonical machine-readable file: [`feature-matrix.json`](./feature-matrix.json)

## API contracts

- Routes with contract stubs: **164**
- File: [`api-contracts.json`](./api-contracts.json)
- Methods, request/response envelopes, and error code sets are recorded for every `/api/admin/*` route.
- Domain-specific Zod/schemas are filled as modules are extracted (Phase B+).

## Phase roadmap

| Phase | Branch | Focus | Primary stays |
|-------|--------|-------|---------------|
| A | `grok/admin-parity-a-inventory` | Inventory + contracts + CI guards | legacy |
| B | `grok/admin-parity-b-crud` | content / feedback / audit / backups writes | legacy |
| C | `grok/admin-parity-c-system` | catalog / quality / map / kb / provider / security / settings / relay | legacy |
| D | `grok/admin-parity-d-control-plane` | staging / release / static / term / jobs | legacy |
| E | `grok/admin-parity-e-cutover` | Vue primary | next |
| F | `grok/admin-parity-f-remove-legacy` | Remove Legacy UI after stability evidence | next |

## Regeneration

```bash
node tools/generate-admin-feature-matrix.js
node tools/generate-admin-feature-matrix.js --check
node tools/test-admin-feature-matrix.js
```

Do not hand-edit `feature-matrix.json` route rows without regenerating, or CI will fail drift checks.

