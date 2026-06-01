/**
 * 个人课表同步页面 JS
 * NOTE: 支持教务网账号在线同步与 XLS 本地文件聊天记录上传解析两大导入途径，包含导入预览和实时课程搜索。
 */

const request = require("../../utils/request");
const { getSettings, setCurrentScheduleTarget } = require("../../utils/storage");

const MAX_SLIDE_RANGE = 247; // 340px (背景) - 93px (滑块) = 247px 有效拖拽区间

Page({
  data: {
    // 双通道模式控制
    currentTab: "xls", // "xls" | "account"
    importMode: "xls",  // "xls" | "account"
    
    // 账号同步字段
    studentId: "",
    password: "",
    studentIdMasked: "",
    startingSession: false,
    showCaptchaModal: false,
    sessionId: "",
    captchaData: null,
    envChecked: false,
    envAvailable: false,
    checkingEnv: false,
    diagnoseMsg: "",
    mainBtnText: "检测同步环境",

    // XLS 导入字段
    selectedFile: null,  // { name, path, size, sizeStr }
    loadingXls: false,
    previewSearchKey: "",
    previewDayFilter: "all", // "all" | 1-7
    filteredCourses: [],

    // 公用字段
    semesterOptions: ["2025-2026-2", "2025-2026-1", "2024-2025-2", "2024-2025-1"],
    semesterIndex: 0,
    
    // 滑块验证字段
    sliderX: 0,
    isDragging: false,
    startX: 0,
    startSliderX: 0,
    verifyStatus: "", // 'verifying' | 'success' | 'fail' | ''
    
    // 同步成功返回
    syncSuccess: false,
    syncResult: null, // XLS 模式下含 filename, term, courses; 账号模式下含 student, schedule
  },

  onLoad(options) {
    // 默认使用当前全局设置的学期
    const settings = getSettings();
    const currentSemesterId = settings.semesterId || settings.semester || "2025-2026-2";
    
    // 匹配下拉框索引
    const index = this.data.semesterOptions.indexOf(currentSemesterId);
    this.setData({
      semesterIndex: index >= 0 ? index : 0,
    });

    // 支持从外部传参直接定位 Tab
    if (options && options.tab) {
      this.setData({
        currentTab: options.tab
      });
    }
  },

  /**
   * 切换同步导航 Tab
   */
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      currentTab: tab,
      selectedFile: null,
      loadingXls: false,
      syncSuccess: false,
      syncResult: null
    });
  },

  /* ========================================================
   * 100 网手动作业：XLS 文件导入解析逻辑
   * ======================================================== */

  /**
   * XLS 按钮触发入口：分流选择文件与上传解析
   */
  onXlsBtnTap() {
    if (!this.data.selectedFile) {
      this.chooseAndImportXls();
    } else {
      this.parseUploadedXls();
    }
  },

  /**
   * 调用微信 API 在聊天记录里选择课表 xls 文件
   */
  chooseAndImportXls() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xls", "xlsx"],
      success: (res) => {
        const file = res.tempFiles[0];
        if (!file) return;

        // 限制文件大小不能超过 5MB
        if (file.size > 5 * 1024 * 1024) {
          wx.showModal({
            title: "文件过大",
            content: "上传的课表表格文件大小不能超过 5MB，请重新选择。",
            showCancel: false
          });
          return;
        }

        const sizeStr = file.size > 1024 * 1024 
          ? (file.size / (1024 * 1024)).toFixed(1) + " MB" 
          : (file.size / 1024).toFixed(1) + " KB";

        this.setData({
          selectedFile: {
            name: file.name,
            path: file.path,
            size: file.size,
            sizeStr: sizeStr
          }
        });
      },
      fail: (err) => {
        if (err.errMsg.indexOf("cancel") === -1) {
          wx.showToast({
            title: "文件选择失败",
            icon: "none"
          });
        }
      }
    });
  },

  /**
   * 清除当前已经选择的文件
   */
  clearSelectedFile() {
    this.setData({
      selectedFile: null,
      loadingXls: false
    });
  },

  /**
   * 将选定的 xls 读取为 base64，并调用后端解析 API 接口
   */
  parseUploadedXls() {
    const file = this.data.selectedFile;
    if (!file || this.data.loadingXls) return;

    this.setData({
      loadingXls: true
    });

    wx.showLoading({
      title: "读取并上传中..."
    });

    const fsManager = wx.getFileSystemManager();
    fsManager.readFile({
      filePath: file.path,
      encoding: "base64",
      success: (readRes) => {
        const base64Str = readRes.data;
        const targetTerm = this.data.semesterOptions[this.data.semesterIndex];

        request.post(
          "/api/fosu/personal/import-xls",
          {
            filename: file.name,
            fileBase64: base64Str,
            source: "fosu-100-print-xls",
            targetTerm: targetTerm
          },
          { silentError: true }
        )
          .then((res) => {
            wx.hideLoading();
            if (res.success) {
              wx.showToast({
                title: "解析成功",
                icon: "success"
              });

              this.setData({
                syncSuccess: true,
                importMode: "xls",
                loadingXls: false,
                syncResult: res,
                previewSearchKey: "",
                previewDayFilter: "all",
                filteredCourses: res.courses || []
              });
            } else {
              this.setData({ loadingXls: false });
              this.showFriendlyError(res.code, res.message || "课表解析失败");
            }
          })
          .catch((err) => {
            wx.hideLoading();
            this.setData({ loadingXls: false });
            const payload = err.payload || {};
            this.showFriendlyError(payload.code, payload.message || err.message || "网络请求失败");
          });
      },
      fail: (readErr) => {
        wx.hideLoading();
        this.setData({ loadingXls: false });
        wx.showModal({
          title: "文件读取失败",
          content: "无法读取微信文件，可能该文件已被系统微信缓存清理，请重新在微信聊天框接收后重试。",
          showCancel: false
        });
      }
    });
  },

  /**
   * 预览页：输入框进行搜索过滤
   */
  onPreviewSearch(e) {
    const key = e.detail.value.trim().toLowerCase();
    this.setData({
      previewSearchKey: key
    });
    this.applyPreviewFilters();
  },

  /**
   * 预览页：星期 Tab 点击切换
   */
  onPreviewDayFilterTap(e) {
    const day = e.currentTarget.dataset.day;
    this.setData({
      previewDayFilter: day
    });
    this.applyPreviewFilters();
  },

  /**
   * 预览页：根据过滤项重新计算展示的数据集
   */
  applyPreviewFilters() {
    const courses = (this.data.syncResult && this.data.syncResult.courses) || [];
    const searchKey = this.data.previewSearchKey;
    const dayFilter = this.data.previewDayFilter;

    let filtered = courses;

    // 1. 过滤星期
    if (dayFilter !== "all") {
      const targetDay = Number(dayFilter);
      filtered = filtered.filter(c => c.weekDay === targetDay);
    }

    // 2. 搜索课程名
    if (searchKey) {
      filtered = filtered.filter(c => 
        String(c.courseName).toLowerCase().includes(searchKey) ||
        String(c.teacherName).toLowerCase().includes(searchKey) ||
        String(c.classroom).toLowerCase().includes(searchKey)
      );
    }

    this.setData({
      filteredCourses: filtered
    });
  },

  /**
   * 放弃当前导入的课表预览，回到文件选择状态
   */
  cancelImport() {
    this.setData({
      syncSuccess: false,
      syncResult: null,
      selectedFile: null,
      loadingXls: false
    });
  },

  /* ========================================================
   * 原有教务账号统一同步逻辑
   * ======================================================== */

  /**
   * 账号同步的主按钮点击
   */
  onMainBtnTap() {
    if (this.data.envChecked && !this.data.envAvailable) {
      this.goToSchoolPage();
    } else {
      this.diagnoseEnvironment();
    }
  },

  /**
   * 同步环境诊断
   */
  diagnoseEnvironment() {
    if (this.data.checkingEnv) return;

    this.setData({
      checkingEnv: true,
      diagnoseMsg: ""
    });

    request.get(
      "/api/fosu/personal/diagnose",
      {},
      { silentError: true, showLoading: true, loadingTitle: "正在检测网络..." }
    )
      .then((res) => {
        let available = false;
        let msg = "";

        if (res.agentMode) {
          available = res.agent && res.agent.reachable;
          msg = res.recommendation || (available ? "已成功连接到校园代理网关。" : "校园代理网关连通异常。");
        } else {
          const authOk = res.authserver && res.authserver.reachable;
          const eduOk = res.edu100 && res.edu100.reachable;
          available = authOk && eduOk;
          msg = res.recommendation || (available ? "教务网及认证系统直连通畅。" : "教务系统目前直连受限。");
        }

        this.setData({
          checkingEnv: false,
          envChecked: true,
          envAvailable: available,
          diagnoseMsg: msg,
          mainBtnText: available ? "开始登录校验" : "暂不可用，使用全校课表"
        });

        if (!available) {
          this.showFriendlyError("CAMPUS_NETWORK_REQUIRED", "当前服务器网络受限，无法直接访问学校教务网，请暂时使用全校课表。");
        }
      })
      .catch((err) => {
        const payload = err.payload || {};
        let errMsg = payload.message || err.message || "请求诊断接口失败";
        this.setData({
          checkingEnv: false,
          envChecked: true,
          envAvailable: false,
          diagnoseMsg: "服务器连接失败: " + errMsg,
          mainBtnText: "暂不可用，使用全校课表"
        });
        this.showFriendlyError(payload.code, errMsg);
      });
  },

  goToSchoolPage() {
    wx.setStorageSync("initSelectMode", true);
    wx.switchTab({
      url: "/pages/school/school",
      success: () => {
        this.resetEnvCheck();
      }
    });
  },

  resetEnvCheck() {
    this.setData({
      envChecked: false,
      envAvailable: false,
      diagnoseMsg: "",
      mainBtnText: "检测同步环境"
    });
  },

  onStudentIdInput(e) {
    this.setData({
      studentId: e.detail.value.trim(),
    });
  },

  onPasswordInput(e) {
    this.setData({
      password: e.detail.value,
    });
  },

  onSemesterChange(e) {
    this.setData({
      semesterIndex: Number(e.detail.value),
    });
  },

  startLoginFlow() {
    if (this.data.startingSession) return;
    this.setData({ startingSession: true });

    request.post(
      "/api/fosu/personal/session/start",
      { studentId: this.data.studentId },
      { silentError: true, loadingTitle: "正在初始化同步..." }
    )
      .then((res) => {
        this.setData({
          startingSession: false,
          sessionId: res.sessionId,
        });

        if (res.useAgent) {
          this.loginAndSyncSchedule();
        } else {
          this.setData({
            showCaptchaModal: true,
            captchaData: res.captcha,
            sliderX: 0,
            verifyStatus: "",
          });
        }
      })
      .catch((err) => {
        this.setData({ startingSession: false });
        const payload = err.payload || {};
        this.showFriendlyError(payload.code, payload.message || err.message);
      });
  },

  onTouchStart(e) {
    if (this.data.verifyStatus === "verifying" || this.data.verifyStatus === "success") {
      return;
    }
    const touch = e.touches[0];
    this.setData({
      isDragging: true,
      startX: touch.clientX,
      startSliderX: this.data.sliderX,
      verifyStatus: "",
    });
  },

  onTouchMove(e) {
    if (!this.data.isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - this.data.startX;
    let newSliderX = this.data.startSliderX + deltaX;
    newSliderX = Math.max(0, Math.min(newSliderX, MAX_SLIDE_RANGE));
    this.setData({
      sliderX: newSliderX,
    });
  },

  onTouchEnd() {
    if (!this.data.isDragging) return;
    this.setData({ isDragging: false });
    this.verifySliderCaptcha();
  },

  verifySliderCaptcha() {
    this.setData({ verifyStatus: "verifying" });

    request.post(
      "/api/fosu/personal/session/verify-slider",
      {
        sessionId: this.data.sessionId,
        canvasLength: 340,
        moveLength: parseFloat(this.data.sliderX.toFixed(1)),
      },
      { silentError: true, showLoading: false }
    )
      .then(() => {
        this.setData({ verifyStatus: "success" });
        setTimeout(() => {
          this.loginAndSyncSchedule();
        }, 400);
      })
      .catch((err) => {
        this.setData({
          verifyStatus: "fail",
          sliderX: 0,
        });
        const payload = err.payload || {};
        wx.showToast({
          title: payload.message || "拼图未对齐，请重试",
          icon: "none",
        });
      });
  },

  loginAndSyncSchedule() {
    this.setData({
      showCaptchaModal: false,
    });

    const targetSemester = this.data.semesterOptions[this.data.semesterIndex];

    request.post(
      "/api/fosu/personal/session/login-and-sync",
      {
        sessionId: this.data.sessionId,
        studentId: this.data.studentId,
        password: this.data.password,
        semester: targetSemester,
      },
      { silentError: true, loadingTitle: "正在同步个人课表..." }
    )
      .then((res) => {
        const id = this.data.studentId;
        const idMasked = id.length > 8 ? `${id.slice(0, 4)}****${id.slice(-4)}` : `${id.slice(0, 2)}****${id.slice(-2)}`;

        this.setData({
          syncSuccess: true,
          importMode: "account",
          syncResult: res,
          studentIdMasked: idMasked,
          password: "",
        });
      })
      .catch((err) => {
        this.setData({ password: "" });
        const payload = err.payload || {};
        this.showFriendlyError(payload.code, payload.message || err.message);
      });
  },

  /* ========================================================
   * 绑定课表及返回操作
   * ======================================================== */

  /**
   * 将同步或 XLS 导入的结果写入本地个人课表缓存中并设为首页课表
   */
  bindToLocal() {
    if (!this.data.syncResult) return;

    const result = this.data.syncResult;
    const mode = this.data.importMode;
    let target = null;

    if (mode === "xls") {
      // XLS 导入生成的本地绑定结构
      target = {
        type: "personal",
        name: "个人课表 (XLS导入)",
        classId: "personal-xskb-xls",
        semester: result.term,
        courses: result.courses,
        updateTime: new Date().toISOString().slice(0, 10),
        student: {
          studentName: "XLS导入课表",
          studentId: "100网理论课表"
        }
      };
    } else {
      // 账号同步的原绑定结构
      target = {
        type: "personal",
        name: "个人课表",
        classId: "personal-xskb",
        semester: result.semester,
        courses: result.schedule.courses,
        updateTime: result.updatedAt ? result.updatedAt.slice(0, 10) : "",
        student: result.student,
      };
    }

    const success = setCurrentScheduleTarget(target);
    if (success) {
      wx.showToast({
        title: "已设为当前课表",
        icon: "success",
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 1000);
    } else {
      wx.showModal({
        title: "设置失败",
        content: "无法保存个人课表，缓存可能已满，请清理后重试。",
        showCancel: false,
      });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  closeCaptchaModal() {
    this.setData({
      showCaptchaModal: false,
      sliderX: 0,
      verifyStatus: "",
    });
  },

  noop() {},

  /**
   * 针对不同业务错误码展示更友好直观的中文提示
   */
  showFriendlyError(code, defaultMsg) {
    let title = "提示";
    let content = defaultMsg || "系统网络繁忙，请稍后再试";

    if (code === "EDU100_DNS_FAILED" || code === "UPSTREAM_DNS_FAILED") {
      content = "当前同步节点无法解析教务网，请稍后再试。您也可以使用全校课表或 XLS 手动导入。";
    } else if (code === "EDU100_UNREACHABLE" || code === "CAMPUS_NETWORK_REQUIRED") {
      content = "同步服务器目前无法访问教务网，建议切换成左侧的 “XLS 手动导入” 方案，不受网络限制。";
    } else if (code === "AUTHSERVER_UNREACHABLE") {
      content = "暂时无法连接统一身份认证服务，请稍后再试。";
    } else if (code === "LOGIN_PAGE_CHANGED") {
      content = "统一身份认证页面结构可能已更新，在线同步暂时不可用。请使用 XLS 导入。";
    } else if (code === "SLIDER_ENDPOINT_FAILED" || code === "SLIDER_TOKEN_NOT_FOUND") {
      content = "滑块验证码资源加载失败，请重试或使用 XLS 导入。";
    } else if (code === "SLIDER_VERIFY_FAILED") {
      content = "滑块验证失败，请重新拖动验证。";
    } else if (code === "CAS_LOGIN_FAILED" || code === "INVALID_CREDENTIALS") {
      content = "登录失败，请核对学号与统一认证密码。";
    } else if (code === "SCHEDULE_PAGE_UNREACHABLE") {
      content = "教务认证成功，但拉取理论课表页面失败，请稍后重试。";
    } else if (code === "SCHEDULE_PARSE_FAILED" || code === "PERSONAL_SCHEDULE_PARSE_FAILED") {
      content = "打开课表成功，但解析课程数据失败。请联系客服或尝试 XLS 手动导入。";
    } else if (code === "PERSONAL_SCHEDULE_EMPTY") {
      content = "同步成功，但是在该学期中似乎没有您的排课记录。";
    } else if (code === "VPN_GATEWAY_UNAVAILABLE") {
      content = "校园代理网关连通受限，请尝试使用 XLS 手动导入。";
    } else if (code === "UPSTREAM_TIMEOUT") {
      content = "连接教务网超时，校园系统网络拥堵或受限，推荐使用 XLS 手动导入。";
    } else if (code === "UPSTREAM_404") {
      content = "教务接口未找到(404)，个人课表在线同步暂时受限。";
    }

    wx.showModal({
      title,
      content,
      showCancel: false,
      confirmText: "知道了",
    });
  },
});
