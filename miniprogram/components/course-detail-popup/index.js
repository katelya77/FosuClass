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
      });
    },
  },

  methods: {
    close() {
      this.triggerEvent("close");
    },
    noop() {},
  },
});
