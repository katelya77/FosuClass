const customCourseService = require("../../services/customCourseService");
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
    color: "",
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
    color: source.color || "",
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

Page({
  data: {
    targetLabel: "未绑定课表",
    courses: [],
    formVisible: false,
    formTitle: "添加课程",
    weekdayOptions,
    sectionOptions,
    form: getDefaultForm(),
  },

  onLoad() {
    const draft = customCourseService.takeCustomCourseDraft();
    this.loadCourses();
    if (draft) {
      this.setData({
        formVisible: true,
        formTitle: "复制为自定义课程",
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
    this.setData({
      targetLabel: buildTargetLabel(target),
      courses,
    });
  },

  showAddForm() {
    this.setData({
      formVisible: true,
      formTitle: "添加课程",
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
      form: courseToForm(course),
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

  noop() {},
});
