const {
  mockClasses,
  collegeOptions,
  gradeOptions,
  majorOptions,
} = require("../../data/mockClasses");
const { saveSettings } = require("../../utils/storage");

const tabs = [
  { key: "class", label: "班级" },
  { key: "teacher", label: "教师" },
  { key: "classroom", label: "教室" },
  { key: "course", label: "课程" },
];

const teacherSamples = [
  { id: "teacher-wangjun", teacherName: "汪军", college: "动物科技学院", title: "副教授", scheduleReady: false },
  { id: "teacher-chenfang", teacherName: "陈芳", college: "动物科技学院", title: "副教授", scheduleReady: false },
  { id: "teacher-zhaomengmeng", teacherName: "赵孟孟", college: "生命科学与工程学院", title: "讲师", scheduleReady: false },
];

const classroomSamples = [
  { id: "room-c7-503", campus: "仙溪校区", building: "C7", roomName: "C7-503", scheduleReady: false },
  { id: "room-c7-305", campus: "仙溪校区", building: "C7", roomName: "C7-305", scheduleReady: false },
  { id: "room-b5-304", campus: "仙溪校区", building: "B5", roomName: "B5-304", scheduleReady: false },
];

const courseSamples = [
  { id: "course-organic", courseName: "有机化学", college: "动物科技学院", scheduleReady: true },
  { id: "course-anatomy", courseName: "动物解剖学", college: "动物科技学院", scheduleReady: true },
  { id: "course-english", courseName: "大学英语2", college: "外国语学院", scheduleReady: false },
];

function normalizeAllOption(value) {
  return /^全部/.test(value || "") ? "" : value;
}

Page({
  data: {
    tabs,
    activeTab: "class",
    keyword: "",
    colleges: ["全部学院"].concat(collegeOptions),
    grades: ["全部年级"].concat(gradeOptions),
    majors: ["全部专业"].concat(majorOptions),
    classOptions: ["全部班级"].concat(mockClasses.map((item) => item.className)),
    campusOptions: ["全部校区", "仙溪校区", "江湾校区", "河滨校区"],
    buildingOptions: ["全部教学楼", "C7", "B5", "B8"],
    titleOptions: ["全部职称", "教授", "副教授", "讲师", "助教"],
    selectedCollege: "",
    selectedGrade: "",
    selectedMajor: "",
    selectedClassName: "",
    selectedCampus: "",
    selectedBuilding: "",
    selectedTitle: "",
    classes: mockClasses,
    visibleClasses: mockClasses,
    visibleTeachers: teacherSamples,
    visibleClassrooms: classroomSamples,
    visibleCourses: courseSamples,
  },

  onLoad() {
    this.applyFilters();
  },

  onTabChange(event) {
    this.setData({
      activeTab: event.currentTarget.dataset.key,
      keyword: "",
    }, () => this.applyFilters());
  },

  onKeywordInput(event) {
    this.setData({
      keyword: event.detail.value,
    }, () => this.applyFilters());
  },

  onCollegeChange(event) {
    this.setData({
      selectedCollege: normalizeAllOption(this.data.colleges[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onGradeChange(event) {
    this.setData({
      selectedGrade: normalizeAllOption(this.data.grades[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onMajorChange(event) {
    this.setData({
      selectedMajor: normalizeAllOption(this.data.majors[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onClassChange(event) {
    this.setData({
      selectedClassName: normalizeAllOption(this.data.classOptions[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onCampusChange(event) {
    this.setData({
      selectedCampus: normalizeAllOption(this.data.campusOptions[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onBuildingChange(event) {
    this.setData({
      selectedBuilding: normalizeAllOption(this.data.buildingOptions[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  onTitleChange(event) {
    this.setData({
      selectedTitle: normalizeAllOption(this.data.titleOptions[Number(event.detail.value)]),
    }, () => this.applyFilters());
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    this.setData({
      visibleClasses: this.filterClasses(keyword),
      visibleTeachers: this.filterTeachers(keyword),
      visibleClassrooms: this.filterClassrooms(keyword),
      visibleCourses: this.filterCourses(keyword),
    });
  },

  filterClasses(keyword) {
    return this.data.classes.filter((item) => {
      const matchesKeyword =
        !keyword ||
        `${item.className} ${item.college} ${item.grade} ${item.major}`.toLowerCase().indexOf(keyword) >= 0;
      const matchesCollege = !this.data.selectedCollege || item.college === this.data.selectedCollege;
      const matchesGrade = !this.data.selectedGrade || item.grade === this.data.selectedGrade;
      const matchesMajor = !this.data.selectedMajor || item.major === this.data.selectedMajor;
      const matchesClass = !this.data.selectedClassName || item.className === this.data.selectedClassName;
      return matchesKeyword && matchesCollege && matchesGrade && matchesMajor && matchesClass;
    });
  },

  filterTeachers(keyword) {
    return teacherSamples.filter((item) => {
      const matchesKeyword =
        !keyword || `${item.teacherName} ${item.college} ${item.title}`.toLowerCase().indexOf(keyword) >= 0;
      const matchesCollege = !this.data.selectedCollege || item.college === this.data.selectedCollege;
      const matchesTitle = !this.data.selectedTitle || item.title === this.data.selectedTitle;
      return matchesKeyword && matchesCollege && matchesTitle;
    });
  },

  filterClassrooms(keyword) {
    return classroomSamples.filter((item) => {
      const matchesKeyword =
        !keyword || `${item.campus} ${item.building} ${item.roomName}`.toLowerCase().indexOf(keyword) >= 0;
      const matchesCampus = !this.data.selectedCampus || item.campus === this.data.selectedCampus;
      const matchesBuilding = !this.data.selectedBuilding || item.building === this.data.selectedBuilding;
      return matchesKeyword && matchesCampus && matchesBuilding;
    });
  },

  filterCourses(keyword) {
    return courseSamples.filter((item) => {
      const matchesKeyword = !keyword || `${item.courseName} ${item.college}`.toLowerCase().indexOf(keyword) >= 0;
      const matchesCollege = !this.data.selectedCollege || item.college === this.data.selectedCollege;
      return matchesKeyword && matchesCollege;
    });
  },

  chooseClass(event) {
    const classInfo = this.data.visibleClasses[Number(event.currentTarget.dataset.index)];
    if (!classInfo) {
      return;
    }
    if (!classInfo.scheduleReady) {
      wx.showModal({
        title: "暂未同步",
        content: "该班级课表暂未缓存，请稍后或由管理员同步。",
        showCancel: false,
        confirmText: "知道了",
      });
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

  previewTeacher(event) {
    const item = this.data.visibleTeachers[Number(event.currentTarget.dataset.index)];
    if (!item) {
      return;
    }
    wx.showModal({
      title: item.teacherName,
      content: "教师课表接口结构已接入云函数适配层。当前教师课表尚未缓存，后续由服务端同步后展示。",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  showPendingSync() {
    wx.showModal({
      title: "待同步",
      content: "该课表尚未同步。小程序端只读取缓存，真实请求会由云函数低频执行。",
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
