/**
 * 个人课表同步页面 JS
 * NOTE: 负责收集账号密码表单、实现前台触屏拖拽滑块的像素百分比计算，以及与后端三步同步协议进行交互和异常提示拦截。
 */

const request = require("../../utils/request");
const { getSettings, setCurrentScheduleTarget } = require("../../utils/storage");

const MAX_SLIDE_RANGE = 247; // 340px (背景) - 93px (滑块) = 247px 有效拖拽区间

Page({
  data: {
    studentId: "",
    password: "",
    studentIdMasked: "",

    semesterOptions: ["2025-2026-2", "2025-2026-1", "2024-2025-2", "2024-2025-1"],
    semesterIndex: 0,

    startingSession: false,
    showCaptchaModal: false,
    sessionId: "",
    captchaData: null,

    // 同步环境诊断状态
    envChecked: false,
    envAvailable: false,
    checkingEnv: false,
    diagnoseMsg: "",
    mainBtnText: "检测同步环境",

    // 滑块交互状态
    sliderX: 0,
    isDragging: false,
    startX: 0,
    startSliderX: 0,

    verifyStatus: "", // 'verifying' | 'success' | 'fail' | ''
    syncSuccess: false,
    syncResult: null,
  },

  onLoad() {
    // 默认使用当前全局设置的学期
    const settings = getSettings();
    const currentSemesterId = settings.semesterId || settings.semester || "2025-2026-2";
    
    // 匹配下拉框索引
    const index = this.data.semesterOptions.indexOf(currentSemesterId);
    if (index >= 0) {
      this.setData({
        semesterIndex: index,
      });
    }
  },

  /**
   * 主按钮点击事件，分流检测逻辑与全校课表跳转
   */
  onMainBtnTap() {
    if (this.data.envChecked && !this.data.envAvailable) {
      // 若检测失败，文案为“暂不可用，使用全校课表”，点击后直接跳转全校课表
      this.goToSchoolPage();
    } else {
      // 否则进行环境检测
      this.diagnoseEnvironment();
    }
  },

  /**
   * 检测服务器的教务网连通环境
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
          // 校园代理模式
          available = res.agent && res.agent.reachable;
          msg = res.recommendation || (available ? "已成功连接到校园代理网关。" : "校园代理网关连通异常。");
        } else {
          // 直连教务网模式
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

  /**
   * 跳转到全校课表并开启班级引导模式
   */
  goToSchoolPage() {
    // 设置本地标记，开启强制引导
    wx.setStorageSync("initSelectMode", true);
    wx.switchTab({
      url: "/pages/school/school",
      success: () => {
        // 跳转成功后重置本页诊断状态，便于返回时重新检测
        this.resetEnvCheck();
      }
    });
  },

  /**
   * 重置环境检测状态
   */
  resetEnvCheck() {
    this.setData({
      envChecked: false,
      envAvailable: false,
      diagnoseMsg: "",
      mainBtnText: "检测同步环境"
    });
  },

  /**
   * 学号输入事件
   */
  onStudentIdInput(e) {
    this.setData({
      studentId: e.detail.value.trim(),
    });
  },

  /**
   * 密码输入事件
   */
  onPasswordInput(e) {
    this.setData({
      password: e.detail.value,
    });
  },

  /**
   * 学期变更事件
   */
  onSemesterChange(e) {
    this.setData({
      semesterIndex: Number(e.detail.value),
    });
  },

  /**
   * 步骤 1：开始登录流程，呼起会话获取验证码
   */
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
          // 校园代理模式：直接执行登录并抓取同步，不呼起滑块校验
          this.loginAndSyncSchedule();
        } else {
          // 直连模式：呼起滑块验证
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

  /**
   * 触摸开始：初始化滑块物理拖拽起点
   */
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

  /**
   * 触摸移动：更新滑块偏移并保持在安全有效宽度 [0, 247] px 内
   */
  onTouchMove(e) {
    if (!this.data.isDragging) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - this.data.startX;
    let newSliderX = this.data.startSliderX + deltaX;

    // 限幅控制
    newSliderX = Math.max(0, Math.min(newSliderX, MAX_SLIDE_RANGE));

    this.setData({
      sliderX: newSliderX,
    });
  },

  /**
   * 触摸结束：松手，立即将偏移量作为 moveLength 发起验证请求
   */
  onTouchEnd() {
    if (!this.data.isDragging) return;
    this.setData({ isDragging: false });

    this.verifySliderCaptcha();
  },

  /**
   * 步骤 2：提交滑块偏移量进行验证
   */
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
        // 延迟 400ms 让用户看到绿色勾选动画，再触发登录抓取
        setTimeout(() => {
          this.loginAndSyncSchedule();
        }, 400);
      })
      .catch((err) => {
        this.setData({
          verifyStatus: "fail",
          sliderX: 0, // 失败归零重来
        });
        const payload = err.payload || {};
        wx.showToast({
          title: payload.message || "拼图未对齐，请重试",
          icon: "none",
        });
      });
  },

  /**
   * 步骤 3：正式登录并同步课表
   */
  loginAndSyncSchedule() {
    this.setData({
      showCaptchaModal: false, // 关掉滑块框
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
        // 脱敏学号用于展示
        const id = this.data.studentId;
        const idMasked = id.length > 8 ? `${id.slice(0, 4)}****${id.slice(-4)}` : `${id.slice(0, 2)}****${id.slice(-2)}`;

        this.setData({
          syncSuccess: true,
          syncResult: res,
          studentIdMasked: idMasked,
          // 成功后清空明文密码变量
          password: "",
        });
      })
      .catch((err) => {
        // 失败也清空明文密码以保证隐私安全
        this.setData({ password: "" });
        const payload = err.payload || {};
        this.showFriendlyError(payload.code, payload.message || err.message);
      });
  },

  /**
   * 将同步拉取的课表设为当前课表
   */
  bindToLocal() {
    if (!this.data.syncResult) return;

    const result = this.data.syncResult;
    const target = {
      type: "personal",
      name: "个人课表",
      classId: "personal-xskb",
      semester: result.semester,
      courses: result.schedule.courses,
      updateTime: result.updatedAt ? result.updatedAt.slice(0, 10) : "",
      student: result.student,
    };

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

  /**
   * 返回上一页
   */
  goBack() {
    wx.navigateBack();
  },

  /**
   * 关闭滑块弹窗
   */
  closeCaptchaModal() {
    this.setData({
      showCaptchaModal: false,
      sliderX: 0,
      verifyStatus: "",
    });
  },

  /**
   * 针对不同业务错误码展示更友好直观的中文提示
   */
  showFriendlyError(code, defaultMsg) {
    let title = "提示";
    let content = defaultMsg || "系统繁忙，请稍后再试";

    if (code === "EDU100_DNS_FAILED" || code === "UPSTREAM_DNS_FAILED") {
      content = "当前同步节点无法解析教务网，请稍后再试。你仍可使用全校课表。";
    } else if (code === "EDU100_UNREACHABLE" || code === "CAMPUS_NETWORK_REQUIRED") {
      content = "当前同步服务器无法直接访问学校教务网，请先使用全校课表选择班级课表。";
    } else if (code === "AUTHSERVER_UNREACHABLE") {
      content = "暂时无法连接统一身份认证服务，请稍后再试。";
    } else if (code === "LOGIN_PAGE_CHANGED") {
      content = "学校登录页面结构可能已更新，个人同步暂时不可用。";
    } else if (code === "SLIDER_ENDPOINT_FAILED" || code === "SLIDER_TOKEN_NOT_FOUND") {
      content = "滑块验证资源加载失败或令牌解析失败，请稍后再试。";
    } else if (code === "SLIDER_VERIFY_FAILED") {
      content = "滑块验证失败，请重新拖动验证。";
    } else if (code === "CAS_LOGIN_FAILED" || code === "INVALID_CREDENTIALS") {
      content = "登录失败，请检查学号、密码或验证码。";
    } else if (code === "SCHEDULE_PAGE_UNREACHABLE") {
      content = "已登录，但暂时无法打开个人课表页面。";
    } else if (code === "SCHEDULE_PARSE_FAILED" || code === "PERSONAL_SCHEDULE_PARSE_FAILED") {
      content = "已打开个人课表页面，但解析课程失败。";
    } else if (code === "PERSONAL_SCHEDULE_EMPTY") {
      content = "同步成功，但是您在该学期中似乎没有课程排课记录。";
    } else if (code === "VPN_GATEWAY_UNAVAILABLE") {
      content = "校园代理网关未配置或暂时不可用，请联系管理员或使用全校课表。";
    } else if (code === "UPSTREAM_TIMEOUT") {
      content = "连接教务系统超时，当前公网服务器暂不支持直接同步，请稍后再试。";
    } else if (code === "UPSTREAM_404") {
      content = "教务系统接口或页面不存在(404)，个人同步暂时不可用。";
    }

    wx.showModal({
      title,
      content,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  noop() {},
});
