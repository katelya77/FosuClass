import {
  FIXTURE_SOURCE_GOLDEN,
  FIXTURE_SOURCE_PLACEHOLDER,
  type AnyFixture,
  type FixtureSource,
} from "../types/fixture";

/** UI 展示用的来源标签 —— 绝不允许 placeholder 冒充 Golden/Live */
export const FIXTURE_SOURCE_LABEL: Record<FixtureSource, string> = {
  [FIXTURE_SOURCE_GOLDEN]: "已核验 Runtime 快照",
  [FIXTURE_SOURCE_PLACEHOLDER]: "占位示意数据",
};

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvenanceError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export function isVerifiedFixture<T>(f: AnyFixture<T>): f is AnyFixture<T> & { verified: true; source: typeof FIXTURE_SOURCE_GOLDEN } {
  return isRecord(f) && f.source === FIXTURE_SOURCE_GOLDEN && f.verified === true;
}

export function isPlaceholderFixture<T>(f: AnyFixture<T>): f is AnyFixture<T> & { verified: false; source: typeof FIXTURE_SOURCE_PLACEHOLDER } {
  return isRecord(f) && f.source === FIXTURE_SOURCE_PLACEHOLDER && f.verified === false;
}

export interface ProvenanceExpectation {
  /** 期望挂载的场景；不传则不校验 */
  sceneId?: string;
  /** 要求必须是已核验 Golden（例如 record+live 混排的关键数字位） */
  requireVerified?: boolean;
}

/**
 * 校验 fixture 溯源自洽性：
 * 1. source=golden  ⇒ verified 必须 true；
 * 2. source=placeholder ⇒ verified 必须 false（伪装即抛错）；
 * 3. requireVerified 时拒绝 placeholder；
 * 4. sceneId 不匹配即抛错。
 */
export function assertFixtureProvenance<T>(fixture: AnyFixture<T>, expected: ProvenanceExpectation = {}): void {
  if (!isRecord(fixture)) throw new ProvenanceError("fixture 不是对象");
  for (const key of ["fixtureVersion", "sceneId", "source", "dataVersion", "capturedAt"] as const) {
    if (typeof fixture[key] !== "string" || !(fixture[key] as string).length) {
      throw new ProvenanceError(`fixture 缺少合法字段: ${key}`);
    }
  }
  const { source, verified } = fixture as { source: FixtureSource; verified: boolean };
  if (source === FIXTURE_SOURCE_GOLDEN && verified !== true) {
    throw new ProvenanceError("source=adp-runtime-golden 的 fixture 必须 verified=true");
  }
  if (source === FIXTURE_SOURCE_PLACEHOLDER && verified !== false) {
    throw new ProvenanceError("placeholder fixture 禁止声明 verified=true（不得伪装 Golden）");
  }
  if (expected.requireVerified && !isVerifiedFixture(fixture)) {
    throw new ProvenanceError("该位置要求已核验 Golden fixture，拒绝了 placeholder");
  }
  if (expected.sceneId && fixture.sceneId !== expected.sceneId) {
    throw new ProvenanceError(`sceneId 不匹配: 期望 ${expected.sceneId}，实际 ${fixture.sceneId}`);
  }
}
