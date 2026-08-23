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
 * Opening 关系图 —— Phase 1 为显式 placeholder。
 * 命名空间与 adp-kit 匿名契约一致（教师001.. / 校区A..），
 * 具体坐标与连线为视觉编排值，不含任何业务结论。
 */
export const openingGraphFixture: PlaceholderFixture<OpeningGraphPayload> = placeholderFixture({
  sceneId: "opening",
  provenanceNote: "结构示意：节点/关系类别对齐 CampusTools 领域模型，Phase 2 由 Runtime Golden 会话轨迹导出",
  payload: {
    nodes: [
      { id: "course-1", type: "course", label: "课程 01", x: 120, y: 150 },
      { id: "course-2", type: "course", label: "课程 02", x: 96, y: 330 },
      { id: "course-3", type: "course", label: "课程 03", x: 210, y: 520 },
      { id: "course-4", type: "course", label: "课程 04", x: 330, y: 96 },
      { id: "teacher-1", type: "teacher", label: "教师 009", x: 300, y: 250 },
      { id: "teacher-2", type: "teacher", label: "教师 011", x: 180, y: 430 },
      { id: "class-1", type: "class", label: "班级 02", x: 452, y: 170 },
      { id: "class-2", type: "class", label: "班级 05", x: 420, y: 420 },
      { id: "room-1", type: "room", label: "教室 A-201", x: 560, y: 90 },
      { id: "room-2", type: "room", label: "教室 B-105", x: 600, y: 330 },
      { id: "room-3", type: "room", label: "教室 C-302", x: 500, y: 560 },
      { id: "time-1", type: "time", label: "周三 08:00", x: 726, y: 210, hub: true },
      { id: "time-2", type: "time", label: "周五 14:00", x: 760, y: 470, hub: true },
      { id: "campus-1", type: "campus", label: "校区 A", x: 856, y: 340 },
    ],
    edges: [
      { from: "teacher-1", to: "course-1", kind: "teaches" },
      { from: "teacher-1", to: "course-4", kind: "teaches" },
      { from: "teacher-2", to: "course-2", kind: "teaches" },
      { from: "teacher-2", to: "course-3", kind: "teaches" },
      { from: "class-1", to: "course-1", kind: "belongs" },
      { from: "class-1", to: "course-4", kind: "belongs" },
      { from: "class-2", to: "course-2", kind: "belongs" },
      { from: "class-2", to: "course-3", kind: "belongs" },
      { from: "course-1", to: "room-1", kind: "held-at" },
      { from: "course-2", to: "room-2", kind: "held-at" },
      { from: "course-3", to: "room-3", kind: "held-at" },
      { from: "course-4", to: "room-2", kind: "held-at" },
      { from: "course-1", to: "time-1", kind: "scheduled" },
      { from: "course-3", to: "time-2", kind: "scheduled" },
      { from: "course-2", to: "time-2", kind: "scheduled" },
      { from: "course-4", to: "time-1", kind: "scheduled" },
      { from: "room-1", to: "campus-1", kind: "located" },
      { from: "room-2", to: "campus-1", kind: "located" },
      { from: "room-3", to: "campus-1", kind: "located" },
      { from: "time-1", to: "campus-1", kind: "located" },
    ],
  },
});
