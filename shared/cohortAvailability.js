"use strict";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function gradeOf(value) {
  const source = value && typeof value === "object" ? value : {};
  const direct = text(source.grade || source.gradeName || source.year || source.enrollmentYear);
  if (/^20\d{2}$/.test(direct)) return direct;
  const combined = text(source.className || source.name || source.label || source.classId || source.id);
  const match = combined.match(/(?:^|\D)(20\d{2})(?:\D|$)/);
  return match ? match[1] : "";
}

function classIdOf(value) {
  const source = value && typeof value === "object" ? value : {};
  return text(source.classId || source.id || source.code || source.adminClassId || source.className || source.name);
}

function hasSchedule(schedule) {
  const source = schedule && typeof schedule === "object" ? schedule : {};
  const courses = Array.isArray(source.courses) ? source.courses :
    (Array.isArray(source.items) ? source.items : (Array.isArray(source.schedule) ? source.schedule : []));
  return courses.length > 0;
}

function relevantGradeSet(term, scheduledGrades) {
  const match = text(term).match(/^(20\d{2})-/);
  if (!match) return null;
  const currentAdmissionYear = Number(match[1]);
  const grades = new Set(scheduledGrades);
  for (let grade = currentAdmissionYear - 4; grade <= currentAdmissionYear; grade += 1) {
    grades.add(String(grade));
  }
  return grades;
}

function assessCohortAvailability(input = {}) {
  const catalog = input.catalog && typeof input.catalog === "object" ? input.catalog : {};
  const adminClasses = Array.isArray(catalog.adminClasses) ? catalog.adminClasses :
    (Array.isArray(catalog.classes) ? catalog.classes : []);
  const schedules = (Array.isArray(input.classSchedules) ? input.classSchedules : []).filter(hasSchedule);
  const scheduledIds = new Set(schedules.map(classIdOf).filter(Boolean));
  const scheduledNames = new Set(schedules.map((item) => text(item.className || item.name)).filter(Boolean));
  const gradeSet = new Set((Array.isArray(catalog.grades) ? catalog.grades : []).map(text).filter(Boolean));
  adminClasses.forEach((item) => { const grade = gradeOf(item); if (grade) gradeSet.add(grade); });
  schedules.forEach((item) => { const grade = gradeOf(item); if (grade) gradeSet.add(grade); });
  const scheduledGrades = schedules.map(gradeOf).filter(Boolean);
  const relevantGrades = relevantGradeSet(input.term, scheduledGrades);
  if (relevantGrades) {
    Array.from(gradeSet).forEach((grade) => {
      if (!relevantGrades.has(grade)) gradeSet.delete(grade);
    });
  }
  const visibleAdminClasses = adminClasses.filter((item) => {
    const id = classIdOf(item);
    const name = text(item.className || item.name);
    return scheduledIds.has(id) || scheduledNames.has(name);
  });
  const byGrade = {};
  Array.from(gradeSet).sort().forEach((grade) => {
    const catalogClasses = adminClasses.filter((item) => gradeOf(item) === grade);
    const scheduledClasses = visibleAdminClasses.filter((item) => gradeOf(item) === grade);
    const scheduleDocuments = schedules.filter((item) => gradeOf(item) === grade ||
      scheduledClasses.some((candidate) => classIdOf(candidate) === classIdOf(item)));
    const dataAvailable = scheduleDocuments.length > 0;
    byGrade[grade] = {
      grade,
      status: dataAvailable ? "available" : "pending_schedule_release",
      dataAvailable,
      catalogClassCount: catalogClasses.length,
      scheduledClassCount: scheduledClasses.length,
      scheduleDocumentCount: scheduleDocuments.length,
    };
  });
  return {
    byGrade,
    releasedGrades: Object.values(byGrade).filter((item) => item.dataAvailable).map((item) => item.grade),
    pendingGrades: Object.values(byGrade).filter((item) => !item.dataAvailable).map((item) => item.grade),
    visibleAdminClasses,
  };
}

module.exports = { assessCohortAvailability, gradeOf, hasSchedule, relevantGradeSet };
