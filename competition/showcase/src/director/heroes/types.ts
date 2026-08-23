export interface BeatDef {
  /** 全局唯一 beat id（?beat= 参数使用），如 risk.routes */
  id: string;
  /** 场景内秒数 */
  at: number;
}