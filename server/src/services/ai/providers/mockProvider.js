const projectKnowledgeService = require("../projectKnowledgeService");

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

function courseSectionText(course = {}) {
  if (course.sectionText) return course.sectionText;
  return course.startSection && course.endSection ? `第${course.startSection}-${course.endSection}节` : "";
}

function courseTimeValue(course = {}) {
  return course.timeText || course.timeRange || courseSectionText(course) || "时间待定";
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
      : "当前条件下没有匹配的空教室。建议换楼栋、换节次，或取消连续节数后再试。",
    cards: [makeCard("empty_room", "空教室推荐", result.summary || "基于 Release Pack 空教室索引", {
      badges: metaBadges(result),
      items: rooms.slice(0, 5).map((room) => ({
        title: room.roomName || "未知教室",
        subtitle: [room.buildingName || room.building, room.campus, room.capacityText].filter(Boolean).join(" · "),
        value: room.freeText || room.continuousText || "空闲",
      })),
      actions: [makeAction("查看空教室", "navigate", result.actionUrl || "/pages/empty-room/empty-room")],
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
        actions: [makeAction("去 XLS 导入", "bind", result.actionUrl || "/pages/personal-sync/personal-sync?tab=xls")],
      })],
      suggestions: ["怎么导入个人课表？", "问 AI 分析今天安排"],
    };
  }
  const courses = Array.isArray(result.courses) ? result.courses : [];
  const todayAnswer = courses.length
    ? (result.allFinished
      ? "今天课程已结束。"
      : `今天有 ${courses.length} 门课。${result.nextCourse ? `下一项是「${result.nextCourse.courseName}」，${courseTimeValue(result.nextCourse)}。` : ""}`)
    : "今天没有匹配到课程安排，仍建议以教务系统和任课教师通知为准。";
  return {
    answer: todayAnswer,
    cards: [Object.assign(makeCard("schedule", result.allFinished ? "今日课程已结束" : "今日课程分析", result.reminder || "", {
      badges: ["课表摘要", "仅供参考"],
      items: courses.slice(0, 6).map((course) => ({
        title: course.courseName,
        subtitle: [courseSectionText(course), course.teacherName, course.classroom].filter(Boolean).join(" · "),
        value: courseTimeValue(course),
      })),
      actions: [makeAction("查看今日安排", "navigate", result.actionUrl || "/pages/today/today")],
    }), { allFinished: result.allFinished === true })],
    suggestions: ["现在有空教室吗？", "帮我推荐自习时间"],
  };
}

function buildCourseItems(courses) {
  return (Array.isArray(courses) ? courses : []).slice(0, 6).map((course) => ({
    title: course.courseName || "\u672a\u547d\u540d\u8bfe\u7a0b",
    subtitle: [courseSectionText(course), course.teacherName, course.classroom].filter(Boolean).join(" \u00b7 "),
    value: courseTimeValue(course),
  }));
}

function buildTomorrowCourses(result) {
  if (result.needContext) return buildTodayCourses(result);
  const courses = Array.isArray(result.activeCourses) && result.activeCourses.length
    ? result.activeCourses
    : (Array.isArray(result.courses) ? result.courses : []);
  const answer = courses.length
    ? `\u660e\u5929\u6709 ${courses.length} \u95e8\u8bfe\u3002${result.nextCourse ? `\u6700\u65e9\u4e00\u95e8\u662f\u300c${result.nextCourse.courseName}\u300d\uff0c${courseTimeValue(result.nextCourse)}\u3002` : ""}`
    : "\u660e\u5929\u6682\u65f6\u6ca1\u6709\u5728\u672c\u5730\u8bfe\u8868\u6458\u8981\u91cc\u547d\u4e2d\u8bfe\u7a0b\u3002";
  return {
    answer,
    cards: [makeCard("schedule", "\u660e\u65e5\u8bfe\u7a0b", result.reminder || "", {
      badges: ["\u8bfe\u8868\u6458\u8981", "\u5df2\u6838\u9a8c"],
      items: buildCourseItems(courses),
      actions: [makeAction("\u67e5\u770b\u8bfe\u8868", "navigate", result.actionUrl || "/pages/today/today")],
    })],
    suggestions: ["\u4e0b\u4e00\u8282\u8bfe\u662f\u4ec0\u4e48\uff1f", "\u660e\u5929\u4e0b\u5348\u6709\u7a7a\u6559\u5ba4\u5417\uff1f"],
  };
}

function buildNextCourse(result) {
  if (result.needContext) return buildTodayCourses(result);
  const course = result.nextCourse || (Array.isArray(result.activeCourses) ? result.activeCourses[0] : null);
  const answer = course
    ? `\u4e0b\u4e00\u8282\u8bfe\u662f\u300c${course.courseName || "\u672a\u547d\u540d\u8bfe\u7a0b"}\u300d\uff0c${courseSectionText(course) || "\u8282\u6b21\u5f85\u5b9a"}\uff0c${courseTimeValue(course)}${course.classroom ? `\uff0c\u5730\u70b9 ${course.classroom}` : ""}\u3002`
    : "\u672c\u5730\u8bfe\u8868\u6458\u8981\u91cc\u6682\u65f6\u6ca1\u6709\u627e\u5230\u4e0b\u4e00\u8282\u8bfe\u3002";
  return {
    answer,
    cards: [makeCard("schedule", "\u4e0b\u4e00\u8282\u8bfe", result.summary || "", {
      badges: ["\u8bfe\u8868\u6458\u8981", "\u5df2\u6838\u9a8c"],
      items: course ? buildCourseItems([course]) : [],
      actions: [makeAction("\u67e5\u770b\u4eca\u65e5\u5b89\u6392", "navigate", result.actionUrl || "/pages/today/today")],
    })],
    suggestions: ["\u6559\u5ba4\u5728\u54ea\u91cc\uff1f", "\u4e0b\u4e00\u8282\u8bfe\u524d\u5929\u6c14\u600e\u4e48\u6837\uff1f"],
  };
}

function buildWeekSchedule(result) {
  if (result.needContext) return buildTodayCourses(result);
  const days = Array.isArray(result.days) ? result.days : [];
  const courses = [];
  days.forEach((day) => {
    (Array.isArray(day.courses) ? day.courses : []).forEach((course) => {
      courses.push(Object.assign({ weekday: day.weekday }, course));
    });
  });
  return {
    answer: result.summary || `\u672c\u5468\u5171\u6709 ${result.courseCount || courses.length} \u8282\u8bfe\u7a0b\u5b89\u6392\u3002`,
    cards: [makeCard("schedule", "\u672c\u5468\u8bfe\u8868", result.week ? `\u7b2c ${result.week} \u6559\u5b66\u5468` : "", {
      badges: ["\u8bfe\u8868\u6458\u8981", "\u5df2\u6838\u9a8c"],
      items: buildCourseItems(courses),
      actions: [makeAction("\u67e5\u770b\u8bfe\u8868", "navigate", result.actionUrl || "/pages/today/today")],
    })],
    suggestions: ["\u4eca\u5929\u8fd8\u6709\u8bfe\u5417\uff1f", "\u672c\u5468\u54ea\u5929\u6bd4\u8f83\u7a7a\uff1f"],
  };
}

function buildTeachingWeek(result) {
  const weekText = result.weekUncertain
    ? "\u5f53\u524d\u6559\u5b66\u5468\u6682\u65f6\u4e0d\u786e\u5b9a\u3002"
    : `\u73b0\u5728\u662f\u7b2c ${result.currentWeek || result.week || 0} \u6559\u5b66\u5468\u3002`;
  return {
    answer: result.summary || weekText,
    cards: [makeCard("generic", "\u6559\u5b66\u5468", result.term || "", {
      badges: ["\u6821\u5386\u89c4\u5219", "\u5df2\u6838\u9a8c"],
      items: [
        { title: "\u5f53\u524d\u5468", value: result.currentWeek || result.week || "\u4e0d\u786e\u5b9a" },
        { title: "\u5b66\u671f", value: result.term || "" },
        { title: "\u603b\u5468\u6570", value: result.totalWeeks || "" },
      ],
      actions: [],
    })],
    suggestions: ["\u67e5\u672c\u5468\u8bfe\u8868", "\u67e5\u5b66\u671f\u6821\u5386"],
  };
}

function buildTermCalendar(result) {
  return {
    answer: result.summary || `\u5df2\u8bfb\u53d6 ${result.term || "\u5f53\u524d\u5b66\u671f"} \u7684\u6559\u5b66\u65e5\u5386\u914d\u7f6e\u3002`,
    cards: [makeCard("guide", "\u5b66\u671f\u6821\u5386", result.term || "", {
      badges: ["\u6559\u5b66\u5468", "\u5df2\u6838\u9a8c"],
      items: [
        { title: "\u5f53\u524d\u5468", value: result.currentWeek || result.week || "\u4e0d\u786e\u5b9a" },
        { title: "\u5f00\u5b66\u65e5", value: result.termStartDate || "\u6682\u672a\u914d\u7f6e" },
        { title: "\u603b\u5468\u6570", value: result.totalWeeks || "" },
      ],
      actions: [],
    })],
    suggestions: ["\u73b0\u5728\u7b2c\u51e0\u6559\u5b66\u5468\uff1f", "\u660e\u5929\u8bfe\u7a0b"],
  };
}

function emptySchoolCopy(type, q) {
  if (!q && type === "teacher") return "你想查哪位老师？请输入老师姓名，例如：查张三老师课表。";
  if (type === "teacher") return "没有找到匹配的教师结果。建议换短关键词、检查姓名，或打开全校查询继续筛选。";
  if (type === "classroom") return "没有找到匹配的教室结果。建议输入 C7-203、C7、B8 等格式再试。";
  if (type === "course") return "没有找到匹配的课程结果。建议输入课程名中的 2-4 个关键字。";
  if (type === "class") return "没有找到匹配的班级结果。建议输入班级、年级或专业关键词。";
  return "没有找到匹配结果，可以换一个更短的关键词再试。";
}

function buildSchoolIndex(result, detailResult) {
  const type = result.type || "teacher";
  const typeText = { teacher: "教师", classroom: "教室", course: "课程", class: "班级" }[type] || "课表";
  const items = Array.isArray(result.items) ? result.items : [];
  const detailCourses = detailResult && Array.isArray(detailResult.courses) ? detailResult.courses : [];
  const primaryActionUrl = detailResult && detailResult.success && detailResult.actionUrl
    ? detailResult.actionUrl
    : (result.actionUrl || "/pages/school/school");
  return {
    answer: items.length
      ? (detailCourses.length
        ? `在全校索引里命中 1 条${typeText}结果，并读取到课表详情。事实来自 Release Pack 索引和详情缓存。`
        : `在全校索引里找到 ${result.total || items.length} 条${typeText}相关结果。事实来自 Release Pack 索引。`)
      : emptySchoolCopy(type, result.q),
    cards: [makeCard(type === "teacher" ? "teacher" : (type === "course" ? "course" : "generic"), `${typeText}查询结果`, result.q ? `关键词：${result.q}` : "可继续补充关键词", {
      badges: metaBadges(result),
      items: (detailCourses.length ? detailCourses.slice(0, 6).map((course) => ({
        title: course.courseName || "未命名课程",
        subtitle: [course.teacherName, course.classroom || course.roomName, course.weekday ? `星期${course.weekday}` : "", courseSectionText(course)].filter(Boolean).join(" · "),
        value: courseTimeValue(course),
      })) : items.slice(0, 6).map((item) => ({
        title: itemName(item, type) || "未命名",
        subtitle: [item.college || item.collegeName, item.campus, item.majorName].filter(Boolean).join(" · "),
        value: item.courseCount || item.count ? `${item.courseCount || item.count} 条课程数据` : "课程数据",
      }))),
      actions: [makeAction(detailCourses.length ? "查看课表详情" : "打开全校查询", "navigate", primaryActionUrl)],
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
    answer: "个人课表只推荐使用 XLS 导入。AI 不接收学号密码，只在你开启摘要后读取最小课程字段来做提醒和建议。",
    cards: [makeCard("guide", result.title || "个人课表 XLS 导入", "新学期重新导入即可刷新本机课表和 AI 摘要", {
      badges: ["无需密码", "最小化字段", "本地优先"],
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

function buildClarification(result = {}) {
  const slot = result.slot || {};
  const type = slot.type || "teacher";
  const copy = {
    teacher: "你想查哪位老师？请输入老师姓名，例如：查张三老师课表。",
    classroom: "你想查哪间教室？请输入教室名或楼栋，例如：查 C7-203 教室。",
    course: "你想查哪门课程？请输入课程关键词，例如：查高等数学课程。",
    class: "你想查哪个班级？请输入班级、年级或专业关键词。",
    schedule: "推荐组会或自习时间前，需要先开启课表摘要或导入 XLS 课表。",
  }[type] || "还需要一个关键词，请补充后我再查。";
  const actionUrl = type === "schedule" ? "/pages/personal-sync/personal-sync?tab=xls" : (result.actionUrl || "/pages/school/school");
  return {
    answer: copy,
    cards: [makeCard("guide", "还需要一个关键词", slot.prompt || "请补充必要信息后继续。", {
      badges: ["追问", "不编造事实"],
      actions: [makeAction(type === "schedule" ? "去 XLS 导入" : "打开全校查询", type === "schedule" ? "bind" : "navigate", actionUrl)],
    })],
    suggestions: [
      "查某某老师课表",
      "查 C7-203 教室",
      "查高等数学课程",
    ],
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
  const emptyRooms = result.emptyRoomResult && Array.isArray(result.emptyRoomResult.rooms)
    ? result.emptyRoomResult.rooms
    : [];
  return {
    answer: candidates.length
      ? `找到 ${candidates.length} 个候选共同空闲时段，可继续点进空教室页核对教室。`
      : "没有找到满足条件的共同空闲时段，可以缩短时长或换一周再试。",
    cards: [makeCard("reminder", "组会/自习时间推荐", result.summary || "", {
      badges: ["忙闲矩阵", "仅供参考"],
      items: candidates.slice(0, 5).map((item) => ({
        title: `星期${item.weekday}`,
        subtitle: [item.reason, item.timeText, emptyRooms[0] && emptyRooms[0].roomName ? `可优先看 ${emptyRooms[0].roomName}` : ""].filter(Boolean).join(" · "),
        value: item.timeText || `第${item.startSection}-${item.endSection}节`,
      })),
      actions: [makeAction("查看空教室", "navigate", result.emptyRoomActionUrl || "/pages/empty-room/empty-room")],
    })],
    suggestions: ["找连续 2 节空教室", "今天还有课吗？"],
  };
}

function buildClarificationV2(result = {}) {
  const slot = result.slot || {};
  const type = slot.type || "teacher";
  const answerMap = {
    teacher: "你想查哪位老师？直接输入姓名就可以。",
    classroom: "你想查哪间教室？直接输入教室号就可以。",
    course: "你想查哪门课程？直接输入课程名就可以。",
    class: "你想查哪个班级？直接输入班级或专业关键词就可以。",
    schedule: "需要先开启课表摘要或导入 XLS 个人课表，才能推荐自习时间。",
  };
  const suggestionsMap = {
    teacher: ["查张三老师课表", "查李老师课表"],
    classroom: ["查C7-203教室", "查B8教室"],
    course: ["查高等数学课程", "查大学英语课程"],
    class: ["查25动物科学3班", "查计算机专业课表"],
    schedule: ["去XLS导入", "今天还有课吗"],
  };
  return {
    answer: answerMap[type] || "还需要一个关键词，直接输入就可以。",
    cards: [],
    suggestions: suggestionsMap[type] || [],
  };
}

function buildMeetingV2(result) {
  if (result.needContext) {
    return {
      answer: result.summary || "需要先开启课表摘要或导入 XLS 个人课表，我才能推荐自习时间。",
      cards: [makeCard("guide", "需要课表摘要", "只会使用脱敏后的课程名、教师、教室、星期、节次和教学周。", {
        badges: ["XLS-only", "本地优先"],
        actions: [makeAction("前往设置", "bind", result.actionUrl || "/pages/personal-sync/personal-sync?tab=xls")],
      })],
      suggestions: ["怎么导入个人课表？", "今天还有课吗？"],
    };
  }
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const first = candidates[0] || null;
  const bestActionUrl = first && first.emptyRoomActionUrl || result.emptyRoomActionUrl || "/pages/empty-room/empty-room";
  return {
    answer: result.summary || (candidates.length
      ? "已根据当前课表和空教室索引整理出未来可用时段。"
      : "没有找到满足条件的未来自习时段，可以缩短连续节数或换一周再试。"),
    cards: candidates.length ? [makeCard("reminder", "连续自习时间推荐", result.scope === "next_week" ? "本周剩余时间无合适候选，已尝试下周。" : "从当前时刻开始，在本周剩余时间内推荐。", {
      badges: [
        `连续${result.durationSections || (first && first.durationSections) || 2}节`,
        first && first.teachingWeek ? `第${first.teachingWeek}教学周` : "",
        result.weekUncertain ? "教学周待确认" : "",
      ].filter(Boolean),
      items: candidates.slice(0, 3).map((item) => ({
        title: item.dateText || item.date || "日期待确认",
        subtitle: [
          `${item.sectionText || `第${item.startSection}-${item.endSection}节`} ${item.timeText || ""}`.trim(),
          item.emptyRoomVerified
            ? (item.roomCount > 0
              ? `已核验 ${item.roomCount} 间候选${item.recommendedRooms && item.recommendedRooms[0] && item.recommendedRooms[0].roomName ? `，优先 ${item.recommendedRooms[0].roomName}` : ""}`
              : "已核验，暂未找到匹配教室")
            : "尚未核验教室",
        ].filter(Boolean).join(" · "),
        value: item.weekUncertain ? "周次待确认" : `第${item.teachingWeek}周`,
      })),
      actions: [
        makeAction("查看最佳时段空教室", "navigate", bestActionUrl),
        makeAction("重新选择条件", "retry", "", { message: "帮我推荐连续 2 节自习时间" }),
      ],
    })] : [makeCard("reminder", "连续自习时间推荐", result.summary || "暂时没有合适候选。", {
      badges: ["未来时段", "课表核验"],
      actions: [makeAction("重新选择条件", "retry", "", { message: "帮我推荐连续 2 节自习时间" })],
    })],
    suggestions: ["推荐明天连续2节自习时间", "推荐晚上自习时间"],
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

function buildWeather(result = {}) {
  const ok = result.success !== false;
  return {
    answer: ok
      ? `${result.campus || "校区"}当前${result.weatherText || "天气待确认"}，约 ${result.temperatureC || 0}℃。${(result.alerts || [])[0] || "天气影响不大，按正常时间出发即可。"}`
      : (result.summary || "天气暂时不可用，课表和空教室查询不受影响。"),
    cards: [makeCard("generic", "校区天气", result.summary || "", {
      badges: [result.campus || "校区", result.cached ? "缓存" : "实时查询", ok ? "天气数据" : "降级"].filter(Boolean),
      items: ok ? [
        { title: "天气", value: result.weatherText || "" },
        { title: "温度", value: `${result.temperatureC || 0}℃` },
        { title: "降水", value: `${result.precipitationMm || 0}mm` },
      ] : [{ title: "状态", subtitle: result.code || "WEATHER_UNAVAILABLE", value: "不影响课表" }],
      actions: [],
    })],
    suggestions: ["明天下午空教室和天气", "下一节课前要带伞吗"],
  };
}

function buildCampusPlace(result = {}) {
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    answer: items.length
      ? `找到 ${items.length} 个校园地点候选。未维护精确坐标的楼栋不会生成路线。`
      : (result.summary || "没有找到已维护的校园地点。"),
    cards: [makeCard("generic", "校园地点", result.q || result.classroom || "", {
      badges: ["结构化地图", result.ambiguous ? "需要选择" : ""].filter(Boolean),
      items: items.slice(0, 6).map((item) => ({
        title: item.name,
        subtitle: [item.campus, item.type, item.verified ? "已核验" : "待维护坐标"].filter(Boolean).join(" · "),
        value: item.id,
      })),
      actions: [makeAction("打开全校查询", "navigate", "/pages/school/school")],
    })],
    suggestions: ["C7 在哪里", "仙溪校区路线"],
  };
}

function buildKnowledge(result = {}) {
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    answer: items.length
      ? `根据知识库找到 ${items.length} 条来源。课程事实仍以课表工具为准。`
      : "知识库没有可靠答案；如果是课程、教室或教学周问题，请改用课表工具查询。",
    cards: [makeCard("guide", "知识库来源", result.summary || "", {
      badges: ["RAG", result.sourceId || "knowledge"],
      items: items.slice(0, 4).map((item) => ({
        title: item.title,
        subtitle: item.text,
        value: item.updatedAt || "",
      })),
      actions: [],
    })],
    suggestions: ["佛课小表怎么用", "隐私说明"],
  };
}

function buildMultiStep(toolResults = []) {
  const weather = (toolResults.find((item) => item.name === "get_campus_weather") || {}).result || {};
  const rooms = (toolResults.find((item) => item.name === "search_empty_rooms") || {}).result || {};
  const schedule = (toolResults.find((item) => item.name === "get_tomorrow_courses") || {}).result || {};
  const place = (toolResults.find((item) => item.name === "search_campus_place") || {}).result || {};
  const roomCount = rooms.total || (Array.isArray(rooms.rooms) ? rooms.rooms.length : 0);
  return {
    answer: `我按步骤查了明日课程、空教室、校区天气和地点信息。${roomCount ? `空教室候选约 ${roomCount} 间。` : "当前条件下空教室候选不足。"}${weather.summary ? ` ${weather.summary}` : ""}`,
    cards: [
      makeCard("reminder", "多步骤任务", "课程、空教室、天气和地点建议", {
        badges: ["Planner", "Evidence"],
        items: [
          { title: "明日课程", subtitle: schedule.summary || "", value: `${schedule.courseCount || 0}` },
          { title: "空教室", subtitle: rooms.summary || rooms.code || "", value: `${roomCount}` },
          { title: "天气", subtitle: weather.summary || weather.code || "", value: weather.weatherText || "" },
          { title: "地点", subtitle: place.summary || "", value: `${place.total || 0}` },
        ],
        actions: [makeAction("查看空教室", "navigate", rooms.actionUrl || "/pages/empty-room/empty-room")],
      }),
    ],
    suggestions: ["换成江湾校区", "只看连续两节空教室"],
  };
}

function generate({ intent, toolResults }) {
  const first = toolResults && toolResults[0] && toolResults[0].result;
  const findResult = (name) => {
    const match = Array.isArray(toolResults) ? toolResults.find((item) => item && item.name === name) : null;
    return match && match.result;
  };
  const name = intent && intent.name;
  const payload = name === "search_empty_rooms" ? buildEmptyRoom(first || {}) :
    name === "get_today_courses" ? buildTodayCourses(first || {}) :
    name === "get_tomorrow_courses" ? buildTomorrowCourses(first || {}) :
    name === "get_next_course" ? buildNextCourse(first || {}) :
    name === "get_week_schedule" ? buildWeekSchedule(first || {}) :
    name === "get_teaching_week" ? buildTeachingWeek(first || {}) :
    name === "get_term_calendar" ? buildTermCalendar(first || {}) :
    name === "search_school_index" ? buildSchoolIndex(first || {}, findResult("get_schedule_detail")) :
    name === "diagnose_data_status" ? buildDiagnosis(first || {}) :
    name === "explain_personal_import" ? buildGuide(first || {}) :
    name === "clarify_missing_slot" ? buildClarificationV2(first || {}) :
    name === "recommend_meeting_time" ? buildMeetingV2(first || {}) :
    name === "get_campus_weather" || name === "get_course_weather_advice" ? buildWeather(first || {}) :
    name === "search_campus_place" || name === "get_campus_route" || name === "get_classroom_location" ? buildCampusPlace(first || {}) :
    name === "rag_search" ? buildKnowledge(first || {}) :
    name === "campus_multi_step_advice" ? buildMultiStep(toolResults || []) :
    name === "generate_image" ? buildKnowledge({ items: [], summary: first && first.summary || "生图能力未启用" }) :
    (name === "project_qa" || name === "conversational_help") ? projectKnowledgeService.generateFallbackResponse(name) :
    buildGeneric();
  return Object.assign({ provider: "mock" }, payload);
}

module.exports = {
  generate,
  name: "mock",
};
