"use strict";

const crypto = require("crypto");

function computeDataHash(dataset) {
  const source = dataset || {};
  const meta = source.meta || {};
  const canonical = {
    semester: meta.semester, periods: meta.periods,
    campuses: source.campuses, colleges: source.colleges, classes: source.classes,
    teachers: source.teachers, courses: source.courses, rooms: source.rooms, lessons: source.lessons,
  };
  return `sha1:${crypto.createHash("sha1").update(JSON.stringify(canonical)).digest("hex").slice(0, 12)}`;
}

module.exports = { computeDataHash };
