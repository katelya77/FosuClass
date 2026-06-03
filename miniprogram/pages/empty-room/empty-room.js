const BRAND = require("../../config/brand");
const appConfigService = require("../../services/appConfigService");
const emptyRoomService = require("../../services/emptyRoomService");
const platformDataService = require("../../services/platformDataService");
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

const MIN_FREE_OPTIONS = ["1", "2", "3", "4"];

function safeDecodeURIComponent(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
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
    week: 1,
    weekday: 1,
    weekdayText: "周一",
    sectionPresets: SECTION_PRESETS,
    selectedSectionPresetIndex: 0,
    sections: "1-1",
    customSections: "3-4",
    buildingOptions: emptyRoomService.DEFAULT_BUILDINGS,
    selectedBuildingIndex: 0,
    minFreeOptions: MIN_FREE_OPTIONS,
    selectedMinFreeIndex: 1,
    commonOnly: false,
    excludeUnknown: true,
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
      week: Number(options.week || dateInfo.weekNo || 1),
      weekday: Number(options.weekday || dateInfo.weekday),
      weekdayText: getWeekdayLabel(Number(options.weekday || dateInfo.weekday)),
      selectedSectionPresetIndex: selectedSectionPresetIndex >= 0 ? selectedSectionPresetIndex : 0,
      sections,
      customSections: sectionParam || "3-4",
      buildingOptions,
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(selectedBuilding, this.favoriteState),
    });
  },

  loadAndSearch(options = {}) {
    this.setData({
      loading: true,
      dataState: "loading",
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
        return this.searchRooms({ forceNetwork: options.forceNetwork });
      })
      .catch((error) => {
        const state = error && error.code === "NO_ACTIVE_RELEASE" ? "noRelease" : "networkError";
        this.setData({
          loading: false,
          dataState: state,
          summaryText: state === "noRelease" ? "暂未发布课表数据" : "空教室数据加载失败",
        });
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
    return appConfigService.loadAppConfig()
      .then((config) => normalizeActiveSnapshot(config))
      .catch(() => platformDataService.loadPrefetchData({ network: false }).then((data) => platformDataService.extractActiveSnapshot(data)));
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

  searchRooms(options = {}) {
    const params = this.getQueryParams();
    return emptyRoomService.queryEmptyRooms(params, {
      forceNetwork: Boolean(options.forceNetwork),
    }).then((data) => {
      const rooms = this.decorateRoomsWithFavorites(data.rooms || []);
      const buildingOptions = emptyRoomService.buildBuildingOptions(
        data.buildings || [],
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
        restoreHint: data.fallback ? "已显示本地缓存，正在刷新" : (data.fromStorage ? "已显示本地缓存，正在校验更新" : ""),
        summaryText: `${params.date} ${getWeekdayLabel(Number(params.weekday))} 第${params.sections}节 · ${rooms.length}间可用`,
        updatedAtText: data.updatedAt ? `数据更新于 ${appConfigService.formatConfigTime(data.updatedAt)}` : this.data.updatedAtText,
      });
      return data;
    }).catch((error) => {
      this.setData({
        loading: false,
        dataState: error && error.code === "REQUEST_TIMEOUT" ? "timeout" : "networkError",
        summaryText: "空教室数据加载失败",
      });
      throw error;
    });
  },

  decorateRoomsWithFavorites(rooms) {
    const favorites = this.favoriteState || emptyRoomService.readEmptyRoomFavorites();
    return (rooms || [])
      .map((room) => Object.assign({}, room, {
        favorite: emptyRoomService.isFavoriteRoom(room.roomName, favorites),
      }))
      .sort((left, right) => {
        if (left.favorite !== right.favorite) {
          return left.favorite ? -1 : 1;
        }
        return String(left.roomName || "").localeCompare(String(right.roomName || ""), "zh-Hans-CN");
      });
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
      week: info.weekNo,
      weekday: info.weekday,
      weekdayText: info.weekdayLabel,
    }, () => this.searchRooms({ forceNetwork: true }));
  },

  onWeekInput(event) {
    const week = Math.max(1, Math.min(30, Number(event.detail.value) || 1));
    this.setData({ week });
  },

  applyWeekInput() {
    this.searchRooms({ forceNetwork: true });
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
    }, () => this.searchRooms({ forceNetwork: true }));
  },

  onCustomSectionsInput(event) {
    this.setData({
      customSections: event.detail.value,
      sections: event.detail.value,
    });
  },

  applyCustomSections() {
    this.searchRooms({ forceNetwork: true });
  },

  onBuildingChange(event) {
    const selectedBuildingIndex = Number(event.detail.value);
    const building = this.data.buildingOptions[selectedBuildingIndex] || "全部";
    this.setData({
      selectedBuildingIndex,
      selectedBuildingFavorite: emptyRoomService.isFavoriteBuilding(building, this.favoriteState),
    }, () => this.searchRooms({ forceNetwork: true }));
  },

  onMinFreeChange(event) {
    this.setData({
      selectedMinFreeIndex: Number(event.detail.value),
    }, () => this.searchRooms({ forceNetwork: true }));
  },

  onCommonOnlyChange(event) {
    this.setData({ commonOnly: Boolean(event.detail.value) }, () => this.searchRooms({ forceNetwork: true }));
  },

  onExcludeUnknownChange(event) {
    this.setData({ excludeUnknown: Boolean(event.detail.value) }, () => this.searchRooms({ forceNetwork: true }));
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
    wx.navigateTo({
      url: `/pages/schedule-view/schedule-view?type=classroom&id=${encodeURIComponent(room.roomId || room.roomName)}&name=${encodeURIComponent(room.roomName)}&term=${encodeURIComponent(snapshot.term || DEFAULT_SEMESTER_ID)}&semester=${encodeURIComponent(snapshot.term || DEFAULT_SEMESTER_ID)}&releaseVersion=${encodeURIComponent(snapshot.releaseVersion || "")}`,
    });
  },
});
