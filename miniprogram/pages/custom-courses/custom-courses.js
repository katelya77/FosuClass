const customCourseService = require("../../services/customCourseService");
const courseOverrideService = require("../../services/courseOverrideService");
const { getBaseCoursesByClass } = require("../../utils/course");
const { getCurrentScheduleTarget } = require("../../utils/storage");

const weekdayOptions = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const sectionOptions = Array.from({ length: 14 }, (_, index) => `第${index + 1}节`);

function getDefaultForm() {
  return {
    id: "",
    courseName: "",
    teacherName: "",
    classroom: "",
    weekdayIndex: 0,
    startSectionIndex: 0,
    endSectionIndex: 1,
    weekText: "1-16周",
    color: "#3b82f6",
    note: "",
    enabled: true,
  };
}

function courseToForm(course) {
  const source = course || {};
  return {
    id: source.id || "",
    courseName: source.courseName || source.displayCourseName || source.canonicalCourseName || "",
    teacherName: source.teacherName || source.displayTeacherName || source.canonicalTeacherName || "",
    classroom: source.classroom || source.displayClassroom || source.canonicalClassroom || "",
    weekdayIndex: Math.max(0, Number(source.weekday || source.weekDay || 1) - 1),
    startSectionIndex: Math.max(0, Number(source.startSection || 1) - 1),
    endSectionIndex: Math.max(0, Number(source.endSection || 2) - 1),
    weekText: source.weekText || "1-16周",
    color: source.color || "#3b82f6",
    note: source.note || source.remark || "",
    enabled: source.enabled !== false,
  };
}

function buildTargetLabel(target) {
  if (!target) {
    return "未绑定课表";
  }
  if (target.type === "teacher") {
    return `${target.name} 老师`;
  }
  if (target.type === "classroom") {
    return `${target.name} 教室`;
  }
  return target.name || target.className || "当前课表";
}

function filterSourceCourses(courses, query) {
  const keyword = String(query || "").trim().toLowerCase();
  if (!keyword) return courses;
  return courses.filter((item) => [item.courseName, item.teacherName, item.classroom]
    .some((value) => String(value || "").toLowerCase().includes(keyword)));
}

Page({
  data: {
    targetLabel: "未绑定课表",
    courses: [],
    sourceCourses: [],
    visibleSourceCourses: [],
    sourceQuery: "",
    sourceCount: 0,
    overrideCount: 0,
    formMode: "custom",
    sourceIndex: -1,
    formVisible: false,
    formTitle: "添加课程",
    weekdayOptions,
    sectionOptions,
    form: getDefaultForm(),
    importToolsCollapsed: true,
    predefinedColors: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#6b7280"]
  },

  onLoad() {
    const draft = customCourseService.takeCustomCourseDraft();
    const editDraft = courseOverrideService.takeEditDraft();
    this.loadCourses();
    if (editDraft) {
      const match = this.data.sourceCourses.find((item) =>
        (editDraft.sourceId && item.sourceId === editDraft.sourceId) ||
        item.signature === editDraft.signature);
      if (match) this.openSourceCourse(match.sourceIndex);
      else wx.showToast({ title: "原课程已更新，请从列表重新选择", icon: "none" });
    } else if (draft) {
      this.setData({
        formVisible: true,
        formTitle: "复制为自定义课程",
        formMode: "custom",
        form: courseToForm(draft),
      });
    }
  },

  onShow() {
    this.loadCourses();
  },

  loadCourses() {
    const target = getCurrentScheduleTarget();
    const courses = customCourseService.getCustomCourses(target);
    const baseCourses = target ? getBaseCoursesByClass(target.name || target.className) : [];
    const effective = courseOverrideService.applyCourseOverrides(baseCourses, target);
    const entries = courseOverrideService.getSourceEntries(baseCourses);
    const sourceCourses = entries.map((entry) => {
      const course = effective[entry.index];
      const values = courseOverrideService.getSourceEditableValues(course);
      return Object.assign({}, values, {
        sourceIndex: entry.index,
        sourceId: entry.sourceId,
        signature: entry.signature,
        personalized: Boolean(course.personalized),
        weekdayText: weekdayOptions[values.weekday - 1] || "",
      });
    });
    this._baseCourses = baseCourses;
    this.setData({
      targetLabel: buildTargetLabel(target),
      courses,
      sourceCourses,
      visibleSourceCourses: filterSourceCourses(sourceCourses, this.data.sourceQuery),
      sourceCount: sourceCourses.length,
      overrideCount: sourceCourses.filter((item) => item.personalized).length,
    });
  },

  onSourceSearch(event) {
    const sourceQuery = event.detail.value || "";
    this.setData({
      sourceQuery,
      visibleSourceCourses: filterSourceCourses(this.data.sourceCourses, sourceQuery),
    });
  },

  showAddForm() {
    this.setData({
      formVisible: true,
      formTitle: "添加课程",
      formMode: "custom",
      sourceIndex: -1,
      form: getDefaultForm(),
    });
  },

  hideForm() {
    this.setData({
      formVisible: false,
    });
  },

  editCourse(event) {
    const id = event.currentTarget.dataset.id;
    const course = this.data.courses.find((item) => item.id === id);
    if (!course) return;
    this.setData({
      formVisible: true,
      formTitle: "编辑课程",
      formMode: "custom",
      sourceIndex: -1,
      form: courseToForm(course),
    });
  },

  editSourceCourse(event) {
    this.openSourceCourse(Number(event.currentTarget.dataset.index));
  },

  openSourceCourse(index) {
    const source = this._baseCourses && this._baseCourses[index];
    if (!source) return;
    const effective = courseOverrideService.applyCourseOverrides(this._baseCourses, getCurrentScheduleTarget())[index];
    const values = courseOverrideService.getSourceEditableValues(effective);
    this.setData({
      formVisible: true,
      formTitle: effective.personalized ? "调整课程" : "编辑已有课程",
      formMode: "override",
      sourceIndex: index,
      form: courseToForm(values),
    });
  },

  restoreSourceCourse(event) {
    const index = Number(event.currentTarget.dataset.index);
    const source = this._baseCourses && this._baseCourses[index];
    if (!source) return;
    wx.showModal({
      title: "恢复原课程信息",
      content: "这门课的个人调整将被移除，重新显示当前课表来源的数据。",
      confirmText: "恢复",
      success: (result) => {
        if (!result.confirm) return;
        try {
          courseOverrideService.restoreCourseOverride(source, this._baseCourses, getCurrentScheduleTarget());
          this.loadCourses();
          wx.showToast({ title: "已恢复原课程", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "恢复失败", icon: "none" });
        }
      },
    });
  },

  deleteCourse(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "删除自定义课程",
      content: "删除后会从首页周课表和今日课程中移除。",
      confirmText: "删除",
      confirmColor: "#d94c6a",
      success: (res) => {
        if (!res.confirm) return;
        customCourseService.deleteCustomCourse(id, getCurrentScheduleTarget());
        this.loadCourses();
        wx.showToast({ title: "已删除", icon: "success" });
      },
    });
  },

  toggleCourse(event) {
    const id = event.currentTarget.dataset.id;
    const enabled = event.detail.value;
    customCourseService.toggleCustomCourse(id, enabled, getCurrentScheduleTarget());
    this.loadCourses();
  },

  onInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      [`form.${key}`]: event.detail.value,
    });
  },

  onPickerChange(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      [`form.${key}`]: Number(event.detail.value),
    });
  },

  onEnabledChange(event) {
    this.setData({
      "form.enabled": event.detail.value,
    });
  },

  saveCourse() {
    const form = this.data.form;
    if (this.data.formMode === "override") {
      const source = this._baseCourses && this._baseCourses[this.data.sourceIndex];
      try {
        courseOverrideService.saveCourseOverride(source, {
          courseName: form.courseName,
          teacherName: form.teacherName,
          classroom: form.classroom,
          weekday: form.weekdayIndex + 1,
          startSection: form.startSectionIndex + 1,
          endSection: form.endSectionIndex + 1,
          weekText: form.weekText,
          note: form.note,
        }, this._baseCourses, getCurrentScheduleTarget());
        this.setData({ formVisible: false });
        this.loadCourses();
        wx.showToast({ title: "个人调整已保存", icon: "success" });
      } catch (error) {
        wx.showToast({ title: error.message || "保存失败", icon: "none" });
      }
      return;
    }
    const payload = {
      id: form.id,
      courseName: form.courseName,
      teacherName: form.teacherName,
      classroom: form.classroom,
      weekday: form.weekdayIndex + 1,
      weekDay: form.weekdayIndex + 1,
      startSection: form.startSectionIndex + 1,
      endSection: form.endSectionIndex + 1,
      weekText: form.weekText,
      color: form.color,
      note: form.note,
      enabled: form.enabled,
    };
    try {
      customCourseService.upsertCustomCourse(payload, getCurrentScheduleTarget());
      this.setData({
        formVisible: false,
      });
      this.loadCourses();
      wx.showToast({ title: "已保存", icon: "success" });
    } catch (error) {
      wx.showToast({
        title: error.message || "保存失败",
        icon: "none",
      });
    }
  },

  importXls() {
    wx.navigateTo({
      url: "/pages/personal-sync/personal-sync?tab=xls",
    });
  },

  exportJson() {
    const text = JSON.stringify(this.data.courses, null, 2);
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: "已复制 JSON", icon: "success" }),
    });
  },

  importJson() {
    wx.getClipboardData({
      success: (res) => {
        try {
          const data = JSON.parse(res.data || "[]");
          if (!Array.isArray(data)) {
            throw new Error("JSON 必须是数组");
          }
          data.forEach((item) => customCourseService.upsertCustomCourse(item, getCurrentScheduleTarget()));
          this.loadCourses();
          wx.showToast({ title: "导入完成", icon: "success" });
        } catch (error) {
          wx.showToast({ title: "剪贴板 JSON 无效", icon: "none" });
        }
      },
    });
  },

  showImportPlaceholder(event) {
    const label = event.currentTarget.dataset.label || "导入";
    wx.showToast({
      title: `${label} 即将支持`,
      icon: "none",
    });
  },

  toggleImportTools() {
    this.setData({
      importToolsCollapsed: !this.data.importToolsCollapsed
    });
  },

  selectColor(event) {
    const color = event.currentTarget.dataset.color;
    this.setData({
      "form.color": color
    });
  },

  noop() {},
});
