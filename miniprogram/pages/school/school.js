const tabs = [
  { key: "class", label: "班级" },
  { key: "teacher", label: "教师" },
  { key: "classroom", label: "教室" },
  { key: "course", label: "课程" },
];

const request = require("../../utils/request");

function formatUpdateTime(updatedAt) {
  const date = updatedAt ? new Date(updatedAt) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function formatClassResultItem(item) {
  const source = item || {};
  const isAggregated = Boolean(source.isAggregated || source.displayType === "major-schedule");
  const className = source.className || "";
  return Object.assign({}, source, {
    scheduleKey: `${source.semester || ""}-${source.collegeCode || ""}-${source.grade || ""}-${source.majorCode || ""}-${className}`,
    displayTitle: className,
    displaySubtitle: isAggregated
      ? "暂未拆分行政班，已展示该专业教务排课"
      : `${source.majorName || "未知专业"} · ${source.grade}级 · 教务数据`,
    statusText: isAggregated ? "专业课表" : "教务数据",
    isAggregated,
    courses: Array.isArray(source.courses) ? source.courses : [],
  });
}

function getClassEmptyState(reasonCode) {
  if (reasonCode === "NO_SCHEDULE_SYNCED" || reasonCode === "NO_SYNC_DATA") {
    return {
      title: "暂未同步该专业课表",
      desc: "暂未同步该专业课表，可稍后再试或联系维护者补充同步。",
    };
  }

  if (reasonCode === "NO_MATCHED_CLASS") {
    return {
      title: "没有匹配到班级",
      desc: "已同步该专业课表，但没有匹配到所选班级。",
    };
  }

  if (reasonCode === "INVALID_FILTER") {
    return {
      title: "请选择完整筛选项",
      desc: "请选择学院、年级和专业后再查询班级课表。",
    };
  }

  return {
    title: "请选择上方筛选并查询",
    desc: "数据来自佛山大学教务系统，查询后将展示行政班级课表。",
  };
}

Page({
  data: {
    tabs,
    activeTab: "class",
    keyword: "",
    
    // 下拉选择选项
    semesters: [],
    colleges: [],
    grades: [],
    majors: [],
    
    selectedSemesterIndex: 0,
    selectedCollegeIndex: -1,
    selectedGradeIndex: -1,
    selectedMajorIndex: -1,
    
    // 教师筛选项
    titleOptions: ["正高级", "副高级", "中级", "助理级", "员级", "其他"],
    selectedTitleIndex: -1,
    
    // 教室/课程筛选项
    campusOptions: ["仙溪校区", "江湾校区", "河滨校区"],
    selectedCampusIndex: -1,
    
    // 查询得到的结果列表
    classesResult: [],
    teachersResult: [],
    classroomsResult: [],
    coursesResult: [],
    
    loading: false,
    updatedAtText: "",
    dataSourceText: "教务数据",
    catalogEmpty: false,
    classEmptyTitle: "请选择上方筛选并查询",
    classEmptyDesc: "数据来自佛山大学教务系统，查询后将展示行政班级课表。",
  },

  onLoad() {
    this.fetchSchoolCatalog();
  },

  onShow() {
    // 每次显示页面时，重新触发过滤，确保设置页开关的修改能实时反映
    if (this.originalCatalogData) {
      this.applyCatalogFilter();
    }
  },

  applyCatalogFilter() {
    const data = this.originalCatalogData;
    if (!data) return;

    const { getSettings } = require("../../utils/storage");
    const settings = getSettings();
    const showHistorical = settings.showHistoricalGrades || false;

    let grades = data.grades || [];
    if (!showHistorical) {
      // 默认只显示最近 4 个有效本科年级
      const activeSemester = (data.semesters && data.semesters[0]?.value) || "2025-2026-2";
      const match = activeSemester.match(/^(\d{4})/);
      if (match) {
        const startYear = parseInt(match[1], 10);
        const activeGrades = [];
        for (let i = 3; i >= 0; i--) {
          activeGrades.push(String(startYear - i));
        }
        grades = grades.filter((g) => activeGrades.includes(g));
      } else {
        grades = grades.filter((g) => ["2022", "2023", "2024", "2025"].includes(g));
      }
    }

    // 严谨校验与更新选中的 index
    let newSelectedIndex = -1;
    if (this.data.selectedGradeIndex >= 0 && this.data.grades.length > 0) {
      const prevSelectedGrade = this.data.grades[this.data.selectedGradeIndex];
      newSelectedIndex = grades.indexOf(prevSelectedGrade);
    }

    this.setData({
      semesters: data.semesters || [],
      colleges: data.colleges || [],
      grades: grades,
      selectedGradeIndex: newSelectedIndex,
      // 如果年级索引越界重置为 -1，需连带清空之前联动的专业
      majors: newSelectedIndex < 0 ? [] : this.data.majors,
      selectedMajorIndex: newSelectedIndex < 0 ? -1 : this.data.selectedMajorIndex
    });
  },

  onTabChange(event) {
    const tabKey = event.currentTarget.dataset.key;
    this.setData({
      activeTab: tabKey,
      keyword: "",
      // 清空当前结果，避免误导
      classesResult: [],
      teachersResult: [],
      classroomsResult: [],
      coursesResult: [],
      updatedAtText: "",
      classEmptyTitle: "请选择上方筛选并查询",
      classEmptyDesc: "数据来自佛山大学教务系统，查询后将展示行政班级课表。",
    });
  },

  onKeywordInput(event) {
    this.setData({
      keyword: event.detail.value,
    });
  },

  // 1. 获取全校 Catalog 选项
  fetchSchoolCatalog() {
    this.setData({ loading: true, catalogEmpty: false });
    // NOTE: 优先请求 bootstrap 接口，以便统一载入并进行版本/数据状态控制
    request.get("/api/fosu/bootstrap", {
      semester: "2025-2026-2",
    }, { showLoading: false, silentError: true })
      .then((res) => {
        if (res && res.ready && res.catalog && Array.isArray(res.catalog.colleges) && res.catalog.colleges.length > 0) {
          const catalogData = {
            ...res.catalog,
            dataSource: res.dataSource || "cache",
            updatedAt: res.updatedAt || "",
            success: true
          };
          this.originalCatalogData = catalogData;
          this.applyCatalogFilter();
          this.setData({ loading: false, catalogEmpty: false });
        } else {
          console.warn("Bootstrap not ready or missing catalog, fallback to catalog");
          this.fallbackToCatalog();
        }
      })
      .catch((err) => {
        console.warn("Bootstrap request failed, fallback to catalog", err);
        this.fallbackToCatalog();
      });
  },

  // 降级使用旧的 catalog 接口，防止 bootstrap 异常导致完全白屏
  fallbackToCatalog() {
    request.get("/api/fosu/catalog", {
      semester: "2025-2026-2",
    }, { showLoading: false, silentError: true })
      .then((data) => {
        if (data && data.success && Array.isArray(data.colleges) && data.colleges.length > 0) {
          this.originalCatalogData = data;
          this.applyCatalogFilter();
          this.setData({ loading: false, catalogEmpty: false });
        } else {
          console.warn("Catalog data is empty");
          this.setData({ loading: false, catalogEmpty: true });
        }
      })
      .catch((err) => {
        this.setData({ loading: false, catalogEmpty: true });
        console.error("fetchSchoolCatalog (fallback) fail", err);
      });
  },


  // 2. 学期选择改变
  onSemesterChange(event) {
    this.setData({
      selectedSemesterIndex: Number(event.detail.value),
    });
  },

  // 3. 学院选择改变
  onCollegeChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      selectedCollegeIndex: index,
      selectedMajorIndex: -1,
      majors: [], // 重置专业
    }, () => {
      this.fetchMajors();
    });
  },

  // 4. 年级选择改变
  onGradeChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      selectedGradeIndex: index,
      selectedMajorIndex: -1,
      majors: [], // 重置专业
    }, () => {
      this.fetchMajors();
    });
  },

  // 5. 联动查询专业
  fetchMajors() {
    const { colleges, selectedCollegeIndex, grades, selectedGradeIndex } = this.data;
    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0) {
      return; // 必须同时选了学院和年级，强智系统才会联动返回专业
    }

    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];

    this.setData({ loading: true });
    request.get("/api/fosu/majors", { collegeCode, grade }, { showLoading: false })
      .then((data) => {
        this.setData({
          majors: data.majors || [],
          loading: false,
        });
      })
      .catch((err) => {
        this.setData({ loading: false });
        console.error("fetchMajors fail", err);
      });
  },

  // 6. 专业选择改变
  onMajorChange(event) {
    this.setData({
      selectedMajorIndex: Number(event.detail.value),
    });
  },

  // 7. 职称选择改变 (教师 Tab)
  onTitleChange(event) {
    this.setData({
      selectedTitleIndex: Number(event.detail.value),
    });
  },

  // 8. 校区选择改变 (教室 Tab)
  onCampusChange(event) {
    this.setData({
      selectedCampusIndex: Number(event.detail.value),
    });
  },

  // ================== 查询按钮动作 ==================

  searchClassSchedule() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex } = this.data;

    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0 || selectedMajorIndex < 0) {
      wx.showToast({
        title: "请选择完整筛选项",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex].value;
    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];
    const majorCode = majors[selectedMajorIndex].code;
    const majorName = majors[selectedMajorIndex].name;

    request.post("/api/fosu/class-schedule", {
      semester,
      collegeCode,
      grade,
      majorCode,
      majorName,
    }, { loadingTitle: "正在从教务系统获取数据...", silentError: true })
      .then((data) => {
        const formatTime = formatUpdateTime(data.updatedAt);
        const classes = (data.classes || []).map(formatClassResultItem);
        const emptyState = getClassEmptyState("");
        
        this.setData({
          classesResult: classes,
          updatedAtText: formatTime ? `教务数据 · 更新于 ${formatTime}` : "教务数据",
          classEmptyTitle: emptyState.title,
          classEmptyDesc: emptyState.desc,
        });

        if (!classes.length) {
          wx.showToast({
            title: "教务网无对应班级课表",
            icon: "none",
          });
        }
      })
      .catch((err) => {
        const payload = err && err.payload ? err.payload : {};
        const emptyState = getClassEmptyState(payload.reasonCode);
        this.setData({
          classesResult: [],
          updatedAtText: "",
          classEmptyTitle: emptyState.title,
          classEmptyDesc: emptyState.desc,
        });
        if (payload.reasonCode === "NO_SCHEDULE_SYNCED" || payload.reasonCode === "NO_SYNC_DATA") {
          wx.showToast({
            title: "暂未同步该专业课表",
            icon: "none",
          });
        }
        console.error("searchClassSchedule fail", err);
      });
  },

  searchTeacherSchedule() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, titleOptions, selectedTitleIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入教师姓名",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";
    const collegeCode = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].code : "";
    const collegeName = selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex].name : "";
    const titleCode = selectedTitleIndex >= 0 ? titleOptions[selectedTitleIndex] : "";

    request.post("/api/fosu/teacher-schedule", {
      semester,
      collegeCode,
      collegeName,
      titleCode,
      keyword: keyword.trim(),
    }, { loadingTitle: "正在从教务系统获取数据..." })
      .then((data) => {
        const formatTime = new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });

        this.setData({
          teachersResult: data.teachers || [],
          updatedAtText: `教务数据 · 更新于 ${formatTime}`,
        });
      })
      .catch((err) => {
        console.error("searchTeacherSchedule fail", err);
      });
  },

  searchClassroomSchedule() {
    const { semesters, selectedSemesterIndex, campusOptions, selectedCampusIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入教室名称 (如C7-503)",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";
    const campus = selectedCampusIndex >= 0 ? campusOptions[selectedCampusIndex] : "";

    request.post("/api/fosu/classroom-schedule", {
      semester,
      campusId: campus === "仙溪校区" ? "2" : campus === "江湾校区" ? "1" : "",
      classroomName: keyword.trim(),
    }, { loadingTitle: "正在从教务系统获取数据..." })
      .then((data) => {
        const formatTime = new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
        
        this.setData({
          classroomsResult: data.classrooms || [],
          updatedAtText: `教务数据 · 更新于 ${formatTime}`,
        });
      })
      .catch((err) => {
        console.error("searchClassroomSchedule fail", err);
      });
  },

  searchCourseSchedule() {
    const { semesters, selectedSemesterIndex, keyword } = this.data;

    if (!keyword.trim()) {
      wx.showToast({
        title: "请输入课程名 (如有机化学)",
        icon: "none",
      });
      return;
    }

    const semester = semesters[selectedSemesterIndex]?.value || "2025-2026-2";

    request.post("/api/fosu/course-schedule", {
      semester,
      courseName: keyword.trim(),
    }, { loadingTitle: "正在从教务系统获取数据..." })
      .then((data) => {
        const formatTime = new Date(data.updatedAt).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });

        this.setData({
          coursesResult: data.coursesList || [],
          updatedAtText: `教务数据 · 更新于 ${formatTime}`,
        });
      })
      .catch((err) => {
        console.error("searchCourseSchedule fail", err);
      });
  },

  // ================== 卡片点击进入课表详情 ==================

  viewClassSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.classesResult[index];
    if (!item) return;

    this.navigateToScheduleView("class", item.className, item.courses);
  },

  viewTeacherSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.teachersResult[index];
    if (!item) return;

    this.navigateToScheduleView("teacher", item.teacherName, item.courses);
  },

  viewClassroomSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.classroomsResult[index];
    if (!item) return;

    this.navigateToScheduleView("classroom", item.roomName, item.courses);
  },

  viewCourseSchedule(event) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.coursesResult[index];
    if (!item) return;

    this.navigateToScheduleView("course", item.courseName, item.courses);
  },

  navigateToScheduleView(type, name, courses) {
    const semester = this.data.semesters[this.data.selectedSemesterIndex]?.value || "2025-2026-2";
    
    wx.navigateTo({
      url: `/pages/schedule-view/schedule-view?type=${type}&name=${encodeURIComponent(name)}&semester=${semester}`,
      success: (res) => {
        // 利用 EventChannel 传递大体积课程数据
        res.eventChannel.emit("acceptDataFromOpenerPage", {
          courses: courses || [],
        });
      },
    });
  },
});
