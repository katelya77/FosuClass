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
    statusClass: "",
  },

  observers: {
    "course, layout": function (course, layout) {
      const color = (course && course.color) || "#5d9cec";
      const status = (course && course.status) || "";
      this.setData({
        isMuted: Boolean(course && course.active === false),
        listStyle: layout === "list" ? `border-left-color:${color};` : "",
        statusClass: status ? `status-${status}` : "",
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
