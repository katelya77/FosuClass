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
      { silentError: true, loadingTitle: "正在连接教务网..." }
    )
      .then((res) => {
        this.setData({
          startingSession: false,
          showCaptchaModal: true,
          sessionId: res.sessionId,
          captchaData: res.captcha,
          sliderX: 0,
          verifyStatus: "",
        });
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

    if (code === "CAMPUS_NETWORK_REQUIRED") {
      content = "当前服务器暂时无法访问学校教务网，请确认是否已连通校园网。您可先使用全校课表选择班级查阅。";
    } else if (code === "INVALID_CREDENTIALS") {
      content = "您的学号或密码可能不正确，请重新输入核对。";
    } else if (code === "SLIDER_VERIFY_FAILED") {
      content = "滑块安全验证已过期或校验失败，请重新点击登录验证。";
    } else if (code === "PERSONAL_SCHEDULE_EMPTY") {
      content = "同步成功，但是您在该学期中似乎没有课程排课记录。";
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
