const campusData = require("../../data/campusPlaces");

const CAMPUS_TABS = [
  { key: "xianxi", label: "仙溪" },
  { key: "jiangwan", label: "江湾" },
  { key: "hebin", label: "河滨" },
];

const XIANXI_AREAS = [
  { key: "north", label: "北区" },
  { key: "south", label: "南区" },
];

const MAPS = {
  jiangwan: {
    key: "jiangwan",
    campus: "江湾校区",
    area: "江湾校区",
    title: "江湾校区",
    asset: "/assets/maps/campus-map-jiangwan.jpg",
  },
  xianxiNorth: {
    key: "xianxiNorth",
    campus: "仙溪校区",
    area: "北区",
    title: "仙溪校区北区",
    asset: "/assets/maps/campus-map-xianxi-north.jpg",
  },
  xianxiSouth: {
    key: "xianxiSouth",
    campus: "仙溪校区",
    area: "南区",
    title: "仙溪校区南区",
    asset: "/assets/maps/campus-map-xianxi-south.jpg",
  },
  hebin: {
    key: "hebin",
    campus: "河滨校区",
    area: "河滨校区",
    title: "河滨校区",
    asset: "/assets/maps/campus-map-hebin.jpg",
  },
};

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, "").toLowerCase();
}

function getPlaceSearchText(place) {
  return [
    place.id,
    place.campus,
    place.area,
    place.name,
    place.code,
    place.type,
  ]
    .concat(place.aliases || [])
    .map(normalizeText)
    .filter(Boolean)
    .join("|");
}

function getMapKey(campus, area) {
  if (campus === "江湾校区" || campus === "江湾") return "jiangwan";
  if (campus === "河滨校区" || campus === "河滨") return "hebin";
  if (campus === "仙溪校区" || campus === "仙溪") {
    return area === "南区" || area === "south" ? "xianxiSouth" : "xianxiNorth";
  }
  return "xianxiNorth";
}

function getCampusFromMapKey(mapKey) {
  if (mapKey === "hebin") return "hebin";
  if (mapKey === "xianxiNorth" || mapKey === "xianxiSouth") return "xianxi";
  return "jiangwan";
}

function markerFromPlace(place) {
  const region = place && place.mapRegion;
  if (!region || place.verified !== true) return null;
  return {
    left: Math.max(0, Math.min(100, Number(region.x || 0) * 100)),
    top: Math.max(0, Math.min(100, Number(region.y || 0) * 100)),
    width: Math.max(8, Math.min(42, Number(region.width || 0.12) * 100)),
    height: Math.max(6, Math.min(36, Number(region.height || 0.1) * 100)),
  };
}

function withReviewStatus(place) {
  if (!place || typeof place !== "object") return place;
  return Object.assign({}, place, {
    reviewStatus: place.reviewStatus || (place.verified === true ? "verified" : "needs-review"),
  });
}

function placeMatchesMap(place, mapInfo) {
  return place && mapInfo &&
    place.campus === mapInfo.campus &&
    (place.area === mapInfo.area || place.type === "campus" || place.type === "area");
}

Page({
  data: {
    campusTabs: CAMPUS_TABS,
    xianxiAreas: XIANXI_AREAS,
    activeCampus: "xianxi",
    activeXianxiArea: "north",
    mapInfo: MAPS.xianxiNorth,
    places: [],
    query: "",
    results: [],
    selectedPlace: null,
    marker: null,
    imageLoaded: false,
    imageError: false,
    previewVisible: false,
    previewImagePath: "",
    previewImageLoaded: false,
    previewImageError: false,
    previewScale: 1,
    note: campusData.note || "Q 版地图仅供校园位置参考，具体以学校现场指引为准。",
  },

  onLoad(options = {}) {
    let mapKey = getMapKey(options.campus || "", options.area || "");
    if (options.map && MAPS[options.map]) mapKey = options.map;
    const place = options.placeId ? this.findPlaceById(options.placeId) : null;
    if (place) mapKey = getMapKey(place.campus, place.area);

    const activeCampus = getCampusFromMapKey(mapKey);
    const activeXianxiArea = mapKey === "xianxiSouth" ? "south" : "north";
    this.setData({
      activeCampus,
      activeXianxiArea,
      query: options.q ? decodeURIComponent(options.q) : "",
    });
    this.updateMapData(mapKey, place);
    if (options.q) this.runSearch(decodeURIComponent(options.q), place);
  },

  findPlaceById(id) {
    const target = String(id || "");
    return withReviewStatus((campusData.places || []).find((place) => place.id === target) || null);
  },

  updateMapData(mapKey, selectedPlace) {
    const mapInfo = MAPS[mapKey] || MAPS.jiangwan;
    const places = (campusData.places || [])
      .filter((place) => placeMatchesMap(place, mapInfo))
      .map(withReviewStatus)
      .sort((left, right) => {
        const typeRank = { campus: 0, area: 1, teaching_building: 2, library: 3, canteen: 4 };
        return (typeRank[left.type] || 9) - (typeRank[right.type] || 9) ||
          String(left.code || left.name).localeCompare(String(right.code || right.name));
      });
    this.setData({
      mapInfo,
      places,
      selectedPlace: selectedPlace || null,
      marker: markerFromPlace(selectedPlace),
      imageLoaded: false,
      imageError: false,
    });
  },

  onCampusTap(event) {
    const campus = event.currentTarget.dataset.key;
    const mapKey = campus === "xianxi"
      ? (this.data.activeXianxiArea === "south" ? "xianxiSouth" : "xianxiNorth")
      : campus;
    this.setData({ activeCampus: campus });
    this.updateMapData(mapKey, null);
    if (this.data.query) this.runSearch(this.data.query);
  },

  onAreaTap(event) {
    const area = event.currentTarget.dataset.key;
    const mapKey = area === "south" ? "xianxiSouth" : "xianxiNorth";
    this.setData({ activeCampus: "xianxi", activeXianxiArea: area });
    this.updateMapData(mapKey, null);
    if (this.data.query) this.runSearch(this.data.query);
  },

  onSearchInput(event) {
    const query = event.detail.value || "";
    this.setData({ query });
    this.runSearch(query);
  },

  onSearchConfirm(event) {
    const query = event.detail.value || this.data.query || "";
    this.runSearch(query);
  },

  runSearch(query, selectedPlace) {
    const q = normalizeText(query);
    if (!q) {
      this.setData({ results: [], selectedPlace: selectedPlace || null, marker: markerFromPlace(selectedPlace) });
      return;
    }
    const results = (campusData.places || [])
      .map((place) => {
        const text = getPlaceSearchText(place);
        let score = 0;
        if (normalizeText(place.code) === q || normalizeText(place.name) === q) score = 100;
        else if ((place.aliases || []).some((alias) => normalizeText(alias) === q)) score = 90;
        else if (text.includes(q)) score = 70;
        return { place, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || String(left.place.name).localeCompare(String(right.place.name)))
      .slice(0, 12)
      .map((item) => withReviewStatus(item.place));
    this.setData({ results });
    if (results.length && !selectedPlace) {
      this.focusPlace(results[0], false);
    }
  },

  onPlaceTap(event) {
    const place = this.findPlaceById(event.currentTarget.dataset.id);
    if (place) this.focusPlace(place, true);
  },

  focusPlace(place, keepResults) {
    const mapKey = getMapKey(place.campus, place.area);
    this.setData({
      activeCampus: getCampusFromMapKey(mapKey),
      activeXianxiArea: mapKey === "xianxiSouth" ? "south" : "north",
    });
    this.updateMapData(mapKey, place);
    if (keepResults !== true && this.data.query) {
      this.setData({ results: this.data.results });
    }
  },

  previewMap() {
    const url = this.data.mapInfo && this.data.mapInfo.asset;
    if (!url) return;
    wx.getImageInfo({
      src: url,
      success: (info) => {
        const path = info && info.path || url;
        wx.previewImage({
          current: path,
          urls: [path],
          fail: () => this.openCustomPreview(path),
        });
      },
      fail: () => this.openCustomPreview(url),
    });
  },

  openCustomPreview(path) {
    this.setData({
      previewVisible: true,
      previewImagePath: path,
      previewImageLoaded: false,
      previewImageError: false,
      previewScale: 1,
    });
  },

  closeCustomPreview() {
    this.setData({
      previewVisible: false,
      previewImagePath: "",
      previewImageLoaded: false,
      previewImageError: false,
      previewScale: 1,
    });
  },

  resetCustomPreviewScale() {
    this.setData({ previewScale: 1 });
  },

  retryMapImage() {
    this.setData({ imageLoaded: false, imageError: false });
    const mapInfo = Object.assign({}, this.data.mapInfo || {});
    this.setData({ mapInfo: Object.assign({}, mapInfo, { asset: "" }) }, () => {
      this.setData({ mapInfo });
    });
  },

  retryPreviewImage() {
    this.setData({
      previewImageLoaded: false,
      previewImageError: false,
    });
    const path = this.data.previewImagePath;
    this.setData({ previewImagePath: "" }, () => {
      this.setData({ previewImagePath: path });
    });
  },

  onPreviewImageLoad() {
    this.setData({ previewImageLoaded: true, previewImageError: false });
  },

  onPreviewImageError() {
    this.setData({ previewImageLoaded: false, previewImageError: true });
  },

  onMapImageLoad() {
    this.setData({ imageLoaded: true, imageError: false });
  },

  onMapImageError() {
    this.setData({ imageLoaded: false, imageError: true });
  },

  openSchoolQuery() {
    const place = this.data.selectedPlace;
    const q = place && (place.code || place.name) || this.data.query || "";
    if (!q) return;
    wx.navigateTo({
      url: `/pages/school/school?type=classroom&q=${encodeURIComponent(q)}&mapPlaceId=${encodeURIComponent(place && place.id || "")}&mapCode=${encodeURIComponent(place && place.code || q)}`,
    });
  },
});
