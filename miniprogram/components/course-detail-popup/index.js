const { courseTimes } = require("../../data/courseTimes");
const { getCourseTimeRange } = require("../../utils/course");

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
  },

  data: {
    sectionText: "",
    timeText: "",
    weekTypeText: "",
    audienceClassesText: "",
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
        audienceClassesText: course && Array.isArray(course.audienceClasses) ? course.audienceClasses.join("、") : "",
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
    noop() {},
  },
});
