function mockSyncSchedule(studentId, password) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!studentId || !password) {
        reject(new Error("请输入学号和教务网密码。"));
        return;
      }
      if (studentId.toLowerCase() === "fail") {
        reject(new Error("Mock 同步失败，请稍后再试。"));
        return;
      }
      resolve({
        success: true,
        updatedAt: Date.now(),
      });
    }, 650);
  });
}

Page({
  data: {
    syncing: false,
    message: "",
    error: "",
  },

  async handleSubmit(event) {
    if (this.data.syncing) {
      return;
    }
    const form = event.detail.value || {};
    const studentId = String(form.studentId || "").trim();
    const password = String(form.password || "");

    this.setData({
      syncing: true,
      message: "",
      error: "",
    });

    try {
      // TODO: 后续改为 wx.cloud.callFunction({ name: "syncSchedule", data: { studentId, password } })。
      // password 只在本次请求中临时使用，不写入 Storage、日志或云数据库。
      await mockSyncSchedule(studentId, password);
      this.setData({
        syncing: false,
        message: "同步成功，已更新个人课表",
        error: "",
      });
      wx.showToast({
        title: "同步成功",
        icon: "success",
      });
    } catch (error) {
      this.setData({
        syncing: false,
        message: "",
        error: error.message || "同步失败，请检查信息后再试。",
      });
    }
  },
});
