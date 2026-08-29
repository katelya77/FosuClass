import rescheduleFixture from "../../fixtures/heroes/reschedule.json";
import { assertFixtureProvenance } from "../provenance/validate";
import type { ConstraintRow, RescheduleViewModel } from "./types";

/** What-if 调课 —— feasible 与 warning 必须同时成立；mutatedData 必须 false */
export function buildRescheduleViewModel(): RescheduleViewModel {
  const f = rescheduleFixture;
  assertFixtureProvenance(f as never, { sceneId: "hero-reschedule", requireVerified: true });
  const p = f.payload;
  if (!p.auto.feasible || p.auto.warningCount === 0) {
    throw new Error("reschedule fixture 语义错误：应为 feasible + warning 并存");
  }
  if (p.mutatedData !== false) {
    throw new Error("reschedule fixture 语义错误：mutatedData 必须为 false");
  }
  const c = p.checks;
  const constraints: ConstraintRow[] = [
    { key: "class", label: "班级时间", status: c.classConflict ? "fail" : "pass", detail: "目标时段无既有课次" },
    { key: "teacher", label: "教师时间", status: c.teacherConflict ? "fail" : "pass", detail: "目标时段无既有课次" },
    { key: "room", label: "教室占用", status: c.roomConflict ? "fail" : "pass", detail: p.explicit.targetRoomResolved.name + " 该时段可用" },
    { key: "capacity", label: "容量", status: c.capacityOk ? "pass" : "fail", detail: "容量核验通过 · " + p.auto.suggestedRoom.capacity + " 座" },
    { key: "feature", label: "功能属性", status: c.featureOk ? "pass" : "fail", detail: "满足课程功能要求" },
    { key: "continuous", label: "连续授课", status: "warn", detail: p.warnings[0].text },
  ];
  return {
    courseName: p.courseName,
    className: p.className,
    teacherName: p.teacherName,
    source: { ...p.source },
    target: { ...p.target },
    constraints,
    autoResolve: {
      feasible: p.auto.feasible,
      spaceRoomCount: p.auto.spaceAvailabilityRoomCount,
      suggested: { ...p.auto.suggestedRoom },
    },
    explicitRoom: { ...p.explicit.targetRoomResolved },
    warningText: p.warnings[0].text,
    feasible: true,
    mutatedData: false,
    candidateNames: p.candidateSlotRooms.map((r) => r.name),
  };
}