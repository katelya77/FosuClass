const { courseTimes } = require("../../data/courseTimes");
const { getCourseTimeRange } = require("../../utils/course");

function splitAudienceClasses(course) {
  if (!course) return [];
  if (Array.isArray(course.audienceClasses) && course.audienceClasses.length) {
    return course.audienceClasses.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const raw = course.classNameRaw || course.audienceClassNameRaw || "";
  return String(raw || "")
    .split(/[，、,;；\n\r]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    course: {
      type: Object,
      value: {},
    },
    editable: { type: Boolean, value: false },
  },

  data: {
    sectionText: "",
    timeText: "",
    weekTypeText: "",
    audienceClassesText: "",
    classScopeReasonText: "",
  },

  observers: {
    course(course) {
      const weekTypeMap = {
        odd: "单周",
        even: "双周",
        all: "每周",
      };
      this.setData({
        sectionText: course && course.startSection ? `第${course.startSection}-${course.endSection}节` : "",
        timeText: course ? course.timeText || getCourseTimeRange(course, courseTimes) : "",
        weekTypeText: weekTypeMap[(course && course.weekType) || "all"],
        audienceClassesText: splitAudienceClasses(course).join("、"),
        classScopeReasonText: course && (course.classScopeReason || course.classScopeReasonText || "") || "",
      });
    },
  },

  methods: {
    close() {
      this.triggerEvent("close");
    },
    copyAsCustom() {
      this.triggerEvent("copycustom", {
        course: this.data.course,
      });
    },
    editCourse() {
      this.triggerEvent("editcourse", { course: this.data.course });
    },
    noop() {},
  },
});
