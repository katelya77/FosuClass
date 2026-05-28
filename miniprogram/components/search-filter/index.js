Component({
  properties: {
    keyword: {
      type: String,
      value: "",
    },
    colleges: {
      type: Array,
      value: [],
    },
    grades: {
      type: Array,
      value: [],
    },
    majors: {
      type: Array,
      value: [],
    },
    selectedCollege: {
      type: String,
      value: "",
    },
    selectedGrade: {
      type: String,
      value: "",
    },
    selectedMajor: {
      type: String,
      value: "",
    },
  },

  methods: {
    emitPatch(patch) {
      this.triggerEvent("change", patch);
    },
    onKeywordInput(event) {
      this.emitPatch({
        keyword: event.detail.value,
      });
    },
    onCollegeChange(event) {
      this.emitPatch({
        selectedCollege: this.data.colleges[Number(event.detail.value)] || "",
      });
    },
    onGradeChange(event) {
      this.emitPatch({
        selectedGrade: this.data.grades[Number(event.detail.value)] || "",
      });
    },
    onMajorChange(event) {
      this.emitPatch({
        selectedMajor: this.data.majors[Number(event.detail.value)] || "",
      });
    },
  },
});
