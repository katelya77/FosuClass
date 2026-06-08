function makeAction(label, type, url, payload) {
  return {
    label,
    type,
    url: url || "",
    payload: payload || {},
  };
}

function makeCard(type, title, subtitle, options = {}) {
  return {
    type,
    title,
    subtitle: subtitle || "",
    badges: options.badges || [],
    items: options.items || [],
    actions: options.actions || [],
  };
}

function metaBadges(result = {}) {
  return [
    result.updatedAt ? `数据更新：${result.updatedAt}` : "",
    result.releaseVersion ? `Release ${result.releaseVersion}` : "",
    "仅供参考",
  ].filter(Boolean);
}

function itemName(item, type) {
  if (!item) return "";
  if (type === "teacher") return item.teacherName || item.name || "";
  if (type === "classroom") return item.roomName || item.classroomName || item.name || "";
  if (type === "course") return item.courseName || item.name || "";
  if (type === "class") return item.className || item.name || "";
  return item.name || item.title || "";
}

function buildEmptyRoom(result) {
  const rooms = Array.isArray(result.rooms) ? result.rooms : [];
  if (!result.success) {
    return {
      answer: "暂时没有读到空教室索引。我可以带你去数据诊断，确认 Release Pack 和空教室缓存是否正常。",
      cards: [makeCard("diagnosis", "空教室数据不可用", result.message || result.code || "索引缺失", {
        badges: ["工具结果", "仅供参考"],
        actions: [makeAction("查看数据诊断", "navigate", "/pages/school/school")],
      })],
      suggestions: ["为什么数据加载失败？", "怎么导入个人课表？"],
    };
  }
  return {
    answer: rooms.length
      ? `按当前条件找到 ${result.total || rooms.length} 间可用教室，建议先看前几间，再进入空教室页核对详情。`
      : "当前条件下没有匹配的空教室，可以放宽楼栋或节次再试。",
    cards: [makeCard("empty_room", "空教室推荐", result.summary || "基于 Release Pack 空教室索引", {
      badges: metaBadges(result),
      items: rooms.slice(0, 5).map((room) => ({
        title: room.roomName || "未知教室",
        subtitle: [room.buildingName || room.building, room.campus, room.capacityText].filter(Boolean).join(" · "),
        value: room.freeText || room.continuousText || "空闲",
      })),
      actions: [makeAction("可点击查看详情", "navigate", result.actionUrl || "/pages/empty-room/empty-room")],
    })],
    suggestions: ["找连续 2 节空教室", "C7 附近现在有空教室吗？"],
  };
}

function buildTodayCourses(result) {
  if (result.needContext) {
    return {
      answer: "我还没有拿到当前课表摘要。先绑定班级课表或导入 XLS 后，就能分析今天和明天的安排。",
      cards: [makeCard("guide", "需要当前课表", result.summary, {
        badges: ["最小必要信息", "不需要密码"],
        actions: [makeAction("导入 XLS 课表", "bind", result.actionUrl || "/pages/personal-sync/personal-sync?tab=xls")],
      })],
      suggestions: ["怎么导入个人课表？", "问 AI 分析今天安排"],
    };
  }
  const courses = Array.isArray(result.courses) ? result.courses : [];
  return {
    answer: courses.length
      ? `今天有 ${courses.length} 门课。${result.nextCourse ? `下一项是「${result.nextCourse.courseName}」，${result.nextCourse.sectionText}。` : ""}`
      : "今天没有匹配到课程安排，仍建议以教务系统和任课教师通知为准。",
    cards: [makeCard("schedule", "今日课程分析", result.reminder || "", {
      badges: ["课表摘要", "仅供参考"],
      items: courses.slice(0, 6).map((course) => ({
        title: course.courseName,
        subtitle: [course.teacherName, course.classroom].filter(Boolean).join(" · "),
        value: course.sectionText,
      })),
      actions: [makeAction("查看今日页", "navigate", result.actionUrl || "/pages/today/today")],
    })],
    suggestions: ["现在有空教室吗？", "帮我推荐自习时间"],
  };
}

function buildSchoolIndex(result) {
  const type = result.type || "teacher";
  const typeText = { teacher: "教师", classroom: "教室", course: "课程", class: "班级" }[type] || "课表";
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    answer: items.length
      ? `在全校索引里找到 ${result.total || items.length} 条${typeText}相关结果。事实来自 Release Pack 索引。`
      : `没有找到匹配的${typeText}结果，可以换一个更短的关键词再试。`,
    cards: [makeCard(type === "teacher" ? "teacher" : (type === "course" ? "course" : "generic"), `${typeText}查询结果`, result.q ? `关键词：${result.q}` : "可继续补充关键词", {
      badges: metaBadges(result),
      items: items.slice(0, 6).map((item) => ({
        title: itemName(item, type) || "未命名",
        subtitle: [item.college || item.collegeName, item.campus, item.majorName].filter(Boolean).join(" · "),
        value: item.courseCount || item.count ? `${item.courseCount || item.count} 条课程数据` : "课程数据",
      })),
      actions: [makeAction("打开全校查询", "navigate", result.actionUrl || "/pages/school/school")],
    })],
    suggestions: ["查老师课表", "查教室占用", "查课程安排"],
  };
}

function buildDiagnosis(result) {
  const counts = result.indexCounts || {};
  return {
    answer: result.activeReleaseVersion
      ? `当前 active release 是 ${result.activeReleaseVersion}。我会优先建议检查 Release Pack、索引和本地缓存是否一致。`
      : "当前没有检测到 active release，需要先在后台发布课表数据。",
    cards: [makeCard("diagnosis", "数据状态诊断", result.releasePackHealthy ? "Release Pack 快速健康检查通过" : "Release Pack 需要进一步检查", {
      badges: ["工具诊断", result.activeReleaseVersion ? `Release ${result.activeReleaseVersion}` : "未发布"],
      items: [
        { title: "班级索引", value: `${counts.class || 0}` },
        { title: "教师索引", value: `${counts.teacher || 0}` },
        { title: "教室索引", value: `${counts.classroom || 0}` },
        { title: "课程索引", value: `${counts.course || 0}` },
      ],
      actions: [makeAction("打开全校查询", "navigate", "/pages/school/school")],
    })],
    suggestions: ["为什么数据加载失败？", "现在有空教室吗？"],
  };
}

function buildGuide(result) {
  return {
    answer: "建议优先使用 XLS 导入个人课表。AI 不接收学号密码，只使用脱敏后的课程摘要来做提醒和建议。",
    cards: [makeCard("guide", result.title || "个人课表导入", "安全优先推荐 XLS 文件导入", {
      badges: ["不保存密码", "最小化字段", "本地优先"],
      items: (result.steps || []).map((step, index) => ({
        title: `步骤 ${index + 1}`,
        subtitle: step,
        value: "",
      })),
      actions: [makeAction("去 XLS 导入", "bind", result.actionUrl || "/pages/personal-sync/personal-sync?tab=xls")],
    })],
    suggestions: ["今天还有课吗？", "为什么数据加载失败？"],
  };
}

function buildMeeting(result) {
  if (result.needContext) {
    return buildGuide({
      title: "需要课表摘要",
      steps: ["请参与者主动导入或选择本地课表。", "系统只计算课程忙闲矩阵，不私自获取他人课表。", "算出候选时间后再联动空教室查询。"],
      actionUrl: result.actionUrl,
    });
  }
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  return {
    answer: candidates.length
      ? `找到 ${candidates.length} 个候选共同空闲时段，可继续点进空教室页核对教室。`
      : "没有找到满足条件的共同空闲时段，可以缩短时长或换一周再试。",
    cards: [makeCard("reminder", "组会/自习时间推荐", result.summary || "", {
      badges: ["忙闲矩阵", "仅供参考"],
      items: candidates.slice(0, 5).map((item) => ({
        title: `星期${item.weekday}`,
        subtitle: item.reason,
        value: `第${item.startSection}-${item.endSection}节`,
      })),
      actions: [makeAction("查看空教室", "navigate", result.emptyRoomActionUrl || "/pages/empty-room/empty-room")],
    })],
    suggestions: ["找连续 2 节空教室", "今天还有课吗？"],
  };
}

function buildGeneric() {
  return {
    answer: "你可以直接问我查课、找空教室、分析今日课程、导入个人课表或排查数据加载问题。我会先调用项目内工具，再把结果整理成卡片。",
    cards: [makeCard("generic", "AI 校园管家能做什么", "事实来自课表、空教室和 Release Pack 工具", {
      badges: ["工具优先", "不编造事实", "可降级演示"],
      items: [
        { title: "查课", subtitle: "教师、教室、课程、班级索引", value: "全校查询" },
        { title: "找空间", subtitle: "按日期、节次、楼栋找空教室", value: "空教室" },
        { title: "个人安排", subtitle: "基于本地课表摘要分析今日安排", value: "今日课程" },
      ],
      actions: [makeAction("打开全校查询", "navigate", "/pages/school/school")],
    })],
    suggestions: ["现在有空教室吗？", "今天还有课吗？", "怎么导入个人课表？"],
  };
}

function generate({ intent, toolResults }) {
  const first = toolResults && toolResults[0] && toolResults[0].result;
  const name = intent && intent.name;
  const payload = name === "search_empty_rooms" ? buildEmptyRoom(first || {}) :
    name === "get_today_courses" ? buildTodayCourses(first || {}) :
    name === "search_school_index" ? buildSchoolIndex(first || {}) :
    name === "diagnose_data_status" ? buildDiagnosis(first || {}) :
    name === "explain_personal_import" ? buildGuide(first || {}) :
    name === "recommend_meeting_time" ? buildMeeting(first || {}) :
    buildGeneric();
  return Object.assign({ provider: "mock" }, payload);
}

module.exports = {
  generate,
  name: "mock",
};
