/**
 * 数据纪律（Phase 1 契约）：
 * - 所有动态校园事实只能来自「真实 ADP / CampusTools 已核验输出」
 *   或「从真实 ADP Runtime Golden 导出的 fixture」（source: 'adp-runtime-golden', verified: true）。
 * - Phase 1 只有 placeholder：verified 必须为 false、source 必须为 'placeholder'，
 *   绝不能伪装 Golden，也绝不能在 UI 中呈现得像 Live。
 */
export const FIXTURE_SOURCE_GOLDEN = "adp-runtime-golden" as const;
export const FIXTURE_SOURCE_PLACEHOLDER = "placeholder" as const;

export type FixtureSource = typeof FIXTURE_SOURCE_GOLDEN | typeof FIXTURE_SOURCE_PLACEHOLDER;

export interface VerifiedFixture<T> {
  fixtureVersion: string;
  sceneId: string;
  source: typeof FIXTURE_SOURCE_GOLDEN;
  dataVersion: string;
  verified: true;
  capturedAt: string;
  /** 溯源说明：精确到确定性工具调用参数与 queryId，可离线复现 */
  provenanceNote?: string;
  payload: T;
}

export interface PlaceholderFixture<T> {
  fixtureVersion: string;
  sceneId: string;
  source: typeof FIXTURE_SOURCE_PLACEHOLDER;
  dataVersion: string;
  verified: false;
  capturedAt: string;
  /** 可选的人类可读溯源说明（例如指向 adp-kit checkpoint 的哪条证据） */
  provenanceNote?: string;
  payload: T;
}

export type AnyFixture<T> = VerifiedFixture<T> | PlaceholderFixture<T>;

export function placeholderFixture<T>(input: {
  sceneId: string;
  dataVersion?: string;
  fixtureVersion?: string;
  capturedAt?: string;
  provenanceNote?: string;
  payload: T;
}): PlaceholderFixture<T> {
  return {
    fixtureVersion: input.fixtureVersion ?? "0.1.0",
    sceneId: input.sceneId,
    source: FIXTURE_SOURCE_PLACEHOLDER,
    dataVersion: input.dataVersion ?? "competition-demo-v3-derived-placeholder",
    verified: false,
    capturedAt: input.capturedAt ?? "2026-08-19T00:00:00+08:00",
    provenanceNote:
      input.provenanceNote ??
      "占位示意：结构对齐 competition/adp-kit 契约，数值待 Phase 2 从 Runtime Golden 导出替换",
    payload: input.payload,
  };
}
