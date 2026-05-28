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
