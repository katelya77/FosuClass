const BRAND = require("../../config/brand");
const appConfigService = require("../../services/appConfigService");
const emptyRoomService = require("../../services/emptyRoomService");
const platformDataService = require("../../services/platformDataService");
const releasePackService = require("../../services/releasePackService");
const teachingCalendarService = require("../../services/teachingCalendarService");
const platformUtils = require("../../utils/platform");
const {
  addLocalDays,
  formatDate,
  getTodayTeachingInfo,
  getWeekdayLabel,
  parseLocalDate,
} = require("../../utils/week");
const DEFAULT_SEMESTER_ID = "";

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
];

const ROOM_PAGE_SIZE = 30;

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

function buildDateOptions(currentDate) {
  const base = parseLocalDate(currentDate) || new Date();
  const today = new Date();
  const options = [
    { key: "today", label: "今天", date: formatDate(today) },
    { key: "tomorrow", label: "明天", date: formatDate(addLocalDays(today, 1)) },
  ];
  const monday = addLocalDays(base, -((base.getDay() + 6) % 7));
  for (let index = 0; index < 7; index += 1) {
    const date = addLocalDays(monday, index);
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

function groupRoomsByBuilding(rooms, limit) {
  const max = Math.max(0, Number(limit || ROOM_PAGE_SIZE) || ROOM_PAGE_SIZE);
  const visible = (rooms || []).slice(0, max);
  const groups = [];
  const groupMap = {};
  visible.forEach((room, sourceIndex) => {
    const building = room.building || "其他";
    if (!groupMap[building]) {
      groupMap[building] = {
        building,
        rooms: [],
        total: 0,
      };
      groups.push(groupMap[building]);
    }
    groupMap[building].rooms.push(Object.assign({}, room, {
      sourceIndex,
    }));
  });
  (rooms || []).forEach((room) => {
    const building = room.building || "其他";
    if (groupMap[building]) groupMap[building].total += 1;
  });
  return groups;
}

function resolveRoomFromEvent(event, rooms, selectedRoom) {
  const dataset = event && event.currentTarget && event.currentTarget.dataset || {};
  if (dataset.room && typeof dataset.room === "object") return dataset.room;
  const rawIndex = dataset.sourceIndex !== undefined ? dataset.sourceIndex : dataset.index;
  if (rawIndex !== undefined) {
    const index = Number(rawIndex);
    if (Number.isFinite(index) && rooms && rooms[index]) return rooms[index];
  }
  return selectedRoom || null;
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

function getDefaultSelectedTerm() {
  const calendar = teachingCalendarService.getImmediateActiveCalendar();
  if (calendar.termConfig && calendar.termConfig.term) return calendar.termConfig.term;
  const config = appConfigService.getGlobalConfig ? appConfigService.getGlobalConfig() : {};
  return config.currentSemester ||
    config.termConfig && config.termConfig.term ||
    config.availableTerms && config.availableTerms[0] && config.availableTerms[0].term ||
    DEFAULT_SEMESTER_ID;
}

Page({
  data: {
    brand: BRAND,
    activeSnapshot: null,
    date: "",
    dateText: "",
    dateOptions: [],
    datePrimaryOptions: [],
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
    dataState: "idle",
    hasSearched: false,
    restoreHint: "",
    rooms: [],
    visibleRoomLimit: ROOM_PAGE_SIZE,
    visibleRoomGroups: [],
    summaryText: "",
    updatedAtText: "",
    buildingSummaryText: "全部教学楼",
    filterSheetVisible: false,
    termPhase: "unknown",
    isInTerm: false,
    termStatusText: "",
    isTeachingDay: true,
    teachingEventNote: "",
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
    this.prepareInitialData();
  },

  initDefaults(options) {
    const now = new Date();
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const termConfig = calendar.termConfig || {};
    const weeks = calendar.weeks || [];
    const todayInfo = getTodayTeachingInfo(now, weeks, termConfig);
    const date = safeDecodeURIComponent(options.date) || todayInfo.date || formatDate(now);
    const dateInfo = getTodayTeachingInfo(date, weeks, termConfig);
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

    const dateOptions = buildDateOptions(date);
    this.setData({
      date,
      dateText: date,
      dateOptions,
      datePrimaryOptions: dateOptions.slice(0, 2),
      selectedDateKey: formatDate(new Date()) === date ? "today" : "",
      week: Number(options.week || dateInfo.weekNo || 1),
      weekday: Number(options.weekday || dateInfo.weekday),
      weekdayText: getWeekdayLabel(Number(options.weekday || dateInfo.weekday)),
      termPhase: dateInfo.termPhase || "unknown",
      isInTerm: Boolean(dateInfo.isInTerm),
      termStatusText: dateInfo.isInTerm ? "" : this.getTermPhaseText(dateInfo.termPhase),
      isTeachingDay: dateInfo.isTeachingDay !== false,
      teachingEventNote: dateInfo.teachingEventNote || "",
      selectedSectionPresetIndex: selectedSectionPresetIndex >= 0 ? selectedSectionPresetIndex : 0,
      sections,
      selectedSectionValues: parseSectionValues(sections),
      sectionChips: decorateSectionChips(parseSectionValues(sections)),
      customSections: sectionParam || "3-4",
      buildingOptions,
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(selectedBuilding, this.favoriteState),
      buildingSummaryText: this.buildingSummaryText(buildingOptions, selectedBuildingIndex, false),
    });
  },

  prepareInitialData() {
    this.setData({
      loading: false,
      dataState: "idle",
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
          updatedAtText: snapshot.updatedAt ? `数据更新于 ${appConfigService.formatConfigTime(snapshot.updatedAt)}` : "等待数据更新时间",
        });
        return this.loadEmptyRoomIndex({ forceNetwork: false });
      })
      .then((index) => {
        const buildingOptions = emptyRoomService.buildBuildingOptions(
          index.buildings || [],
          (this.favoriteState && this.favoriteState.buildings) || []
        );
        const currentBuilding = this.data.buildingOptions[this.data.selectedBuildingIndex] || "全部";
        const selectedBuildingIndex = Math.max(0, buildingOptions.indexOf(currentBuilding));
        this.setData({
          buildingOptions,
          selectedBuildingIndex,
          buildingSummaryText: this.buildingSummaryText(buildingOptions, selectedBuildingIndex, false),
        });
      })
      .catch((error) => {
        const state = error && error.code === "NO_ACTIVE_RELEASE" ? "noRelease" : "idle";
        this.setData({
          dataState: state,
          updatedAtText: state === "noRelease" ? "暂未发布课表数据" : "数据更新时间暂不可用",
        });
      });
  },

  buildingSummaryText(buildingOptions, selectedBuildingIndex, favoritesOnly) {
    const list = Array.isArray(buildingOptions) ? buildingOptions : [];
    const selected = list[selectedBuildingIndex] || "全部";
    if (favoritesOnly) return "收藏教学楼";
    if (selected && selected !== "全部") return selected;
    const count = Math.max(0, list.filter((item) => item && item !== "全部" && item !== "未知" && item !== "其他/未识别").length);
    return count ? `全部教学楼 · ${count} 栋` : "全部教学楼";
  },

  loadAndSearch(options = {}) {
    const hasRooms = Array.isArray(this.data.rooms) && this.data.rooms.length > 0;
    this.setData({
      loading: true,
      dataState: hasRooms ? this.data.dataState : "loading",
      hasSearched: true,
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
          visibleRoomGroups: hasRooms ? this.data.visibleRoomGroups : [],
          summaryText: hasRooms ? this.data.summaryText : (state === "noRelease" ? "暂未发布课表数据" : "空教室数据加载失败"),
        });
      });
  },

  getTermPhaseText(termPhase) {
    if (termPhase === "before-term") return "尚未开学";
    if (termPhase === "after-term") return "本学期已结束";
    if (termPhase === "unknown") return "当前不在教学周内";
    return "";
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
    const selectedTerm = safeDecodeURIComponent(options.term || options.semester) || getDefaultSelectedTerm();
    const localActive = releasePackService.getLocalActiveRelease(selectedTerm);
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
    return releasePackService.switchReleaseSafely({ term: selectedTerm, dedupe: true })
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
    if (this.data.isTeachingDay === false) {
      this.setData({
        loading: false,
        dataState: "empty",
        rooms: [],
        visibleRoomGroups: [],
        summaryText: this.data.teachingEventNote || "当日按校历不执行常规教学安排",
        restoreHint: "请选择其他教学日期",
      });
      return Promise.resolve({ success: true, code: "CALENDAR_NO_CLASS", rooms: [] });
    }
    if (this.data.isInTerm === false && this.data.activeQuickFilter === "now" && !options.allowOutOfTermNow) {
      this.setData({
        loading: false,
        dataState: "empty",
        rooms: [],
        visibleRoomGroups: [],
        summaryText: this.data.termStatusText || "当前不在教学周内",
        restoreHint: "可手动选择历史日期和节次后查询",
      });
      return Promise.resolve({
        success: false,
        code: "TERM_PHASE_OUT_OF_TERM",
        termPhase: this.data.termPhase,
        rooms: [],
      });
    }
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
      const visibleRoomLimit = ROOM_PAGE_SIZE;
      this.setData({
        loading: false,
        dataState: rooms.length ? "success" : "empty",
        hasSearched: true,
        rooms,
        visibleRoomLimit,
        visibleRoomGroups: groupRoomsByBuilding(rooms, visibleRoomLimit),
        buildingOptions,
        selectedBuildingIndex,
        selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(buildingOptions[selectedBuildingIndex], this.favoriteState),
        restoreHint: data.fromStorage ? "已显示本地缓存，筛选在本地完成" : "",
        summaryText: `${params.date} ${getWeekdayLabel(Number(params.weekday))} 第${params.sections}节 · ${rooms.length}间可用`,
        updatedAtText: data.updatedAt ? `数据更新于 ${appConfigService.formatConfigTime(data.updatedAt)}` : this.data.updatedAtText,
        buildingSummaryText: this.buildingSummaryText(buildingOptions, selectedBuildingIndex, this.data.favoriteBuildingsOnly),
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
        .then(() => this.applyLocalSearch(options))
        .catch((error) => {
          const rooms = Array.isArray(this.data.rooms) ? this.data.rooms : [];
          const hasRooms = rooms.length > 0;
          this.setData({
            loading: false,
            dataState: hasRooms ? this.data.dataState || "success" : "networkError",
            restoreHint: hasRooms ? "网络连接慢，已保留当前结果" : "",
            visibleRoomGroups: hasRooms ? groupRoomsByBuilding(rooms, this.data.visibleRoomLimit || ROOM_PAGE_SIZE) : [],
            summaryText: hasRooms ? this.data.summaryText : "空教室数据加载失败",
          });
          return Promise.reject(error);
        });
    }
    return this.applyLocalSearch(options);
  },

  onQueryTap() {
    return this.loadAndSearch({ reason: "manual-query" });
  },

  openFilterSheet() {
    this.setData({ filterSheetVisible: true });
  },

  closeFilterSheet() {
    this.setData({ filterSheetVisible: false });
  },

  resetFilters() {
    this.initDefaults(this.sharedOptions || {});
  },

  confirmFilters() {
    this.setData({
      filterSheetVisible: false,
      buildingSummaryText: this.buildingSummaryText(this.data.buildingOptions, this.data.selectedBuildingIndex, this.data.favoriteBuildingsOnly),
    });
  },

  onReachBottom() {
    const rooms = this.data.rooms || [];
    if (!rooms.length || this.data.visibleRoomLimit >= rooms.length) return;
    const visibleRoomLimit = Math.min(rooms.length, this.data.visibleRoomLimit + ROOM_PAGE_SIZE);
    this.setData({
      visibleRoomLimit,
      visibleRoomGroups: groupRoomsByBuilding(rooms, visibleRoomLimit),
    });
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
    const rooms = this.decorateRoomsWithFavorites(this.data.rooms);
    this.setData({
      favoriteBuildings: this.favoriteState.buildings,
      favoriteRooms: this.favoriteState.rooms,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
      rooms,
      visibleRoomGroups: groupRoomsByBuilding(rooms, this.data.visibleRoomLimit),
    });
  },

  onDateChange(event) {
    const date = event.detail.value;
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const info = getTodayTeachingInfo(date, calendar.weeks || [], calendar.termConfig || {});
    this.setData({
      date,
      dateText: date,
      dateOptions: buildDateOptions(date),
      datePrimaryOptions: buildDateOptions(date).slice(0, 2),
      selectedDateKey: formatDate(new Date()) === date ? "today" : "",
      week: info.weekNo,
      weekday: info.weekday,
      weekdayText: info.weekdayLabel,
      termPhase: info.termPhase || "unknown",
      isInTerm: Boolean(info.isInTerm),
      termStatusText: info.isInTerm ? "" : this.getTermPhaseText(info.termPhase),
      isTeachingDay: info.isTeachingDay !== false,
      teachingEventNote: info.teachingEventNote || "",
      activeQuickFilter: "custom",
    });
  },

  onDateChipTap(event) {
    const date = event.currentTarget.dataset.date;
    const key = event.currentTarget.dataset.key || "";
    if (!date) return;
    const calendar = teachingCalendarService.getImmediateActiveCalendar();
    const info = getTodayTeachingInfo(date, calendar.weeks || [], calendar.termConfig || {});
    this.setData({
      date,
      dateText: date,
      dateOptions: buildDateOptions(date),
      datePrimaryOptions: buildDateOptions(date).slice(0, 2),
      selectedDateKey: key,
      week: info.weekNo,
      weekday: info.weekday,
      weekdayText: info.weekdayLabel,
      termPhase: info.termPhase || "unknown",
      isInTerm: Boolean(info.isInTerm),
      termStatusText: info.isInTerm ? "" : this.getTermPhaseText(info.termPhase),
      isTeachingDay: info.isTeachingDay !== false,
      teachingEventNote: info.teachingEventNote || "",
      activeQuickFilter: key === "today" ? this.data.activeQuickFilter : "custom",
    });
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
    this.setData(patch);
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
    });
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
    });
  },

  onBuildingChipTap(event) {
    const building = event.currentTarget.dataset.building || "全部";
    const selectedBuildingIndex = Math.max(0, this.data.buildingOptions.indexOf(building));
    this.setData({
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
      favoriteBuildingsOnly: false,
      buildingSummaryText: this.buildingSummaryText(this.data.buildingOptions, selectedBuildingIndex, false),
    });
  },

  toggleUnknownBuildings() {
    const showUnknownBuildings = !this.data.showUnknownBuildings;
    this.setData({
      showUnknownBuildings,
      excludeUnknown: !showUnknownBuildings,
    });
  },

  onWeekInput(event) {
    const week = Math.max(1, Math.min(30, Number(event.detail.value) || 1));
    this.setData({ week });
  },

  applyWeekInput() {
    this.setData({ filterSheetVisible: false });
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
    });
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
    });
  },

  onBuildingChange(event) {
    const selectedBuildingIndex = Number(event.detail.value);
    const building = this.data.buildingOptions[selectedBuildingIndex] || "全部";
    this.setData({
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
      buildingSummaryText: this.buildingSummaryText(this.data.buildingOptions, selectedBuildingIndex, this.data.favoriteBuildingsOnly),
    });
  },

  onMinFreeChange(event) {
    this.setData({
      selectedMinFreeIndex: Number(event.detail.value),
    });
  },

  onCommonOnlyChange(event) {
    this.setData({ commonOnly: Boolean(event.detail.value) });
  },

  onFavoriteBuildingsOnlyChange(event) {
    const favoriteBuildingsOnly = Boolean(event.detail.value);
    this.setData({
      favoriteBuildingsOnly,
      buildingSummaryText: this.buildingSummaryText(this.data.buildingOptions, this.data.selectedBuildingIndex, favoriteBuildingsOnly),
    });
  },

  onExcludeUnknownChange(event) {
    this.setData({
      excludeUnknown: Boolean(event.detail.value),
      showUnknownBuildings: !Boolean(event.detail.value),
    });
  },

  onRetry() {
    this.loadAndSearch({ reason: "retry", forceNetwork: true });
  },

  onRoomTap(event) {
    const room = resolveRoomFromEvent(event, this.data.rooms, null);
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
    const room = resolveRoomFromEvent(event, this.data.rooms, this.data.selectedRoom);
    if (!room) return;
    const snapshot = this.data.activeSnapshot || {};
    const term = snapshot.term || DEFAULT_SEMESTER_ID;
    const releaseVersion = snapshot.releaseVersion || "";
    const localActive = releasePackService.getLocalActiveRelease(term);
    const activeManifest = localActive &&
      localActive.releaseVersion === releaseVersion &&
      localActive.manifest
      ? localActive.manifest
      : null;
    wx.showLoading({ title: "正在打开课表...", mask: true });
    releasePackService.resolveClassroomDetail(room.roomName, {
      term,
      releaseVersion,
      detailId: room.detailId || room.classroomId || "",
    }, {
      manifest: activeManifest,
      timeout: 15000,
      retries: 0,
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
