const MAPS = [
  {
    key: "xianxiNorth",
    label: "仙溪北区",
    campus: "仙溪校区",
    area: "北区",
    asset: "/assets/maps/campus-map-xianxi-north.jpg",
  },
  {
    key: "xianxiSouth",
    label: "仙溪南区",
    campus: "仙溪校区",
    area: "南区",
    asset: "/assets/maps/campus-map-xianxi-south.jpg",
  },
  {
    key: "jiangwan",
    label: "江湾校区",
    campus: "江湾校区",
    area: "江湾校区",
    asset: "/assets/maps/campus-map-jiangwan.jpg",
  },
  {
    key: "hebin",
    label: "河滨校区",
    campus: "河滨校区",
    area: "河滨校区",
    asset: "/assets/maps/campus-map-hebin.jpg",
  },
];

const state = {
  data: null,
  mapKey: "xianxiNorth",
  selectedId: "",
  zoom: 0.76,
  panX: 24,
  panY: 24,
  image: { width: 1000, height: 680, naturalWidth: 1000, naturalHeight: 680 },
  drag: null,
  dirty: false,
  undo: [],
  redo: [],
};

const el = {
  mapTabs: document.getElementById("mapTabs"),
  stage: document.getElementById("stage"),
  canvas: document.getElementById("mapCanvas"),
  mapImage: document.getElementById("mapImage"),
  zoomLabel: document.getElementById("zoomLabel"),
  placesList: document.getElementById("placesList"),
  selectedTitle: document.getElementById("selectedTitle"),
  form: document.getElementById("placeForm"),
  toast: document.getElementById("toast"),
  statusLeft: document.getElementById("statusLeft"),
  statusRight: document.getElementById("statusRight"),
  importFile: document.getElementById("importFile"),
};

const fields = [
  "id",
  "name",
  "code",
  "campus",
  "area",
  "type",
  "aliases",
  "description",
  "reviewStatus",
  "verified",
  "updatedAt",
  "x",
  "y",
  "width",
  "height",
];

function cloneData(data) {
  return JSON.parse(JSON.stringify(data));
}

function pushUndo() {
  if (!state.data) return;
  state.undo.push(cloneData(state.data));
  if (state.undo.length > 80) state.undo.shift();
  state.redo = [];
  state.dirty = true;
  updateStatus();
}

function getMapMeta(key = state.mapKey) {
  return MAPS.find((item) => item.key === key) || MAPS[0];
}

function normalizeText(value) {
  return String(value || "").trim();
}

function getPlaces() {
  return state.data?.places || [];
}

function getSelectedPlace() {
  return getPlaces().find((place) => place.id === state.selectedId) || null;
}

function placeMapKey(place) {
  const asset = normalizeText(place.mapAsset);
  if (asset.includes("xianxi-north")) return "xianxiNorth";
  if (asset.includes("xianxi-south")) return "xianxiSouth";
  if (asset.includes("jiangwan")) return "jiangwan";
  if (asset.includes("hebin")) return "hebin";
  const campus = normalizeText(place.campus);
  const area = normalizeText(place.area);
  if (campus.includes("江湾")) return "jiangwan";
  if (campus.includes("河滨")) return "hebin";
  if (area.includes("南")) return "xianxiSouth";
  return "xianxiNorth";
}

function getVisiblePlaces() {
  return getPlaces().filter((place) => placeMapKey(place) === state.mapKey);
}

function isVerified(place) {
  return place?.verified === true || place?.verified === "true";
}

function getRegion(place) {
  const region = place.mapRegion || {};
  return {
    x: Number(region.x) || 0,
    y: Number(region.y) || 0,
    width: Number(region.width) || 0.08,
    height: Number(region.height) || 0.06,
  };
}

function setRegion(place, region) {
  place.mapRegion = {
    x: roundUnit(region.x),
    y: roundUnit(region.y),
    width: roundUnit(region.width),
    height: roundUnit(region.height),
  };
}

function roundUnit(value) {
  return Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 10000) / 10000;
}

function clampRegion(region) {
  const width = Math.max(0.005, Math.min(1, Number(region.width) || 0.005));
  const height = Math.max(0.005, Math.min(1, Number(region.height) || 0.005));
  const x = Math.max(0, Math.min(1 - width, Number(region.x) || 0));
  const y = Math.max(0, Math.min(1 - height, Number(region.y) || 0));
  return { x, y, width, height };
}

function mapToScreen(region) {
  return {
    left: region.x * state.image.width,
    top: region.y * state.image.height,
    width: region.width * state.image.width,
    height: region.height * state.image.height,
  };
}

function pointerToMap(event) {
  const rect = el.stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.panX) / state.zoom,
    y: (event.clientY - rect.top - state.panY) / state.zoom,
  };
}

function buildCampusTabs() {
  el.mapTabs.innerHTML = "";
  MAPS.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `map-tab${item.key === state.mapKey ? " active" : ""}`;
    button.textContent = item.label;
    button.addEventListener("click", () => {
      state.mapKey = item.key;
      state.selectedId = "";
      fitMapIfNeeded();
      render();
    });
    el.mapTabs.appendChild(button);
  });
}

function fitMapIfNeeded(force = false) {
  if (!force && state.zoom) return;
  const rect = el.stage.getBoundingClientRect();
  const zoomX = (rect.width - 48) / state.image.width;
  const zoomY = (rect.height - 48) / state.image.height;
  state.zoom = Math.max(0.2, Math.min(1, zoomX, zoomY));
  state.panX = 24;
  state.panY = 24;
}

function updateTransform() {
  el.canvas.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
  el.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function renderCanvas() {
  const meta = getMapMeta();
  el.mapImage.src = meta.asset;
  el.mapImage.style.width = `${state.image.width}px`;
  el.canvas.querySelectorAll(".place-box").forEach((node) => node.remove());

  getVisiblePlaces().forEach((place) => {
    const region = mapToScreen(getRegion(place));
    const box = document.createElement("div");
    box.className = [
      "place-box",
      isVerified(place) ? "verified" : "needs-review",
      place.id === state.selectedId ? "selected" : "",
    ].join(" ");
    box.style.left = `${region.left}px`;
    box.style.top = `${region.top}px`;
    box.style.width = `${region.width}px`;
    box.style.height = `${region.height}px`;
    box.dataset.id = place.id;
    box.title = isVerified(place) ? "已人工核对" : "待人工核对";

    const label = document.createElement("div");
    label.className = "place-label";
    label.textContent = place.code ? `${place.code} ${place.name}` : place.name || place.id;
    box.appendChild(label);

    if (place.id === state.selectedId) {
      ["nw", "n", "ne", "e", "se", "s", "sw", "w"].forEach((pos) => {
        const handle = document.createElement("div");
        handle.className = `handle ${pos}`;
        handle.dataset.handle = pos;
        box.appendChild(handle);
      });
    }

    box.addEventListener("pointerdown", onPlacePointerDown);
    el.canvas.appendChild(box);
  });

  updateTransform();
}

function renderPlacesList() {
  const visible = getVisiblePlaces();
  el.placesList.innerHTML = "";
  visible.forEach((place) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `place-item${place.id === state.selectedId ? " active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(place.name || place.id)}</strong>
      <span class="place-meta">
        <span>${escapeHtml(place.code || "无代码")}</span>
        <span>${escapeHtml(place.type || "未分类")}</span>
        <span class="badge ${isVerified(place) ? "good" : "warn"}">${isVerified(place) ? "已核对" : "待核对"}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      state.selectedId = place.id;
      render();
    });
    el.placesList.appendChild(button);
  });
}

function renderForm() {
  const place = getSelectedPlace();
  el.selectedTitle.textContent = place ? place.name || place.id : "未选择地点";
  fields.forEach((name) => {
    const input = el.form.elements[name];
    if (!input) return;
    if (!place) {
      input.value = "";
      input.disabled = true;
      return;
    }
    input.disabled = false;
    if (name === "verified") {
      input.value = isVerified(place) ? "true" : "false";
      return;
    }
    if (["x", "y", "width", "height"].includes(name)) {
      input.value = getRegion(place)[name];
      return;
    }
    if (name === "aliases") {
      input.value = Array.isArray(place.aliases) ? place.aliases.join(", ") : normalizeText(place.aliases);
      return;
    }
    input.value = place[name] ?? "";
  });
}

function render() {
  buildCampusTabs();
  renderCanvas();
  renderPlacesList();
  renderForm();
  updateStatus();
}

function updateStatus(message) {
  const visible = getVisiblePlaces();
  const verified = getPlaces().filter(isVerified).length;
  const needsReview = getPlaces().length - verified;
  el.statusLeft.textContent = message || `${getMapMeta().label}：${visible.length} 个地点`;
  el.statusRight.textContent = `${state.dirty ? "有未保存更改 · " : ""}已核对 ${verified} / 待核对 ${needsReview}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function onPlacePointerDown(event) {
  event.preventDefault();
  event.stopPropagation();
  const box = event.currentTarget;
  const place = getPlaces().find((item) => item.id === box.dataset.id);
  if (!place) return;
  state.selectedId = place.id;
  const handle = event.target?.dataset?.handle || "";
  pushUndo();
  const start = pointerToMap(event);
  state.drag = {
    mode: handle ? "resize" : "move",
    handle,
    id: place.id,
    pointerId: event.pointerId,
    start,
    startRegion: getRegion(place),
  };
  el.stage.classList.add("dragging");
  box.setPointerCapture(event.pointerId);
  render();
}

function onStagePointerDown(event) {
  if (event.target !== el.stage && event.target !== el.mapImage && event.target !== el.canvas) return;
  event.preventDefault();
  const mapPoint = pointerToMap(event);
  const isInsideMap =
    mapPoint.x >= 0 && mapPoint.y >= 0 && mapPoint.x <= state.image.width && mapPoint.y <= state.image.height;
  if (event.target === el.mapImage && isInsideMap && !event.shiftKey) {
    addPlaceAt(mapPoint);
    return;
  }
  state.drag = {
    mode: "pan",
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startPanX: state.panX,
    startPanY: state.panY,
  };
  el.stage.classList.add("dragging");
  el.stage.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!state.drag) return;
  if (state.drag.mode === "pan") {
    state.panX = state.drag.startPanX + event.clientX - state.drag.startClientX;
    state.panY = state.drag.startPanY + event.clientY - state.drag.startClientY;
    updateTransform();
    return;
  }
  const place = getPlaces().find((item) => item.id === state.drag.id);
  if (!place) return;
  const point = pointerToMap(event);
  const dx = (point.x - state.drag.start.x) / state.image.width;
  const dy = (point.y - state.drag.start.y) / state.image.height;
  const start = state.drag.startRegion;
  let next = { ...start };
  if (state.drag.mode === "move") {
    next.x = start.x + dx;
    next.y = start.y + dy;
  } else {
    if (state.drag.handle.includes("w")) {
      next.x = start.x + dx;
      next.width = start.width - dx;
    }
    if (state.drag.handle.includes("e")) {
      next.width = start.width + dx;
    }
    if (state.drag.handle.includes("n")) {
      next.y = start.y + dy;
      next.height = start.height - dy;
    }
    if (state.drag.handle.includes("s")) {
      next.height = start.height + dy;
    }
  }
  setRegion(place, clampRegion(next));
  renderCanvas();
  renderForm();
}

function onPointerUp(event) {
  if (!state.drag) return;
  try {
    if (event.currentTarget.hasPointerCapture?.(state.drag.pointerId)) {
      event.currentTarget.releasePointerCapture(state.drag.pointerId);
    }
  } catch (_error) {
    // Ignore browser-specific pointer capture races.
  }
  state.drag = null;
  el.stage.classList.remove("dragging");
  render();
}

function onWheel(event) {
  event.preventDefault();
  const rect = el.stage.getBoundingClientRect();
  const before = {
    x: (event.clientX - rect.left - state.panX) / state.zoom,
    y: (event.clientY - rect.top - state.panY) / state.zoom,
  };
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  state.zoom = Math.max(0.2, Math.min(3.6, state.zoom * factor));
  state.panX = event.clientX - rect.left - before.x * state.zoom;
  state.panY = event.clientY - rect.top - before.y * state.zoom;
  updateTransform();
}

function zoomBy(delta) {
  state.zoom = Math.max(0.2, Math.min(3.6, state.zoom + delta));
  updateTransform();
}

function addPlaceAt(mapPoint) {
  pushUndo();
  const meta = getMapMeta();
  const now = new Date().toISOString().slice(0, 10);
  const idBase = `${state.mapKey}-place`;
  let suffix = 1;
  while (getPlaces().some((place) => place.id === `${idBase}-${suffix}`)) suffix += 1;
  const width = 0.08;
  const height = 0.06;
  const place = {
    id: `${idBase}-${suffix}`,
    campus: meta.campus,
    area: meta.area,
    name: "新地点",
    code: "",
    type: "teaching_building",
    aliases: [],
    description: "",
    mapAsset: meta.asset,
    mapRegion: clampRegion({
      x: mapPoint.x / state.image.width - width / 2,
      y: mapPoint.y / state.image.height - height / 2,
      width,
      height,
    }),
    confidence: 0,
    reviewStatus: "needs-review",
    verified: false,
    sourceId: "manual-campus-map-editor",
    updatedAt: now,
    neighbors: [],
  };
  getPlaces().push(place);
  state.selectedId = place.id;
  render();
}

function addPlaceFromButton() {
  addPlaceAt({
    x: state.image.width / 2,
    y: state.image.height / 2,
  });
}

function deleteSelected() {
  const place = getSelectedPlace();
  if (!place) return;
  if (!confirm(`删除地点「${place.name || place.id}」？`)) return;
  pushUndo();
  state.data.places = getPlaces().filter((item) => item.id !== place.id);
  state.selectedId = "";
  render();
}

function updateSelectedFromForm(event) {
  const place = getSelectedPlace();
  if (!place) return;
  pushUndo();
  const form = new FormData(el.form);
  fields.forEach((name) => {
    const value = normalizeText(form.get(name));
    if (["x", "y", "width", "height"].includes(name)) return;
    if (name === "aliases") {
      place.aliases = value
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
      return;
    }
    if (name === "verified") {
      place.verified = value === "true";
      place.reviewStatus = place.verified ? "verified" : "needs-review";
      return;
    }
    place[name] = value;
  });
  setRegion(
    place,
    clampRegion({
      x: Number(form.get("x")),
      y: Number(form.get("y")),
      width: Number(form.get("width")),
      height: Number(form.get("height")),
    })
  );
  const meta = getMapMeta();
  place.mapAsset = meta.asset;
  state.selectedId = place.id;
  state.dirty = true;
  render();
  if (event) event.preventDefault();
}

function setSelectedVerified(verified) {
  const place = getSelectedPlace();
  if (!place) return;
  pushUndo();
  place.verified = verified;
  place.reviewStatus = verified ? "verified" : "needs-review";
  place.updatedAt = new Date().toISOString().slice(0, 10);
  render();
}

function undo() {
  if (!state.undo.length) return;
  state.redo.push(cloneData(state.data));
  state.data = state.undo.pop();
  state.selectedId = "";
  state.dirty = true;
  render();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(cloneData(state.data));
  state.data = state.redo.pop();
  state.selectedId = "";
  state.dirty = true;
  render();
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false || payload.success === false) {
    const message = payload.errors?.join("\n") || payload.validation?.errors?.join("\n") || payload.error || payload.code || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function saveDraft() {
  updateSelectedFromForm();
  const payload = await fetchJson("/api/draft", {
    method: "POST",
    body: JSON.stringify(state.data),
  });
  state.dirty = false;
  render();
  showToast(`草稿已保存：${payload.path || payload.file}`);
}

async function validateData() {
  updateSelectedFromForm();
  const payload = await fetchJson("/api/validate", {
    method: "POST",
    body: JSON.stringify(state.data),
  });
  const validation = payload.validation || payload;
  if (!validation.ok) {
    throw new Error(validation.errors?.join("\n") || "校验失败");
  }
  showToast(`校验通过，共 ${getPlaces().length} 个地点`);
  return payload;
}

async function applyToMiniprogram() {
  updateSelectedFromForm();
  if (!confirm("发布到校园地图 published？保存前会自动创建备份，小程序和后台会读取同一份版本。")) return;
  const payload = await fetchJson("/api/apply", {
    method: "POST",
    body: JSON.stringify(state.data),
  });
  state.dirty = false;
  render();
  showToast(`已发布：${payload.publishedVersion || "-"}，备份：${payload.serviceBackupPath || payload.backupPath || "-"}`);
}

async function createBackup() {
  const payload = await fetchJson("/api/backup", { method: "POST" });
  showToast(`备份已生成：${payload.path || payload.file}`);
}

function exportJson() {
  updateSelectedFromForm();
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `campus-places-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function importJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || "{}"));
      if (!Array.isArray(data.places)) throw new Error("JSON 必须包含 places 数组");
      pushUndo();
      state.data = data;
      state.selectedId = "";
      state.dirty = true;
      render();
      showToast("JSON 已导入，应用前请先校验");
    } catch (error) {
      showToast(`导入失败：${error.message}`);
    }
  };
  reader.readAsText(file, "utf-8");
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 4200);
}

async function loadInitialData() {
  const payload = await fetchJson("/api/data");
  state.data = payload.draft?.data || payload.data;
  if (payload.draft) {
    state.dirty = true;
    showToast("已加载上次草稿");
  }
  render();
}

function bindEvents() {
  el.stage.addEventListener("pointerdown", onStagePointerDown);
  el.stage.addEventListener("pointermove", onPointerMove);
  el.stage.addEventListener("pointerup", onPointerUp);
  el.stage.addEventListener("pointercancel", onPointerUp);
  el.stage.addEventListener("wheel", onWheel, { passive: false });
  el.mapImage.addEventListener("load", () => {
    if (el.mapImage.naturalWidth && el.mapImage.naturalHeight) {
      state.image.naturalWidth = el.mapImage.naturalWidth;
      state.image.naturalHeight = el.mapImage.naturalHeight;
      state.image.height = Math.round((state.image.width * el.mapImage.naturalHeight) / el.mapImage.naturalWidth);
      el.mapImage.style.height = `${state.image.height}px`;
      fitMapIfNeeded();
      renderCanvas();
    }
  });
  el.form.addEventListener("submit", updateSelectedFromForm);
  document.getElementById("zoomIn").addEventListener("click", () => zoomBy(0.1));
  document.getElementById("zoomOut").addEventListener("click", () => zoomBy(-0.1));
  document.getElementById("fitMap").addEventListener("click", () => {
    state.zoom = 0;
    fitMapIfNeeded(true);
    updateTransform();
  });
  document.getElementById("addPlace").addEventListener("click", addPlaceFromButton);
  document.getElementById("deletePlace").addEventListener("click", deleteSelected);
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);
  document.getElementById("saveDraft").addEventListener("click", () => saveDraft().catch((error) => showToast(error.message)));
  document.getElementById("verifyPlace").addEventListener("click", () => setSelectedVerified(true));
  document.getElementById("unverifyPlace").addEventListener("click", () => setSelectedVerified(false));
  document.getElementById("exportJson").addEventListener("click", exportJson);
  document.getElementById("importJson").addEventListener("click", () => el.importFile.click());
  document.getElementById("applyData").addEventListener("click", () => applyToMiniprogram().catch((error) => showToast(error.message)));
  document.getElementById("downloadBackup").addEventListener("click", () => createBackup().catch((error) => showToast(error.message)));
  document.getElementById("validateData").addEventListener("click", () => validateData().catch((error) => showToast(error.message)));
  el.importFile.addEventListener("change", (event) => importJson(event.target.files?.[0]));
  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

bindEvents();
loadInitialData().catch((error) => showToast(`加载失败：${error.message}`));
