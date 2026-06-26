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
      const color = (course && (course.accentColor || course.borderColor || course.color)) || "#5d9cec";
      const status = (course && course.status) || "";
      const isNext = Boolean(course && course.isNext);
      const startSection = Number(course && course.startSection) || 1;
      const endSection = Number(course && course.endSection) || 1;
      const span = endSection - startSection + 1;

      let borderLeftColor = color;
      if (layout === "list") {
        if (isNext) {
          borderLeftColor = "#1976d2";
        } else if (status === "ongoing") {
          borderLeftColor = "#2e7d32";
        }
      }

      this.setData({
        span,
        isMuted: Boolean(course && course.active === false),
        listStyle: layout === "list" ? `border-left-color:${borderLeftColor};` : "",
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
