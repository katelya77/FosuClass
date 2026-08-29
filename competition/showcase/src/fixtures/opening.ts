import { placeholderFixture, type PlaceholderFixture } from "../data/types/fixture";

/** 六类教学要素节点类型 */
export type GraphNodeType = "course" | "teacher" | "class" | "room" | "time" | "campus";

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  label: string;
  x: number;
  y: number;
  /** 收束阶段的引力核心（时间 / 校区） */
  hub?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: "teaches" | "belongs" | "held-at" | "scheduled" | "located";
}

export interface OpeningGraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Opening 关系图只承担领域关系解释，不承载业务结论。
 * 六个节点分别代表六类教学实体；关系严格控制为课程向四类事实展开，
 * 再由教室落到校区。任一时刻最多五条线，禁止装饰性连线。
 */
export const openingGraphFixture: PlaceholderFixture<OpeningGraphPayload> = placeholderFixture({
  sceneId: "opening",
  provenanceNote: "结构示意：节点/关系类别对齐 CampusTools 领域模型，Phase 2 由 Runtime Golden 会话轨迹导出",
  payload: {
    nodes: [
      { id: "course", type: "course", label: "课程", x: 470, y: 350, hub: true },
      { id: "teacher", type: "teacher", label: "教师", x: 180, y: 145 },
      { id: "class", type: "class", label: "班级", x: 175, y: 560 },
      { id: "room", type: "room", label: "教室", x: 748, y: 145 },
      { id: "time", type: "time", label: "时间", x: 770, y: 555 },
      { id: "campus", type: "campus", label: "校区", x: 870, y: 350 },
    ],
    edges: [
      { from: "course", to: "teacher", kind: "teaches" },
      { from: "course", to: "class", kind: "belongs" },
      { from: "course", to: "room", kind: "held-at" },
      { from: "course", to: "time", kind: "scheduled" },
      { from: "room", to: "campus", kind: "located" },
    ],
  },
});
