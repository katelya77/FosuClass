const reminderClient = require("../../../services/courseReminderClient");

function safeText(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max || 120);
}

function formatItem(item) {
  const source = item || {};
  const occurrence = source.nextOccurrence || {};
  const authorizationCredits = Math.max(0, Number(source.authorizationCredits || 0) || 0);
  const title = occurrence.courseName || (source.scope === "room_change" ? "教室变化提醒" : "课程提醒");
  const schedule = occurrence.date
    ? [occurrence.date, occurrence.startTime, occurrence.classroom].filter(Boolean).join(" · ")
    : "检测到课表变化时触发";
  return Object.assign({}, source, {
    title: safeText(title, 60),
    schedule: safeText(schedule, 100),
    statusLabel: source.status === "paused" ? "已暂停" : (source.status === "enabled" ? "已启用" : "已结束"),
    statusAction: source.status === "paused" ? "启用" : "暂停",
    active: source.status === "enabled",
    canEdit: source.status === "enabled" || source.status === "paused",
    authorizationCredits,
    channelLabel: authorizationCredits > 0
      ? `微信服务通知可发送 ${authorizationCredits} 次`
      : (source.channel === "wechat_subscription" ? "微信服务通知待补充授权" : "当前仅应用内提醒"),
    leadLabel: source.eventDriven ? "按变化触发" : `提前 ${Number(source.leadMinutes || 20)} 分钟`,
  });
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.refresh();
      },
    },
  },

  data: {
    loading: false,
    operatingId: "",
    grantingId: "",
    items: [],
    errorText: "",
    capability: { configured: false, templateId: "" },
    disclosure: "微信服务通知使用一次性订阅：每次主动接受增加 1 次发送额度；额度不足时使用应用内提醒。",
  },

  methods: {
    stopPropagation() {},

    close() {
      this.triggerEvent("close");
    },

    create() {
      this.triggerEvent("create");
    },

    async refresh() {
      if (this.data.loading) return;
      this.setData({ loading: true, errorText: "" });
      const [result, capabilityResult] = await Promise.all([
        reminderClient.listReminders(),
        reminderClient.getCapability(),
      ]);
      const capability = capabilityResult && capabilityResult.success
        ? capabilityResult
        : { configured: false, templateId: "" };
      if (!result.success) {
        this.setData({ loading: false, items: [], capability, errorText: result.error || "提醒列表暂不可用" });
        return;
      }
      this.setData({
        loading: false,
        items: result.items.map(formatItem),
        capability,
        disclosure: capability.configured
          ? "微信服务通知使用一次性订阅：每次主动接受增加 1 次发送额度；额度不足时自动保留应用内提醒。"
          : "微信服务通知模板尚未配置；提醒会保留在应用内，配置完成后可在这里补充授权。",
        errorText: "",
      });
    },

    async onGrantSubscription(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      if (!reminderId || this.data.grantingId || this.data.operatingId) return;
      const capability = this.data.capability || {};
      if (!capability.configured || !capability.templateId) {
        wx.showModal({
          title: "服务通知尚未配置",
          content: "管理员需要先在微信公众平台添加课程提醒订阅模板。当前提醒仍会使用应用内兜底。",
          showCancel: false,
          confirmText: "知道了",
        });
        return;
      }
      this.setData({ grantingId: reminderId });
      const subscription = await reminderClient.requestWechatSubscription(capability);
      if (subscription.status !== "accept") {
        this.setData({ grantingId: "" });
        wx.showToast({ title: subscription.status === "ban" ? "请在微信设置中开启订阅" : "未获得本次授权", icon: "none" });
        return;
      }
      const result = await reminderClient.grantSubscriptionAuthorization({
        reminderId,
        subscriptionStatus: subscription.status,
        idempotencyKey: reminderClient.makeIdempotencyKey("grant", reminderId),
      });
      this.setData({ grantingId: "" });
      if (!result.success) {
        wx.showToast({ title: result.error || "授权记录失败，请重试", icon: "none" });
        return;
      }
      wx.showToast({ title: "已增加 1 次服务通知", icon: "success" });
      this.refresh();
      this.triggerEvent("change", { operation: "subscription_grant", reminder: result.reminder });
    },

    onToggle(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      const currentStatus = safeText(event.currentTarget.dataset.status, 20);
      const nextStatus = currentStatus === "paused" ? "enabled" : "paused";
      wx.showModal({
        title: nextStatus === "enabled" ? "启用课程提醒" : "暂停课程提醒",
        content: nextStatus === "enabled" ? "启用后会按当前通知方式继续触发。" : "暂停后不会发送，随时可以重新启用。",
        confirmText: nextStatus === "enabled" ? "启用" : "暂停",
        success: (result) => {
          if (result.confirm) this.performUpdate(reminderId, { status: nextStatus });
        },
      });
    },

    onEditLead(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      wx.showActionSheet({
        itemList: ["提前 10 分钟", "提前 20 分钟", "提前 30 分钟", "提前 45 分钟"],
        success: (result) => {
          const values = [10, 20, 30, 45];
          const leadMinutes = values[Number(result.tapIndex)];
          if (!leadMinutes) return;
          wx.showModal({
            title: "修改提醒时间",
            content: `以后在课程开始前 ${leadMinutes} 分钟触发，确认修改吗？`,
            confirmText: "修改",
            success: (modalResult) => {
              if (modalResult.confirm) this.performUpdate(reminderId, { leadMinutes });
            },
          });
        },
      });
    },

    async performUpdate(reminderId, patch) {
      if (!reminderId || this.data.operatingId) return;
      const idempotencyKey = reminderClient.makeIdempotencyKey("update", reminderId);
      this.setData({ operatingId: reminderId });
      const confirmation = await reminderClient.requestOperationConfirmation({
        reminderId,
        operation: "update",
        patch,
        idempotencyKey,
      });
      if (!confirmation.success) {
        this.setData({ operatingId: "" });
        wx.showToast({ title: confirmation.error || "确认失败", icon: "none" });
        return;
      }
      const result = await reminderClient.updateReminder({
        reminderId,
        patch,
        confirmationProof: confirmation.confirmationProof,
        idempotencyKey,
      });
      this.setData({ operatingId: "" });
      if (!result.success) {
        wx.showToast({ title: result.error || "修改失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "提醒已更新", icon: "success" });
      this.refresh();
      this.triggerEvent("change", { operation: "update", reminder: result.reminder });
    },

    onDelete(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      const title = safeText(event.currentTarget.dataset.title, 40) || "这个提醒";
      wx.showModal({
        title: "删除课程提醒",
        content: `确认删除“${title}”吗？删除后无法恢复。`,
        confirmText: "删除",
        confirmColor: "#C62828",
        success: (result) => {
          if (result.confirm) this.performDelete(reminderId);
        },
      });
    },

    async performDelete(reminderId) {
      if (!reminderId || this.data.operatingId) return;
      const idempotencyKey = reminderClient.makeIdempotencyKey("delete", reminderId);
      this.setData({ operatingId: reminderId });
      const confirmation = await reminderClient.requestOperationConfirmation({
        reminderId,
        operation: "delete",
        patch: {},
        idempotencyKey,
      });
      if (!confirmation.success) {
        this.setData({ operatingId: "" });
        wx.showToast({ title: confirmation.error || "确认失败", icon: "none" });
        return;
      }
      const result = await reminderClient.deleteReminder({
        reminderId,
        confirmationProof: confirmation.confirmationProof,
        idempotencyKey,
      });
      this.setData({ operatingId: "" });
      if (!result.success) {
        wx.showToast({ title: result.error || "删除失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "提醒已删除", icon: "success" });
      this.refresh();
      this.triggerEvent("change", { operation: "delete", reminderId });
    },
  },
});
