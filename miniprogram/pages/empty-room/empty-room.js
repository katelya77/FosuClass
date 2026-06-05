const BRAND = require("../../config/brand");
const appConfigService = require("../../services/appConfigService");
const emptyRoomService = require("../../services/emptyRoomService");
const platformDataService = require("../../services/platformDataService");
const releasePackService = require("../../services/releasePackService");
const { mockCalendar } = require("../../data/mockCalendar");
const {
  DEFAULT_SEMESTER_ID,
  formatDate,
  getTodayTeachingInfo,
  getWeekdayLabel,
} = require("../../utils/week");

const SECTION_PRESETS = [
  { key: "current", label: "当前节" },
  { key: "next", label: "下一节" },
  { key: "morning", label: "上午" },
  { key: "afternoon", label: "下午" },
  { key: "evening", label: "晚上" },
  { key: "custom", label: "自定义" },
];

const QUICK_FILTERS = [
  { key: "now", label: "现在可用" },
  { key: "morning", label: "上午" },
  { key: "afternoon", label: "下午" },
  { key: "evening", label: "晚上" },
  { key: "continuous2", label: "连续 2 节+" },
  { key: "continuous4", label: "连续 4 节+" },
  { key: "favorites", label: "收藏楼栋" },
];

const SECTION_CHIPS = Array.from({ length: 14 }, (_, index) => ({
  value: index + 1,
  label: String(index + 1),
}));

const MIN_FREE_OPTIONS = ["1", "2", "3", "4"];

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function toDateObject(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function addDays(date, days) {
  const next = new Date(toDateObject(date).getTime());
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function buildDateOptions(currentDate) {
  const base = toDateObject(currentDate);
  const today = new Date();
  const options = [
    { key: "today", label: "今天", date: formatDate(today) },
    { key: "tomorrow", label: "明天", date: formatDate(addDays(today, 1)) },
  ];
  const monday = addDays(base, -((base.getDay() + 6) % 7));
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(monday, index);
    options.push({
      key: `week-${index + 1}`,
      label: getWeekdayLabel(index + 1),
      date: formatDate(date),
    });
  }
  const seen = new Set();
  return options.filter((item) => {
    const key = item.label + item.date;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseSectionValues(value) {
  const text = String(value || "");
  const rangeMatch = text.match(/(\d+)\s*[-~～至到]\s*(\d+)/);
  if (rangeMatch) {
    const start = Math.min(Number(rangeMatch[1]), Number(rangeMatch[2]));
    const end = Math.max(Number(rangeMatch[1]), Number(rangeMatch[2]));
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  }
  return Array.from(new Set((text.match(/\d{1,2}/g) || []).map(Number).filter((num) => num >= 1 && num <= 14)))
    .sort((left, right) => left - right);
}

function sectionValuesToText(values) {
  const list = Array.from(new Set(values || [])).map(Number).filter((num) => num >= 1 && num <= 14).sort((left, right) => left - right);
  if (!list.length) return "";
  let contiguous = true;
  for (let index = 1; index < list.length; index += 1) {
    if (list[index] !== list[index - 1] + 1) {
      contiguous = false;
      break;
    }
  }
  return contiguous && list.length > 1 ? `${list[0]}-${list[list.length - 1]}` : list.join(",");
}

function decorateSectionChips(values) {
  const selected = new Set((values || []).map(Number));
  return SECTION_CHIPS.map((item) => Object.assign({}, item, {
    selected: selected.has(item.value),
  }));
}

function normalizeActiveSnapshot(config) {
  const data = config && config.data ? config.data : config;
  const version = data && data.dataVersion ? data.dataVersion : {};
  const releaseVersion = data && (data.releaseVersion || data.activeReleaseVersion || version.releaseVersion);
  if (!releaseVersion) return null;
  const updatedAt = data.dataUpdatedAt ||
    data.publishedAt ||
    version.classScheduleUpdatedAt ||
    version.classroomScheduleUpdatedAt ||
    data.updatedAt ||
    "";
  return {
    term: data.term || data.currentSemester || DEFAULT_SEMESTER_ID,
    releaseVersion,
    updatedAt,
    cacheEpoch: data.cacheEpoch || updatedAt || releaseVersion,
    counts: data.counts || {},
  };
}

Page({
  data: {
    brand: BRAND,
    activeSnapshot: null,
    date: "",
    dateText: "",
    dateOptions: [],
    selectedDateKey: "today",
    week: 1,
    weekday: 1,
    weekdayText: "周一",
    sectionPresets: SECTION_PRESETS,
    quickFilters: QUICK_FILTERS,
    activeQuickFilter: "now",
    sectionChips: decorateSectionChips([]),
    selectedSectionValues: [],
    selectedSectionPresetIndex: 0,
    sections: "1-1",
    customSections: "3-4",
    buildingOptions: emptyRoomService.DEFAULT_BUILDINGS,
    selectedBuildingIndex: 0,
    minFreeOptions: MIN_FREE_OPTIONS,
    selectedMinFreeIndex: 1,
    commonOnly: false,
    favoriteBuildingsOnly: false,
    excludeUnknown: true,
    showUnknownBuildings: false,
    loading: false,
    dataState: "loading",
    restoreHint: "",
    rooms: [],
    summaryText: "",
    updatedAtText: "",
    selectedRoom: null,
    detailVisible: false,
    favoriteBuildings: [],
    favoriteRooms: [],
    selectedBuildingFavorite: false,
  },

  onLoad(options) {
    this.sharedOptions = options || {};
    this.favoriteState = emptyRoomService.readEmptyRoomFavorites();
    this.setData({
      favoriteBuildings: this.favoriteState.buildings,
      favoriteRooms: this.favoriteState.rooms,
    });
    this.initDefaults(options || {});
    this.loadAndSearch({ reason: "onLoad" });
  },

  initDefaults(options) {
    const now = new Date();
    const todayInfo = getTodayTeachingInfo(now, mockCalendar);
    const date = safeDecodeURIComponent(options.date) || todayInfo.date || formatDate(now);
    const dateInfo = getTodayTeachingInfo(date, mockCalendar);
    const sectionParam = safeDecodeURIComponent(options.section || options.sections);
    const buildingParam = safeDecodeURIComponent(options.building);
    const selectedSectionPresetIndex = sectionParam
      ? SECTION_PRESETS.findIndex((item) => item.key === "custom")
      : SECTION_PRESETS.findIndex((item) => item.key === "current");
    const sections = sectionParam || emptyRoomService.getPresetSectionValue("current", now);
    const buildingOptions = emptyRoomService.buildBuildingOptions(
      buildingParam ? [buildingParam] : [],
      (this.favoriteState && this.favoriteState.buildings) || []
    );
    const selectedBuildingIndex = buildingParam ? Math.max(0, buildingOptions.indexOf(buildingParam)) : 0;
    const selectedBuilding = buildingOptions[selectedBuildingIndex] || "全部";

    this.setData({
      date,
      dateText: date,
      dateOptions: buildDateOptions(date),
      selectedDateKey: formatDate(new Date()) === date ? "today" : "",
      week: Number(options.week || dateInfo.weekNo || 1),
      weekday: Number(options.weekday || dateInfo.weekday),
      weekdayText: getWeekdayLabel(Number(options.weekday || dateInfo.weekday)),
      selectedSectionPresetIndex: selectedSectionPresetIndex >= 0 ? selectedSectionPresetIndex : 0,
      sections,
      selectedSectionValues: parseSectionValues(sections),
      sectionChips: decorateSectionChips(parseSectionValues(sections)),
      customSections: sectionParam || "3-4",
      buildingOptions,
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(selectedBuilding, this.favoriteState),
    });
  },

  loadAndSearch(options = {}) {
    const hasRooms = Array.isArray(this.data.rooms) && this.data.rooms.length > 0;
    this.setData({
      loading: true,
      dataState: hasRooms ? this.data.dataState : "loading",
      restoreHint: "",
    });

    this.resolveActiveSnapshot()
      .then((snapshot) => {
        if (!snapshot || !snapshot.releaseVersion) {
          const error = new Error("NO_ACTIVE_RELEASE");
          error.code = "NO_ACTIVE_RELEASE";
          throw error;
        }
        this.setData({
          activeSnapshot: snapshot,
          updatedAtText: snapshot.updatedAt ? `数据更新于 ${appConfigService.formatConfigTime(snapshot.updatedAt)}` : "",
        });
        return this.loadEmptyRoomIndex({ forceNetwork: options.forceNetwork });
      })
      .then(() => this.applyLocalSearch({ reason: options.reason || "loadAndSearch" }))
      .catch((error) => {
        const state = error && error.code === "NO_ACTIVE_RELEASE" ? "noRelease" : "networkError";
        this.setData({
          loading: false,
          dataState: state,
          restoreHint: hasRooms ? "网络连接慢，已保留当前结果" : "",
          summaryText: hasRooms ? this.data.summaryText : (state === "noRelease" ? "暂未发布课表数据" : "空教室数据加载失败"),
        });
      });
  },

  loadEmptyRoomIndex(options = {}) {
    const snapshot = this.data.activeSnapshot || {};
    const indexKey = `${snapshot.term || DEFAULT_SEMESTER_ID}:${snapshot.releaseVersion || ""}`;
    if (this.emptyRoomIndex && this.emptyRoomIndexKey === indexKey && !options.forceNetwork) {
      return Promise.resolve(this.emptyRoomIndex);
    }
    return emptyRoomService.loadEmptyRoomIndex({
      term: snapshot.term || DEFAULT_SEMESTER_ID,
      releaseVersion: snapshot.releaseVersion || "",
    }, {
      forceNetwork: Boolean(options.forceNetwork),
    }).then((index) => {
      this.emptyRoomIndex = index;
      this.emptyRoomIndexKey = indexKey;
      return index;
    });
  },

  resolveActiveSnapshot() {
    const options = this.sharedOptions || {};
    const optionReleaseVersion = safeDecodeURIComponent(options.releaseVersion || options.version);
    if (optionReleaseVersion) {
      return Promise.resolve({
        term: safeDecodeURIComponent(options.term || options.semester) || DEFAULT_SEMESTER_ID,
        releaseVersion: optionReleaseVersion,
        updatedAt: "",
        cacheEpoch: optionReleaseVersion,
        counts: {},
      });
    }
    const platformSnapshot = platformDataService.getCachedPlatformSnapshot();
    if (platformSnapshot && platformSnapshot.releaseVersion) {
      return Promise.resolve(platformSnapshot);
    }
    const localActive = releasePackService.getLocalActiveRelease(DEFAULT_SEMESTER_ID);
    if (localActive && localActive.releaseVersion) {
      releasePackService.switchReleaseSafely({ term: localActive.term, dedupe: true })
        .catch((error) => console.warn("[empty-room] background release refresh failed", {
          code: error && (error.code || error.reasonCode),
        }));
      return Promise.resolve({
        term: localActive.term,
        releaseVersion: localActive.releaseVersion,
        updatedAt: localActive.manifest && localActive.manifest.updatedAt || "",
        cacheEpoch: localActive.cacheEpoch,
        forceRefreshToken: localActive.forceRefreshToken,
        counts: localActive.manifest && localActive.manifest.counts || {},
      });
    }
    return releasePackService.switchReleaseSafely({ term: DEFAULT_SEMESTER_ID, dedupe: true })
      .then((result) => normalizeActiveSnapshot(result && result.manifest))
      .catch(() => appConfigService.loadAppConfig()
        .then((config) => normalizeActiveSnapshot(config))
        .catch(() => platformDataService.loadPrefetchData({ network: false }).then((data) => platformDataService.extractActiveSnapshot(data))));
  },

  getQueryParams() {
    const snapshot = this.data.activeSnapshot || {};
    const building = this.data.buildingOptions[this.data.selectedBuildingIndex] || "全部";
    return {
      term: snapshot.term || DEFAULT_SEMESTER_ID,
      releaseVersion: snapshot.releaseVersion || "",
      date: this.data.date,
      week: this.data.week,
      weekday: this.data.weekday,
      sections: this.data.sections || this.data.customSections,
      building,
      minFreeSections: this.data.minFreeOptions[this.data.selectedMinFreeIndex] || "1",
      commonOnly: this.data.commonOnly ? "1" : "",
      excludeUnknown: this.data.excludeUnknown ? "1" : "",
    };
  },

  applyLocalSearch(options = {}) {
    const params = this.getQueryParams();
    const index = this.emptyRoomIndex;
    if (!index) {
      return this.loadEmptyRoomIndex({ forceNetwork: Boolean(options.forceNetwork) })
        .then(() => this.applyLocalSearch(Object.assign({}, options, { forceNetwork: false })));
    }
    try {
      const data = emptyRoomService.filterEmptyRoomIndex(index, params);
      let rooms = this.decorateRoomsWithFavorites(data.rooms || []);
      if (this.data.favoriteBuildingsOnly) {
        const favoriteBuildings = new Set((this.favoriteState && this.favoriteState.buildings) || []);
        rooms = rooms.filter((room) => favoriteBuildings.has(room.building));
      }
      const buildingOptions = emptyRoomService.buildBuildingOptions(
        index.buildings || data.buildings || [],
        (this.favoriteState && this.favoriteState.buildings) || []
      );
      const currentBuilding = params.building || "全部";
      const selectedBuildingIndex = Math.max(0, buildingOptions.indexOf(currentBuilding));
      this.setData({
        loading: false,
        dataState: rooms.length ? "success" : "empty",
        rooms,
        buildingOptions,
        selectedBuildingIndex,
        selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(buildingOptions[selectedBuildingIndex], this.favoriteState),
        restoreHint: data.fromStorage ? "已显示本地缓存，筛选在本地完成" : "",
        summaryText: `${params.date} ${getWeekdayLabel(Number(params.weekday))} 第${params.sections}节 · ${rooms.length}间可用`,
        updatedAtText: data.updatedAt ? `数据更新于 ${appConfigService.formatConfigTime(data.updatedAt)} · 当前 Release Pack 静态索引` : this.data.updatedAtText,
      });
      return Promise.resolve(data);
    } catch (error) {
      this.setData({
        loading: false,
        dataState: error && (error.code === "REQUEST_TIMEOUT" || error.code === "TIMEOUT") ? "timeout" : "networkError",
        restoreHint: this.data.rooms.length ? "网络连接慢，已保留当前结果" : "",
        summaryText: this.data.rooms.length ? this.data.summaryText : "空教室数据加载失败",
      });
      return Promise.reject(error);
    }
  },

  searchRooms(options = {}) {
    if (options.forceNetwork) {
      return this.loadEmptyRoomIndex({ forceNetwork: true })
        .then(() => this.applyLocalSearch(options));
    }
    return this.applyLocalSearch(options);
  },

  decorateRoomsWithFavorites(rooms) {
    const favorites = this.favoriteState || emptyRoomService.readEmptyRoomFavorites();
    return (rooms || [])
      .map((room) => Object.assign({}, room, {
        favorite: emptyRoomService.isFavoriteRoom(room.roomName, favorites),
      }));
  },

  refreshFavoriteState() {
    this.favoriteState = emptyRoomService.readEmptyRoomFavorites();
    const building = this.data.buildingOptions[this.data.selectedBuildingIndex] || "全部";
    this.setData({
      favoriteBuildings: this.favoriteState.buildings,
      favoriteRooms: this.favoriteState.rooms,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
      rooms: this.decorateRoomsWithFavorites(this.data.rooms),
    });
  },

  onDateChange(event) {
    const date = event.detail.value;
    const info = getTodayTeachingInfo(date, mockCalendar);
    this.setData({
      date,
      dateText: date,
      dateOptions: buildDateOptions(date),
      selectedDateKey: formatDate(new Date()) === date ? "today" : "",
      week: info.weekNo,
      weekday: info.weekday,
      weekdayText: info.weekdayLabel,
    }, () => this.searchRooms());
  },

  onDateChipTap(event) {
    const date = event.currentTarget.dataset.date;
    const key = event.currentTarget.dataset.key || "";
    if (!date) return;
    const info = getTodayTeachingInfo(date, mockCalendar);
    this.setData({
      date,
      dateText: date,
      selectedDateKey: key,
      week: info.weekNo,
      weekday: info.weekday,
      weekdayText: info.weekdayLabel,
    }, () => this.searchRooms());
  },

  onQuickFilterTap(event) {
    const key = event.currentTarget.dataset.key;
    const patch = {
      activeQuickFilter: key,
      favoriteBuildingsOnly: false,
    };
    if (key === "now") {
      patch.sections = emptyRoomService.getPresetSectionValue("current", new Date());
      patch.selectedSectionPresetIndex = SECTION_PRESETS.findIndex((item) => item.key === "current");
      patch.selectedMinFreeIndex = 0;
    } else if (key === "morning" || key === "afternoon" || key === "evening") {
      patch.sections = emptyRoomService.getPresetSectionValue(key, new Date());
      patch.selectedSectionPresetIndex = SECTION_PRESETS.findIndex((item) => item.key === key);
      patch.selectedMinFreeIndex = 0;
    } else if (key === "continuous2") {
      patch.selectedMinFreeIndex = 1;
    } else if (key === "continuous4") {
      patch.selectedMinFreeIndex = 3;
    } else if (key === "favorites") {
      patch.favoriteBuildingsOnly = true;
    }
    if (patch.sections) {
      patch.selectedSectionValues = parseSectionValues(patch.sections);
      patch.sectionChips = decorateSectionChips(patch.selectedSectionValues);
      patch.customSections = patch.sections;
    }
    this.setData(patch, () => this.searchRooms());
  },

  onSectionChipTap(event) {
    const value = Number(event.currentTarget.dataset.value);
    if (!value) return;
    const current = new Set(this.data.selectedSectionValues || []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const selectedSectionValues = Array.from(current).sort((left, right) => left - right);
    const sections = sectionValuesToText(selectedSectionValues);
    this.setData({
      selectedSectionValues,
      sectionChips: decorateSectionChips(selectedSectionValues),
      sections: sections || this.data.sections,
      customSections: sections || this.data.customSections,
      selectedSectionPresetIndex: SECTION_PRESETS.findIndex((item) => item.key === "custom"),
      activeQuickFilter: "custom",
    }, () => this.searchRooms());
  },

  onSectionGroupTap(event) {
    const key = event.currentTarget.dataset.key;
    const sections = emptyRoomService.getPresetSectionValue(key, new Date());
    this.setData({
      sections,
      customSections: sections,
      selectedSectionValues: parseSectionValues(sections),
      sectionChips: decorateSectionChips(parseSectionValues(sections)),
      selectedSectionPresetIndex: SECTION_PRESETS.findIndex((item) => item.key === key),
      activeQuickFilter: key,
    }, () => this.searchRooms());
  },

  onBuildingChipTap(event) {
    const building = event.currentTarget.dataset.building || "全部";
    const selectedBuildingIndex = Math.max(0, this.data.buildingOptions.indexOf(building));
    this.setData({
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
      favoriteBuildingsOnly: false,
    }, () => this.searchRooms());
  },

  toggleUnknownBuildings() {
    const showUnknownBuildings = !this.data.showUnknownBuildings;
    this.setData({
      showUnknownBuildings,
      excludeUnknown: !showUnknownBuildings,
    }, () => this.searchRooms());
  },

  onWeekInput(event) {
    const week = Math.max(1, Math.min(30, Number(event.detail.value) || 1));
    this.setData({ week });
  },

  applyWeekInput() {
    this.searchRooms();
  },

  onSectionPresetChange(event) {
    const selectedSectionPresetIndex = Number(event.detail.value);
    const preset = SECTION_PRESETS[selectedSectionPresetIndex] || SECTION_PRESETS[0];
    const sections = preset.key === "custom"
      ? this.data.customSections
      : emptyRoomService.getPresetSectionValue(preset.key, new Date());
    this.setData({
      selectedSectionPresetIndex,
      sections,
      selectedSectionValues: parseSectionValues(sections),
      sectionChips: decorateSectionChips(parseSectionValues(sections)),
    }, () => this.searchRooms());
  },

  onCustomSectionsInput(event) {
    this.setData({
      customSections: event.detail.value,
      sections: event.detail.value,
    });
  },

  applyCustomSections() {
    this.setData({
      selectedSectionValues: parseSectionValues(this.data.customSections),
      sectionChips: decorateSectionChips(parseSectionValues(this.data.customSections)),
    }, () => this.searchRooms());
  },

  onBuildingChange(event) {
    const selectedBuildingIndex = Number(event.detail.value);
    const building = this.data.buildingOptions[selectedBuildingIndex] || "全部";
    this.setData({
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
    }, () => this.searchRooms());
  },

  onMinFreeChange(event) {
    this.setData({
      selectedMinFreeIndex: Number(event.detail.value),
    }, () => this.searchRooms());
  },

  onCommonOnlyChange(event) {
    this.setData({ commonOnly: Boolean(event.detail.value) }, () => this.searchRooms());
  },

  onExcludeUnknownChange(event) {
    this.setData({
      excludeUnknown: Boolean(event.detail.value),
      showUnknownBuildings: !Boolean(event.detail.value),
    }, () => this.searchRooms());
  },

  onRetry() {
    this.searchRooms({ forceNetwork: true });
  },

  onRoomTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    const room = this.data.rooms[index];
    if (!room) return;
    this.setData({
      selectedRoom: room,
      detailVisible: true,
    });
  },

  closeRoomDetail() {
    this.setData({
      selectedRoom: null,
      detailVisible: false,
    });
  },

  copyRoomName(event) {
    const name = event.currentTarget.dataset.name || (this.data.selectedRoom && this.data.selectedRoom.roomName) || "";
    if (!name) return;
    wx.setClipboardData({
      data: name,
      success: () => {
        wx.showToast({ title: "已复制教室名", icon: "success" });
      },
    });
  },

  toggleFavoriteBuilding() {
    const building = this.data.buildingOptions[this.data.selectedBuildingIndex] || "";
    if (!building || building === "全部") {
      wx.showToast({ title: "请先选择具体教学楼", icon: "none" });
      return;
    }
    const nextEnabled = !emptyRoomService.isFavoriteBuilding(building, this.favoriteState);
    this.favoriteState = emptyRoomService.setFavoriteBuilding(building, nextEnabled);
    this.refreshFavoriteState();
    wx.showToast({
      title: nextEnabled ? "已收藏教学楼" : "已取消收藏",
      icon: "none",
    });
  },

  toggleFavoriteRoom(event) {
    const name = event.currentTarget.dataset.name || (this.data.selectedRoom && this.data.selectedRoom.roomName) || "";
    const building = event.currentTarget.dataset.building || (this.data.selectedRoom && this.data.selectedRoom.building) || "";
    if (!name) return;
    const nextEnabled = !emptyRoomService.isFavoriteRoom(name, this.favoriteState);
    this.favoriteState = emptyRoomService.setFavoriteRoom(name, nextEnabled, { building });
    this.refreshFavoriteState();
    if (this.data.selectedRoom && this.data.selectedRoom.roomName === name) {
      this.setData({
        selectedRoom: Object.assign({}, this.data.selectedRoom, { favorite: nextEnabled }),
      });
    }
    wx.showToast({
      title: nextEnabled ? "已收藏教室" : "已取消收藏",
      icon: "none",
    });
  },

  openClassroomSchedule(event) {
    const room = event.currentTarget.dataset.index !== undefined
      ? this.data.rooms[Number(event.currentTarget.dataset.index)]
      : this.data.selectedRoom;
    if (!room) return;
    const snapshot = this.data.activeSnapshot || {};
    const term = snapshot.term || DEFAULT_SEMESTER_ID;
    const releaseVersion = snapshot.releaseVersion || "";
    wx.showLoading({ title: "正在打开课表...", mask: true });
    releasePackService.resolveClassroomDetail(room.roomName, {
      term,
      releaseVersion,
      detailId: room.detailId || room.classroomId || "",
    }, {
      timeout: 12000,
      retries: 1,
    })
      .then((resolved) => {
        wx.hideLoading();
        const schedule = resolved.schedule || resolved.detail || {};
        const detailId = resolved.detailId || resolved.resolvedId || schedule.id || room.detailId || room.classroomId || "";
        if (!detailId) {
          throw Object.assign(new Error("CLASSROOM_DETAIL_ID_MISSING"), { code: "CLASSROOM_DETAIL_ID_MISSING" });
        }
        wx.navigateTo({
          url: `/pages/schedule-view/schedule-view?type=classroom&id=${encodeURIComponent(detailId)}&name=${encodeURIComponent(room.roomName)}&term=${encodeURIComponent(term)}&semester=${encodeURIComponent(term)}&releaseVersion=${encodeURIComponent(resolved.releaseVersion || releaseVersion)}`,
          success: (res) => {
            if (res.eventChannel && typeof res.eventChannel.emit === "function") {
              res.eventChannel.emit("acceptDataFromOpenerPage", {
                courses: Array.isArray(schedule.courses) ? schedule.courses : [],
                schedule: Object.assign({}, schedule, {
                  id: detailId,
                  detailId,
                  roomName: room.roomName,
                  scheduleVersion: resolved.releaseVersion || releaseVersion,
                  releaseVersion: resolved.releaseVersion || releaseVersion,
                  semester: term,
                }),
              });
            }
          },
        });
      })
      .catch((error) => {
        wx.hideLoading();
        wx.showToast({
          title: "该教室暂无课表详情，但空闲结果仍可参考",
          icon: "none",
        });
        if (platformUtils.isDeveloperEnv && platformUtils.isDeveloperEnv()) {
          console.warn("[empty-room] open classroom schedule failed", {
            roomName: room.roomName,
            releaseVersion,
            error,
          });
        }
      });
  },
});
