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

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function isValidClassName(name) {
  if (!name) return false;
  const excludeKeywords = ['体育', '化学', '解剖', '微积分', '物理', '英语', '毛泽东', '马克思', '形势与政策', '创业', '心理', '美育', '军事', '劳动', '思想道德', '大学', '程序设计', '基础', '俱乐部', '指导'];
  for (const kw of excludeKeywords) {
    if (name.includes(kw)) return false;
  }
  const reg = /\d/;
  if (!reg.test(name)) return false;
  return true;
}

function formatClassResultItem(item) {
  const source = item || {};
  const isAggregated = Boolean(source.isAggregated || source.displayType === "major-schedule" || source.displayType === "major-shared-schedule");
  const rawClassName = source.className || "";
  const className = safeDecodeURIComponent(rawClassName);
  const courseCount = Array.isArray(source.courses) ? source.courses.length : 0;
  return Object.assign({}, source, {
    scheduleKey: `${source.semester || ""}-${source.collegeCode || ""}-${source.grade || ""}-${source.majorCode || ""}-${className}`,
    displayTitle: className,
    displaySubtitle: `${source.majorName || "未知专业"} · ${source.grade || ""}级 · ${courseCount}门课`,
    statusText: isAggregated ? "专业聚合" : "行政班",
    isAggregated,
    courses: Array.isArray(source.courses) ? source.courses : [],
  });
}

function splitClassResultGroups(items) {
  const list = (items || [])
    .map(formatClassResultItem)
    .filter(item => item.isAggregated || isValidClassName(item.className));
  
  const admin = list.filter((item) => !item.isAggregated);
  
  const activeAdminMajorGrades = new Set(admin.map(item => `${item.majorCode}_${item.grade}`));
  const aggregate = list.filter((item) => item.isAggregated && !activeAdminMajorGrades.has(`${item.majorCode}_${item.grade}`));

  return {
    list,
    admin,
    aggregate,
    noticeText: !admin.length && aggregate.length
      ? "暂未拆出行政班，已展示该专业完整排课。"
      : "",
  };
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
    showAggregate: false,
    
    // 下拉选择选项
    semesters: [],
    colleges: [],
    grades: [],
    majors: [],
    
    selectedSemesterIndex: 0,
    selectedCollegeIndex: -1,
    selectedGradeIndex: -1,
    selectedMajorIndex: -1,
    
    // 班级筛选项
    classesOptions: [],
    selectedClassIndex: -1,
    
    // 教师筛选项
    titleOptions: ["正高级", "副高级", "中级", "助理级", "员级", "其他"],
    selectedTitleIndex: -1,
    
    // 教室/课程筛选项
    campusOptions: ["仙溪校区", "江湾校区", "河滨校区"],
    selectedCampusIndex: -1,
    
    // 查询得到的结果列表
    classesResult: [],
    classAdminResults: [],
    classAggregateResults: [],
    teachersResult: [],
    classroomsResult: [],
    coursesResult: [],
    
    loading: false,
    updatedAtText: "",
    dataSourceText: "教务数据",
    catalogEmpty: false,
    classEmptyTitle: "请选择上方筛选并查询",
    classEmptyDesc: "数据来自佛山大学教务系统，查询后将展示行政班级课表。",
    classNoticeText: "",
    restoreHint: "",
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
      classAdminResults: [],
      classAggregateResults: [],
      teachersResult: [],
      classroomsResult: [],
      coursesResult: [],
      updatedAtText: "",
      classEmptyTitle: "请选择上方筛选并查询",
      classEmptyDesc: "数据来自佛山大学教务系统，查询后将展示行政班级课表。",
      classNoticeText: "",
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
          this.restoreFilterCache();
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
          this.restoreFilterCache();
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


  // ================== 本地缓存状态存取与联动 ==================

  saveFilterCache() {
    const {
      semesters, selectedSemesterIndex,
      colleges, selectedCollegeIndex,
      grades, selectedGradeIndex,
      majors, selectedMajorIndex,
      classesOptions, selectedClassIndex
    } = this.data;

    const cache = {
      semesterValue: semesters[selectedSemesterIndex]?.value || "",
      semesterLabel: semesters[selectedSemesterIndex]?.label || "",
      collegeCode: selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex]?.code : "",
      collegeName: selectedCollegeIndex >= 0 ? colleges[selectedCollegeIndex]?.name : "",
      grade: selectedGradeIndex >= 0 ? grades[selectedGradeIndex] : "",
      majorCode: selectedMajorIndex >= 0 ? majors[selectedMajorIndex]?.code : "",
      majorName: selectedMajorIndex >= 0 ? majors[selectedMajorIndex]?.name : "",
      classId: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? classesOptions[selectedClassIndex].classId : "",
      className: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? classesOptions[selectedClassIndex].className : "",
      classType: (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) ? (classesOptions[selectedClassIndex].isAggregated ? "aggregate" : "admin") : "",
      lastUpdatedAt: Date.now()
    };

    wx.setStorageSync("FOSU_SCHOOL_FILTER_CACHE", cache);
  },

  restoreFilterCache() {
    const cache = wx.getStorageSync("FOSU_SCHOOL_FILTER_CACHE");
    if (!cache) {
      this.printSchoolDebugLog(false, "", "无缓存数据");
      return;
    }

    // 1. 恢复学期
    let selectedSemesterIndex = 0;
    if (cache.semesterValue) {
      const semIdx = this.data.semesters.findIndex(s => s.value === cache.semesterValue);
      if (semIdx >= 0) selectedSemesterIndex = semIdx;
    }

    // 2. 校验并恢复学院
    const collegeIdx = this.data.colleges.findIndex(c => c.code === cache.collegeCode);
    if (collegeIdx < 0) {
      this.setData({ selectedSemesterIndex });
      this.printSchoolDebugLog(true, "未恢复", `学院 ${cache.collegeName || cache.collegeCode} 在当前快照中已不存在`);
      return;
    }

    // 3. 校验并恢复年级
    const gradeIdx = this.data.grades.indexOf(cache.grade);
    if (gradeIdx < 0) {
      this.setData({
        selectedSemesterIndex,
        selectedCollegeIndex: collegeIdx
      });
      this.printSchoolDebugLog(true, "学院级", `年级 ${cache.grade} 在当前年级列表中已不存在`);
      this.showRestoreHint();
      return;
    }

    // 4. 设置学期、学院、年级索引并异步拉取专业进行恢复
    this.setData({
      selectedSemesterIndex,
      selectedCollegeIndex: collegeIdx,
      selectedGradeIndex: gradeIdx
    }, () => {
      this.fetchMajors().then((majors) => {
        // 校验并恢复专业
        const majorIdx = majors.findIndex(m => m.code === cache.majorCode);
        if (majorIdx < 0) {
          this.printSchoolDebugLog(true, "学院+年级级", `专业 ${cache.majorName || cache.majorCode} 不存在于该学院或年级下`);
          this.showRestoreHint();
          return;
        }

        this.setData({
          selectedMajorIndex: majorIdx
        }, () => {
          // 校验并恢复班级
          this.fetchClasses().then((classesOptions) => {
            let classIdx = -1;
            if (cache.classId) {
              classIdx = classesOptions.findIndex(c => c.classId === cache.classId);
            }
            if (classIdx < 0 && cache.className) {
              classIdx = classesOptions.findIndex(c => c.className === cache.className);
            }

            if (classIdx < 0) {
              this.printSchoolDebugLog(true, "专业级", `班级 ${cache.className || cache.classId} 在该专业下已不存在`);
              this.showRestoreHint();
              return;
            }

            this.setData({
              selectedClassIndex: classIdx
            });
            this.printSchoolDebugLog(true, "班级级 (完全恢复)", "已完全恢复上次筛选状态");
            this.showRestoreHint();
          }).catch(err => {
            this.printSchoolDebugLog(true, "专业级", "拉取班级列表失败: " + err.message);
            this.showRestoreHint();
          });
        });
      }).catch(err => {
        this.printSchoolDebugLog(true, "学院+年级级", "拉取专业列表失败: " + err.message);
        this.showRestoreHint();
      });
    });
  },

  showRestoreHint() {
    const { colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex, classesOptions, selectedClassIndex } = this.data;
    const parts = [];
    if (selectedCollegeIndex >= 0 && colleges[selectedCollegeIndex]) {
      parts.push(colleges[selectedCollegeIndex].name);
    }
    if (selectedGradeIndex >= 0 && grades[selectedGradeIndex]) {
      parts.push(grades[selectedGradeIndex]);
    }
    if (selectedMajorIndex >= 0 && majors[selectedMajorIndex]) {
      parts.push(majors[selectedMajorIndex].name);
    }
    if (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) {
      parts.push(classesOptions[selectedClassIndex].className);
    }
    
    if (parts.length > 0) {
      const hint = `已恢复上次选择：${parts.join(" / ")}`;
      this.setData({
        restoreHint: hint
      });
      if (this.restoreTimer) {
        clearTimeout(this.restoreTimer);
      }
      this.restoreTimer = setTimeout(() => {
        this.setData({
          restoreHint: ""
        });
      }, 2000);
    }
  },

  resetFilters() {
    wx.removeStorageSync("FOSU_SCHOOL_FILTER_CACHE");
    this.setData({
      selectedSemesterIndex: 0,
      selectedCollegeIndex: -1,
      selectedGradeIndex: -1,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [],
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
      restoreHint: ""
    });
    wx.showToast({
      title: "已清除筛选缓存",
      icon: "success",
      duration: 1000
    });
  },

  printSchoolDebugLog(hit, level, reason) {
    const envVersion = wx.getSystemInfoSync().platform === 'devtools' || (wx.getAccountInfoSync && wx.getAccountInfoSync().miniProgram.envVersion === 'develop');
    if (envVersion) {
      console.log("========== [开发环境全校页面调试日志] ==========");
      console.log("- 是否命中 FOSU_SCHOOL_FILTER_CACHE:", hit ? "是" : "否");
      if (hit) {
        console.log("- 恢复到了哪一级:", level);
        if (reason) {
          console.log("- 缓存失效原因 / 说明:", reason);
        }
      } else {
        console.log("- 未命中原因:", reason);
      }
      console.log("=================================================");
    }
  },

  // 2. 学期选择改变
  onSemesterChange(event) {
    this.setData({
      selectedSemesterIndex: Number(event.detail.value),
      selectedClassIndex: -1,
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      if (this.data.selectedCollegeIndex >= 0 && this.data.selectedGradeIndex >= 0 && this.data.selectedMajorIndex >= 0) {
        this.fetchClasses();
      }
      this.saveFilterCache();
    });
  },

  // 3. 学院选择改变
  onCollegeChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      selectedCollegeIndex: index,
      selectedGradeIndex: -1,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [], // 重置专业
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      this.saveFilterCache();
    });
  },

  // 4. 年级选择改变
  onGradeChange(event) {
    const index = Number(event.detail.value);
    this.setData({
      selectedGradeIndex: index,
      selectedMajorIndex: -1,
      selectedClassIndex: -1,
      majors: [], // 重置专业
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      this.fetchMajors();
      this.saveFilterCache();
    });
  },

  // 5. 联动查询专业
  fetchMajors() {
    const { colleges, selectedCollegeIndex, grades, selectedGradeIndex } = this.data;
    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0) {
      return Promise.resolve([]);
    }

    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];

    this.setData({ loading: true });
    return request.get("/api/fosu/majors", { collegeCode, grade }, { showLoading: false })
      .then((data) => {
        const majors = data.majors || [];
        this.setData({
          majors: majors,
          loading: false,
        });
        return majors;
      })
      .catch((err) => {
        this.setData({ loading: false });
        console.error("fetchMajors fail", err);
        throw err;
      });
  },

  // 6. 专业选择改变
  onMajorChange(event) {
    this.setData({
      selectedMajorIndex: Number(event.detail.value),
      selectedClassIndex: -1,
      classesOptions: [],
      classesResult: [],
      classAdminResults: [],
      classAggregateResults: [],
      classNoticeText: "",
    }, () => {
      this.fetchClasses();
      this.saveFilterCache();
    });
  },

  // 6.5. 异步获取班级列表
  fetchClasses() {
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex } = this.data;
    if (selectedCollegeIndex < 0 || selectedGradeIndex < 0 || selectedMajorIndex < 0) {
      return Promise.resolve([]);
    }

    const semester = semesters[selectedSemesterIndex].value;
    const collegeCode = colleges[selectedCollegeIndex].code;
    const grade = grades[selectedGradeIndex];
    const majorCode = majors[selectedMajorIndex].code;

    this.setData({ loading: true });
    return request.get("/api/fosu/classes", { semester, collegeCode, grade, majorCode }, { showLoading: false })
      .then((res) => {
        const classesOptions = [];
        if (res && res.success) {
          const adminClasses = res.adminClasses || [];
          const majorAggregates = res.majorAggregates || [];

          adminClasses.forEach(c => {
            classesOptions.push({
              classId: c.classId,
              className: c.className,
              label: c.className,
              isAggregated: false,
              group: "admin"
            });
          });

          majorAggregates.forEach(c => {
            classesOptions.push({
              classId: c.classId,
              className: c.className,
              label: c.className.includes("共享") ? c.className : `${c.className} (共享课表)`,
              isAggregated: true,
              group: "aggregate"
            });
          });
        }
        this.setData({
          classesOptions,
          loading: false
        });
        return classesOptions;
      })
      .catch((err) => {
        this.setData({ loading: false });
        console.error("fetchClasses fail", err);
        throw err;
      });
  },

  // 6.6. 班级选择改变
  onClassChange(event) {
    this.setData({
      selectedClassIndex: Number(event.detail.value)
    }, () => {
      this.saveFilterCache();
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
    const { semesters, selectedSemesterIndex, colleges, selectedCollegeIndex, grades, selectedGradeIndex, majors, selectedMajorIndex, classesOptions, selectedClassIndex } = this.data;

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

    // 如果选到了具体班级，直接精准查询并跳转
    if (selectedClassIndex >= 0 && classesOptions[selectedClassIndex]) {
      const selectedClass = classesOptions[selectedClassIndex];
      request.post("/api/fosu/class-schedule", {
        semester,
        collegeCode,
        grade,
        majorCode,
        majorName,
        className: selectedClass.className,
      }, { loadingTitle: "正在加载课表...", silentError: true })
        .then((data) => {
          if (data && data.success && data.classes && data.classes.length > 0) {
            const matchedClass = data.classes[0];
            const formatted = formatClassResultItem(matchedClass);
            this.navigateToScheduleView("class", formatted.className, formatted.courses, formatted);
          } else {
            wx.showToast({
              title: "未找到该班级课表数据",
              icon: "none",
            });
          }
        })
        .catch((err) => {
          wx.showToast({
            title: err.message || "课表数据查询失败",
            icon: "none",
          });
          console.error("fetch single class schedule fail", err);
        });
      return;
    }

    // 未选择具体班级，获取该专业下所有班级并显示在下方
    request.post("/api/fosu/class-schedule", {
      semester,
      collegeCode,
      grade,
      majorCode,
      majorName,
    }, { loadingTitle: "正在从教务系统获取数据...", silentError: true })
      .then((data) => {
        const formatTime = formatUpdateTime(data.updatedAt);
        const grouped = splitClassResultGroups(data.classes || []);
        const emptyState = getClassEmptyState("");
        
        this.setData({
          classesResult: grouped.list,
          classAdminResults: grouped.admin,
          classAggregateResults: grouped.aggregate,
          updatedAtText: formatTime ? `教务数据 · 更新于 ${formatTime}` : "教务数据",
          classEmptyTitle: emptyState.title,
          classEmptyDesc: emptyState.desc,
          classNoticeText: grouped.noticeText,
        });
      })
      .catch((err) => {
        const payload = err && err.payload ? err.payload : {};
        const emptyState = getClassEmptyState(payload.reasonCode);
        this.setData({
          classesResult: [],
          classAdminResults: [],
          classAggregateResults: [],
          updatedAtText: "",
          classEmptyTitle: emptyState.title,
          classEmptyDesc: emptyState.desc,
          classNoticeText: "",
        });
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
    const group = event.currentTarget.dataset.group;
    const source = group === "aggregate" ? this.data.classAggregateResults : this.data.classAdminResults;
    const item = source[index];
    if (!item) return;

    this.navigateToScheduleView("class", item.className, item.courses, item);
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

  navigateToScheduleView(type, name, courses, scheduleMeta) {
    const semester = this.data.semesters[this.data.selectedSemesterIndex]?.value || "2025-2026-2";
    const meta = scheduleMeta || {};
    const displayType = meta.displayType || "";
    const isAggregated = meta.isAggregated ? "1" : "0";
    
    wx.navigateTo({
      url: `/pages/schedule-view/schedule-view?type=${type}&name=${encodeURIComponent(name)}&semester=${semester}&displayType=${encodeURIComponent(displayType)}&isAggregated=${isAggregated}`,
      success: (res) => {
        // 利用 EventChannel 传递大体积课程数据
        res.eventChannel.emit("acceptDataFromOpenerPage", {
          courses: courses || [],
          schedule: meta,
        });
      },
    });
  },

  toggleAggregate() {
    this.setData({
      showAggregate: !this.data.showAggregate
    });
  }
});
