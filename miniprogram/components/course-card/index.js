Component({
  properties: {
    course: {
      type: Object,
      value: {},
    },
    cardStyle: {
      type: String,
      value: "",
    },
    layout: {
      type: String,
      value: "grid",
    },
  },

  data: {
    isMuted: false,
    listStyle: "",
  },

  observers: {
    "course, layout": function (course, layout) {
      const color = (course && course.color) || "#5d9cec";
      this.setData({
        isMuted: Boolean(course && course.active === false),
        listStyle: layout === "list" ? `border-left-color:${color};` : "",
      });
    },
  },

  methods: {
    handleTap() {
      this.triggerEvent("tapcourse", {
        course: this.data.course,
      });
    },
  },
});
