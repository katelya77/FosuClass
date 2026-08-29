const reminderClient = require("../../../services/courseReminderClient");
const aiAssistantService = require("../../../services/aiAssistantService");

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

function formatPreview(plan) {
  const source = plan || {};
  const occurrence = source.nextOccurrence || {};
  if (source.scope === "room_change" || source.eventDriven) {
    return {
      title: "教室变化提醒",
      detail: "个人课表教室发生变化时触发应用内提醒",
      leadLabel: "按变化触发",
    };
  }
  if (!occurrence.date) {
    return {
      title: "上课提醒",
      detail: "确认后按课表自动匹配下一节课",
      leadLabel: `提前 ${Number(source.leadMinutes || 20)} 分钟`,
    };
  }
  return {
    title: safeText(occurrence.courseName || "下一节课", 40),
    detail: [occurrence.date, occurrence.startTime, occurrence.classroom].filter(Boolean).join(" · "),
    leadLabel: `提前 ${Number(source.leadMinutes || 20)} 分钟`,
  };
}

const LEAD_OPTIONS = [10, 15, 20, 30, 45, 60];
const SCOPE_OPTIONS = [
  { id: "all_courses", label: "每节课前提醒", desc: "按个人课表循环提醒" },
  { id: "room_change", label: "仅教室变化", desc: "换教室时通知" },
];

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value) this.refresh();
      },
    },
    openCreate: {
      type: Boolean,
      value: false,
      observer(value) {
        if (value && this.properties.visible) {
          this.setData({ mode: "create" });
        }
      },
    },
  },

  data: {
    loading: false,
    operatingId: "",
    grantingId: "",
    creating: false,
    items: [],
    errorText: "",
    capability: { configured: false, templateId: "" },
    disclosure: "微信服务通知使用一次性订阅：每次主动接受增加 1 次发送额度；额度不足时使用应用内提醒。",
    mode: "list",
    leadMinutes: 20,
    leadOptions: LEAD_OPTIONS,
    scope: "all_courses",
    scopeOptions: SCOPE_OPTIONS,
    preview: null,
    createError: "",
    scheduleReady: false,
  },

  methods: {
    stopPropagation() {},

    close() {
      this.setData({ mode: "list", createError: "", preview: null });
      this.triggerEvent("close");
    },

    openCreateMode() {
      const prefs = aiAssistantService.getUserPreferences ? aiAssistantService.getUserPreferences() : {};
      const lead = Number(prefs && prefs.defaultReminderLeadMinutes) || 20;
      this.setData({
        mode: "create",
        leadMinutes: LEAD_OPTIONS.indexOf(lead) >= 0 ? lead : 20,
        scope: "all_courses",
        createError: "",
        preview: null,
      });
      this.refreshScheduleReady();
    },

    backToList() {
      this.setData({ mode: "list", createError: "", preview: null });
    },

    create() {
      this.openCreateMode();
    },

    onSelectLead(event) {
      const lead = Number(event.currentTarget.dataset.lead || 20) || 20;
      this.setData({ leadMinutes: lead, preview: null, createError: "" });
    },

    onSelectScope(event) {
      const scope = safeText(event.currentTarget.dataset.scope, 32) || "all_courses";
      this.setData({ scope, preview: null, createError: "" });
    },

    refreshScheduleReady() {
      try {
        const context = aiAssistantService.buildClientContext({});
        const summary = context && context.currentScheduleSummary;
        const ready = Boolean(summary && summary.enabled && Array.isArray(summary.courses) && summary.courses.length);
        this.setData({ scheduleReady: ready });
        return { context, ready };
      } catch (error) {
        this.setData({ scheduleReady: false });
        return { context: null, ready: false };
      }
    },

    async refresh() {
      if (this.data.loading) return;
      this.setData({ loading: true, errorText: "" });
      if (this.properties.openCreate) {
        this.openCreateMode();
      }
      this.refreshScheduleReady();
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

    async onPreviewPlan() {
      const { context, ready } = this.refreshScheduleReady();
      if (this.data.scope !== "room_change" && !ready) {
        this.setData({
          createError: "需要先导入个人课表，才能预览下一节课提醒。",
          preview: null,
        });
        return;
      }
      this.setData({ creating: true, createError: "" });
      const result = await reminderClient.planReminder({
        leadMinutes: this.data.leadMinutes,
        scope: this.data.scope,
        idempotencyKey: reminderClient.makeIdempotencyKey("preview", this.data.scope),
        currentScheduleSummary: context && context.currentScheduleSummary,
        todayDate: context && context.todayDate,
        todayWeekday: context && context.todayWeekday,
        currentTeachingWeek: context && context.currentTeachingWeek,
        termStartDate: context && context.termStartDate,
        totalWeeks: context && context.totalWeeks,
        weekStart: context && context.weekStart,
        termPhase: context && context.termPhase,
        isInTerm: context && context.isInTerm,
        clientTimestampMs: context && context.clientTimestampMs,
      });
      this.setData({ creating: false });
      if (!result.success) {
        this.setData({
          createError: result.error || "预览失败",
          preview: null,
        });
        if (result.code === "SCHEDULE_REQUIRED" || result.needContext) {
          wx.showModal({
            title: "需要个人课表",
            content: "导入个人课表后，才能按真实上课时间创建提醒。",
            confirmText: "去导入",
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: "/pages/personal-sync/personal-sync" });
              }
            },
          });
        }
        return;
      }
      this.setData({
        preview: formatPreview(result.plan),
        createError: "",
        _pendingPlan: result,
      });
    },

    async onConfirmCreate() {
      if (this.data.creating) return;
      const { context, ready } = this.refreshScheduleReady();
      if (this.data.scope !== "room_change" && !ready) {
        this.setData({ createError: "需要先导入个人课表，才能创建上课提醒。" });
        wx.showModal({
          title: "需要个人课表",
          content: "导入个人课表后，才能按真实上课时间创建提醒。",
          confirmText: "去导入",
          success: (res) => {
            if (res.confirm) wx.navigateTo({ url: "/pages/personal-sync/personal-sync" });
          },
        });
        return;
      }

      this.setData({ creating: true, createError: "" });
      try {
        const prefs = aiAssistantService.getUserPreferences ? aiAssistantService.getUserPreferences() : {};
        if (aiAssistantService.saveUserPreferences) {
          aiAssistantService.saveUserPreferences(Object.assign({}, prefs, {
            defaultReminderLeadMinutes: this.data.leadMinutes,
          }));
        }

        // gesture-safe: capability already loaded in refresh(); pass it explicitly so
        // createReminderFromConfig does not await another network hop before WeChat sheet.
        const idempotencyKey = reminderClient.makeIdempotencyKey("create", this.data.scope);
        const capability = this.data.capability && typeof this.data.capability === "object"
          ? this.data.capability
          : { configured: false, templateId: "" };
        const result = await reminderClient.createReminderFromConfig({
          leadMinutes: this.data.leadMinutes,
          scope: this.data.scope,
          idempotencyKey,
          capability,
          currentScheduleSummary: context && context.currentScheduleSummary,
          todayDate: context && context.todayDate,
          todayWeekday: context && context.todayWeekday,
          currentTeachingWeek: context && context.currentTeachingWeek,
          termStartDate: context && context.termStartDate,
          totalWeeks: context && context.totalWeeks,
          weekStart: context && context.weekStart,
          termPhase: context && context.termPhase,
          isInTerm: context && context.isInTerm,
          clientTimestampMs: context && context.clientTimestampMs,
        });
        this.setData({ creating: false });
        if (!result.success) {
          const err = result.error || "创建失败，请稍后重试";
          // Never strand the user on opaque confirmation codes after they already tapped.
          const friendly = /请先确认|确认已失效|确认/.test(err)
            ? "创建未完成，请再点一次「一键创建并授权微信通知」"
            : err;
          this.setData({ createError: friendly });
          wx.showToast({ title: friendly.slice(0, 24), icon: "none" });
          return;
        }
        const channelOk = result.reminder && result.reminder.channel === "wechat_subscription";
        wx.showToast({
          title: result.duplicate
            ? "提醒已存在"
            : (channelOk ? "已创建并获得微信授权" : "提醒已创建（应用内）"),
          icon: "success",
          duration: 2400,
        });
        this.setData({ mode: "list", preview: null, createError: "" });
        this.triggerEvent("change", { reminder: result.reminder || null });
        await this.refresh();
      } catch (error) {
        this.setData({ creating: false, createError: "创建失败，请再点一次重试" });
        wx.showToast({ title: "创建失败，请重试", icon: "none" });
      }
    },

    openPersonalSync() {
      wx.navigateTo({ url: "/pages/personal-sync/personal-sync" });
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
        wx.showToast({ title: result.error || "授权记录失败", icon: "none" });
        return;
      }
      wx.showToast({ title: "已补充授权", icon: "success" });
      this.triggerEvent("change", { reminder: result.reminder || null });
      await this.refresh();
    },

    async onToggle(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      const status = safeText(event.currentTarget.dataset.status, 16);
      if (!reminderId || this.data.operatingId) return;
      const nextStatus = status === "paused" ? "enabled" : "paused";
      this.setData({ operatingId: reminderId });
      const confirmation = await reminderClient.requestOperationConfirmation({
        reminderId,
        operation: "update",
        patch: { status: nextStatus },
        idempotencyKey: reminderClient.makeIdempotencyKey("toggle", reminderId),
      });
      if (!confirmation.success) {
        this.setData({ operatingId: "" });
        wx.showToast({ title: confirmation.error || "操作失败", icon: "none" });
        return;
      }
      const result = await reminderClient.updateReminder({
        reminderId,
        patch: { status: nextStatus },
        confirmationProof: confirmation.confirmationProof,
        idempotencyKey: reminderClient.makeIdempotencyKey("toggle-apply", reminderId),
      });
      this.setData({ operatingId: "" });
      if (!result.success) {
        wx.showToast({ title: result.error || "更新失败", icon: "none" });
        return;
      }
      this.triggerEvent("change", { reminder: result.reminder || null });
      await this.refresh();
    },

    onEditLead(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      if (!reminderId || this.data.operatingId) return;
      const that = this;
      wx.showActionSheet({
        itemList: LEAD_OPTIONS.map((item) => `提前 ${item} 分钟`),
        success: async (res) => {
          const leadMinutes = LEAD_OPTIONS[res.tapIndex];
          if (!leadMinutes) return;
          that.setData({ operatingId: reminderId });
          const confirmation = await reminderClient.requestOperationConfirmation({
            reminderId,
            operation: "update",
            patch: { leadMinutes },
            idempotencyKey: reminderClient.makeIdempotencyKey("lead", reminderId),
          });
          if (!confirmation.success) {
            that.setData({ operatingId: "" });
            wx.showToast({ title: confirmation.error || "操作失败", icon: "none" });
            return;
          }
          const result = await reminderClient.updateReminder({
            reminderId,
            patch: { leadMinutes },
            confirmationProof: confirmation.confirmationProof,
            idempotencyKey: reminderClient.makeIdempotencyKey("lead-apply", reminderId),
          });
          that.setData({ operatingId: "" });
          if (!result.success) {
            wx.showToast({ title: result.error || "更新失败", icon: "none" });
            return;
          }
          that.triggerEvent("change", { reminder: result.reminder || null });
          await that.refresh();
        },
      });
    },

    onDelete(event) {
      const reminderId = safeText(event.currentTarget.dataset.id, 80);
      const title = safeText(event.currentTarget.dataset.title, 40) || "该提醒";
      if (!reminderId || this.data.operatingId) return;
      const that = this;
      wx.showModal({
        title: "删除提醒",
        content: `确认删除「${title}」？删除后不可恢复。`,
        confirmText: "删除",
        confirmColor: "#c0392b",
        success: async (res) => {
          if (!res.confirm) return;
          that.setData({ operatingId: reminderId });
          const confirmation = await reminderClient.requestOperationConfirmation({
            reminderId,
            operation: "delete",
            patch: {},
            idempotencyKey: reminderClient.makeIdempotencyKey("delete", reminderId),
          });
          if (!confirmation.success) {
            that.setData({ operatingId: "" });
            wx.showToast({ title: confirmation.error || "操作失败", icon: "none" });
            return;
          }
          const result = await reminderClient.deleteReminder({
            reminderId,
            confirmationProof: confirmation.confirmationProof,
            idempotencyKey: reminderClient.makeIdempotencyKey("delete-apply", reminderId),
          });
          that.setData({ operatingId: "" });
          if (!result.success) {
            wx.showToast({ title: result.error || "删除失败", icon: "none" });
            return;
          }
          that.triggerEvent("change", { deleted: true, reminderId });
          await that.refresh();
        },
      });
    },
  },
});
