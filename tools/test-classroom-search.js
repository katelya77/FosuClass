const assert = require("assert");
const classroomSearch = require("../miniprogram/utils/classroomSearch");

const variants = ["C7", "c7", "C 7", "C７", "C7楼", "C7教学楼"];
variants.forEach((query) => {
  assert.deepStrictEqual(classroomSearch.parseClassroomQuery(query), {
    queryType: "building",
    buildingCode: "C7",
    roomNumber: "",
    normalizedQuery: "C7",
  });
});

["C7-305", "C7 305", "C7－305", "C7_305"].forEach((query) => {
  assert.deepStrictEqual(classroomSearch.parseClassroomQuery(query), {
    queryType: "exact-room",
    buildingCode: "C7",
    roomNumber: "305",
    normalizedQuery: "C7-305",
  });
});

const rooms = [
  { id: "c7-101", roomName: "C7-101", buildingCode: "C7", aliases: ["医学实验室"], description: "医学实验室" },
  { id: "c7-305", roomName: "C7-305", buildingCode: "C7", aliases: ["C7_305"] },
  { id: "c7-306", roomName: "C7-306", buildingCode: "C7" },
  { id: "c7-307", roomName: "C7-307", buildingCode: "C7" },
  { id: "c7-10", roomName: "C7-10", buildingCode: "C7" },
  { id: "c7-2", roomName: "C7-2", buildingCode: "C7" },
  { id: "c5-101", roomName: "C5-101", buildingCode: "C5", description: "contains C7 in old note" },
  { id: "b7-201", roomName: "B7-201", buildingCode: "B7" },
  { id: "accidental", roomName: "A1-101", buildingCode: "A1", courseName: "C7 topic", description: "not a C7 room" },
  { id: "zhiyong", roomName: "致用楼", aliases: ["致用楼"], description: "运动场旁" },
];

const c7 = classroomSearch.filterAndSortClassrooms(rooms, classroomSearch.parseClassroomQuery("C7"));
assert(c7.length > 0, "C7 should return matching rooms");
assert(c7.every((item) => classroomSearch.getBuildingCode(item) === "C7"), "C7 must only return C7 rooms");
assert(!c7.some((item) => item.id === "c5-101" || item.id === "b7-201" || item.id === "accidental"));

const c5 = classroomSearch.filterAndSortClassrooms(rooms, classroomSearch.parseClassroomQuery("C5"));
assert.deepStrictEqual([...new Set(c5.map((item) => classroomSearch.getBuildingCode(item)))], ["C5"], "C5 must only return C5 rooms");

const exact = classroomSearch.filterAndSortClassrooms(rooms, classroomSearch.parseClassroomQuery("C7-305"));
assert.strictEqual(exact[0].id, "c7-305", "exact room should be first");
assert(exact.slice(1, 4).every((item) => classroomSearch.getBuildingCode(item) === "C7"), "fallback exact-room results stay in same building");

const z99 = classroomSearch.filterAndSortClassrooms(rooms, classroomSearch.parseClassroomQuery("Z99"));
assert.deepStrictEqual(z99, [], "Z99 should return empty results");

const chinese = classroomSearch.filterAndSortClassrooms(rooms, classroomSearch.parseClassroomQuery("医学实验室"));
assert.strictEqual(chinese[0].id, "c7-101", "plain Chinese search should use aliases/description");

const natural = classroomSearch.filterAndSortClassrooms([
  { roomName: "C7-10", buildingCode: "C7" },
  { roomName: "C7-2", buildingCode: "C7" },
  { roomName: "C7-101", buildingCode: "C7" },
], classroomSearch.parseClassroomQuery("C7")).map((item) => item.roomName);
assert.deepStrictEqual(natural, ["C7-2", "C7-10", "C7-101"], "rooms should use natural numeric sorting");

console.log("test-classroom-search passed");
