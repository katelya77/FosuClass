const {
  mockClasses,
  collegeOptions,
  gradeOptions,
  majorOptions,
} = require("../../data/mockClasses");
const { saveSettings } = require("../../utils/storage");

Page({
  data: {
    keyword: "",
    colleges: ["全部学院"].concat(collegeOptions),
    grades: ["全部年级"].concat(gradeOptions),
    majors: ["全部专业"].concat(majorOptions),
    selectedCollege: "",
    selectedGrade: "",
    selectedMajor: "",
    classes: mockClasses,
    visibleClasses: mockClasses,
    extensionEntries: [
      { title: "教师课表查询", desc: "对应 /kbcx/kbxx_teacher", type: "teacher" },
      { title: "教室课表查询", desc: "对应 /kbcx/kbxx_classroom", type: "classroom" },
      { title: "课程课表查询", desc: "对应 /kbcx/kbxx_kc", type: "course" },
    ],
  },

  onLoad() {
    this.applyFilters();
  },

  onFilterChange(event) {
    const patch = Object.assign({}, event.detail);
    ["selectedCollege", "selectedGrade", "selectedMajor"].forEach((key) => {
      if (/^全部/.test(patch[key])) {
        patch[key] = "";
      }
    });
    this.setData(patch, () => this.applyFilters());
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const result = this.data.classes.filter((item) => {
      const matchesKeyword =
        !keyword ||
        `${item.className} ${item.college} ${item.grade} ${item.major}`.toLowerCase().indexOf(keyword) >= 0;
      const matchesCollege = !this.data.selectedCollege || item.college === this.data.selectedCollege;
      const matchesGrade = !this.data.selectedGrade || item.grade === this.data.selectedGrade;
      const matchesMajor = !this.data.selectedMajor || item.major === this.data.selectedMajor;
      return matchesKeyword && matchesCollege && matchesGrade && matchesMajor;
    });
    this.setData({
      visibleClasses: result,
    });
  },

  chooseClass(event) {
    const classInfo = this.data.visibleClasses[Number(event.currentTarget.dataset.index)];
    if (!classInfo) {
      return;
    }
    saveSettings({
      className: classInfo.className,
      semester: classInfo.semester,
    });
    wx.showToast({
      title: "已切换班级",
      icon: "success",
      duration: 900,
    });
    setTimeout(() => {
      wx.switchTab({
        url: "/pages/index/index",
      });
    }, 650);
  },

  showDeveloping(event) {
    const title = event.currentTarget.dataset.title;
    wx.showModal({
      title,
      content: "第一阶段先预留入口。接入真实强智教务接口前，需要提供脱敏抓包信息。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
