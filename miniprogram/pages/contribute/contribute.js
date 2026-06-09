const request = require("../../utils/request");
const { getSettings } = require("../../utils/storage");
const appConfigService = require("../../services/appConfigService");
const { getRuntimeTermConfig } = require("../../utils/week");

Page({
  data: {
    semesterOptions: [],
    selectedSemesterIndex: 0,
    collegeName: "",
    majorName: "",
    grade: "",
    className: "",
    jsonText: "",
    loading: false,
  },

  onLoad() {
    this.prefillInfo();
    this.loadTermOptions();
  },

  loadTermOptions() {
    const settings = getSettings();
    const selected = settings.semesterId || settings.semester || getRuntimeTermConfig().term;
    const applyTerms = (config) => {
      const terms = (config.availableTerms || [])
        .filter((item) => item && item.term && item.status !== "planned" && item.status !== "disabled")
        .map((item) => item.term);
      if (selected && terms.indexOf(selected) < 0) terms.unshift(selected);
      const semesterOptions = terms.length ? terms : [selected || getRuntimeTermConfig().term].filter(Boolean);
      const selectedSemesterIndex = Math.max(0, semesterOptions.indexOf(selected));
      this.setData({ semesterOptions, selectedSemesterIndex });
    };
    applyTerms(appConfigService.getGlobalConfig());
    appConfigService.loadAppConfig({ silent: true }).then(applyTerms).catch(() => {});
  },

  prefillInfo() {
    // 尝试预填已保存的班级和学期配置，减少用户输入负担
    try {
      const settings = getSettings();
      if (settings && settings.className) {
        // 通常班级名称如 "动物医学2023级1班"，可以尝试正则匹配出年级
        const gradeMatch = settings.className.match(/\d{4}/);
        const grade = gradeMatch ? gradeMatch[0] : "";
        
        this.setData({
          className: settings.className,
          grade: grade,
          collegeName: settings.collegeName || "",
          majorName: settings.majorName || "",
        });
      }
    } catch (e) {
      console.error("Prefill config failed", e);
    }
  },

  onSemesterChange(event) {
    this.setData({
      selectedSemesterIndex: Number(event.detail.value),
    });
  },

  loadTemplate() {
    const sample = {
      courses: [
        {
          courseName: "高等数学",
          teacherName: "李教授",
          classroom: "C7-302",
          weeks: [1, 2, 3, 4, 5, 6, 7, 8],
          dayOfWeek: 1,
          sections: [1, 2],
        },
        {
          courseName: "大学物理",
          teacherName: "王副教授",
          classroom: "B5-102",
          weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
          dayOfWeek: 3,
          sections: [3, 4],
        }
      ]
    };
    this.setData({
      jsonText: JSON.stringify(sample, null, 2),
    });
    wx.showToast({
      title: "示例模板已加载",
      icon: "none",
    });
  },

  onSubmit(event) {
    const { collegeName, majorName, className, grade, jsonText } = event.detail.value;
    const semester = this.data.semesterOptions[this.data.selectedSemesterIndex];

    if (!collegeName.trim() || !majorName.trim() || !className.trim() || !grade.trim()) {
      wx.showModal({
        title: "提示",
        content: "请填写完整的基本关联信息",
        showCancel: false,
      });
      return;
    }

    if (!jsonText.trim()) {
      wx.showModal({
        title: "提示",
        content: "请粘贴要贡献的课表 JSON 数据",
        showCancel: false,
      });
      return;
    }

    let courses = null;
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        courses = parsed;
      } else if (parsed && Array.isArray(parsed.courses)) {
        courses = parsed.courses;
      } else if (parsed && parsed.classes && Array.isArray(parsed.classes)) {
        // 如果是完整的 class-schedules 导出结构，做自动抽取
        const classObj = parsed.classes.find(c => c.className === className) || parsed.classes[0];
        if (classObj && Array.isArray(classObj.courses)) {
          courses = classObj.courses;
        }
      }
    } catch (e) {
      wx.showModal({
        title: "解析失败",
        content: "课表数据 JSON 格式不正确，请检查括号与双引号是否匹配",
        showCancel: false,
      });
      return;
    }

    if (!Array.isArray(courses) || courses.length === 0) {
      wx.showModal({
        title: "格式校验错误",
        content: "解析出的课程列表不能为空。数据须符合 courses 数组格式，包含至少一门课程。",
        showCancel: false,
      });
      return;
    }

    // 基本验证课程结构
    const isValid = courses.every(c => c && c.courseName);
    if (!isValid) {
      wx.showModal({
        title: "格式校验错误",
        content: "每门课程数据中必须包含 'courseName' 字段，请检查数据格式。",
        showCancel: false,
      });
      return;
    }

    this.setData({ loading: true });

    request.post("/api/contribute/schedule", {
      className: className.trim(),
      collegeName: collegeName.trim(),
      majorName: majorName.trim(),
      grade: grade.trim(),
      semester,
      courses,
    }, { loadingTitle: "正在上传..." })
      .then((data) => {
        this.setData({ loading: false });
        wx.showModal({
          title: "上传成功",
          content: "您的课表已上传！正在等待管理员审核，审核通过后将合并进公共课表缓存。",
          showCancel: false,
          success: () => {
            wx.navigateBack();
          }
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        // request.js 会统一弹窗提示
        console.error("Contribute failed", err);
      });
  },
});
