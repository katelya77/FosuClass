/**
 * motionTokens.ts —— 全局统一运动语言（Phase 2.5）。
 * React Bits 组件与一切 Motion 动画都映射到这里，禁止各组件散落自定义 timing。
 * 与 src/styles/tokens.css 的 --dur-* / --ease-* 一一对应。
 */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const; // 主：快出慢进（expo-out）
export const EASE_IO = [0.83, 0, 0.17, 1] as const; // 镜头/重型转场用：强进强出
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const; // 温和往返

/** 时长分级（毫秒） */
export const DUR = {
  fast: 240,
  standard: 520,
  scene: 950,
  cinematic: 1450,
} as const;

/** 语义别名：场景内元素用，长度与 DUR 对应 */
export const DURATION = {
  fast: 0.24,
  standard: 0.52,
  scene: 0.95,
  cinematic: 1.45,
} as const;

/** 弹簧手感（供 useSpring / spring() 使用） */
export const SPRING = {
  /** 数字/小元素落定 */
  snappy: { type: "spring", stiffness: 300, damping: 30, mass: 0.7 } as const,
  /** 卡片 / 面板浮起 */
  card: { type: "spring", stiffness: 180, damping: 26, mass: 0.9 } as const,
  /** 镜头推进 */
  camera: { type: "spring", stiffness: 120, damping: 30, mass: 1.1 } as const,
} as const;

/** 景深模糊（px），供 filter blur 使用 */
export const BLUR = { xs: 3, sm: 7, md: 15, lg: 30 } as const;

/** 缩放等级（SceneCamera / depth cascade 用） */
export const SCALE = {
  depth0: 1,
  depth1: 0.96,
  depth2: 0.9,
  depth3: 0.8,
  depthOut: 0.72,
} as const;

/** 交错入场（多元素） */
export const STAGGER = {
  fast: 0.07,
  standard: 0.12,
  scene: 0.18,
} as const;

/** 统一 transition 简写（供 motion transition 用） */
export const T = {
  fast: { duration: 0.24, ease: EASE_OUT },
  standard: { duration: 0.52, ease: EASE_OUT },
  scene: { duration: 0.95, ease: EASE_OUT },
  cinematic: { duration: 1.45, ease: EASE_OUT },
  camera: { duration: 1.1, ease: EASE_IO },
} as const;