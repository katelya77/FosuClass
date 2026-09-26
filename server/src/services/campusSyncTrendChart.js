const SERIES = [
  { key: "attempts", label: "请求量", color: "var(--text-primary, #1d4e89)", dash: "" },
  { key: "success", label: "成功", color: "#14795a", dash: "" },
  { key: "systemFailures", label: "系统失败", color: "#b42318", dash: "5 3" },
  { key: "credentialFailures", label: "凭证失败", color: "#9a5d08", dash: "2 2" },
  { key: "schoolChallenges", label: "学校验证", color: "#7a4d1f", dash: "4 2" },
  { key: "rateLimited", label: "限流", color: "#3b6ea5", dash: "6 2 2 2" },
];

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseBucket(value) {
  const text = String(value || "");
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(text)) return new Date(text + ":00:00.000Z");
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shanghaiParts(date) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date).forEach((part) => {
    parts[part.type] = part.value;
  });
  const weekday = { Sun: "日", Mon: "一", Tue: "二", Wed: "三", Thu: "四", Fri: "五", Sat: "六" }[parts.weekday] || "";
  return {
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    weekday: weekday,
  };
}

function formatAxisLabel(date, range) {
  const parts = shanghaiParts(date);
  if (range === "1h" || range === "24h") return parts.hour + ":" + parts.minute;
  if (range === "7d") return "周" + parts.weekday + " " + parts.month + "-" + parts.day;
  return parts.month + "-" + parts.day;
}

function formatTooltipTime(date) {
  const item = shanghaiParts(date);
  const year = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric" }).format(date);
  return year + "-" + item.month + "-" + item.day + " " + item.hour + ":" + item.minute;
}

function niceYTicks(maxValue) {
  const max = Math.max(0, Math.floor(Number(maxValue) || 0));
  if (max <= 0) return [0, 1];
  if (max <= 5) {
    const ticks = [];
    for (let value = 0; value <= max; value += 1) ticks.push(value);
    return ticks;
  }
  const rough = max / 4;
  const power = Math.pow(10, Math.floor(Math.log10(rough)));
  const error = rough / power;
  const nice = error <= 1 ? 1 : error <= 2 ? 2 : error <= 5 ? 5 : 10;
  const step = nice * power;
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  if (ticks.length < 3) ticks.push(top + step);
  return ticks;
}

function thinIndexes(count, limit) {
  if (count <= 1) return [0];
  const maxLabels = Math.max(2, limit);
  if (count <= maxLabels) {
    const all = [];
    for (let index = 0; index < count; index += 1) all.push(index);
    return all;
  }
  const indexes = [0];
  const inner = maxLabels - 2;
  for (let step = 1; step <= inner; step += 1) {
    indexes.push(Math.round((step * (count - 1)) / (inner + 1)));
  }
  indexes.push(count - 1);
  return Array.from(new Set(indexes)).sort((left, right) => left - right);
}

function numberValue(row, key) {
  const value = Number(row && row[key]);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function buildCampusSyncTrend(points, range) {
  const rows = Array.isArray(points) ? points : [];
  const width = 720;
  const height = 260;
  const plot = { left: 56, right: 16, top: 18, bottom: 42 };
  if (!rows.length) {
    return {
      empty: true,
      message: "当前时间范围暂无同步请求",
      viewBox: "0 0 " + width + " " + height,
      yTicks: [],
      xLabels: [],
      legend: [],
      points: [],
      svg: "",
    };
  }
  const present = SERIES.filter((series) => rows.some((row) => row && Object.prototype.hasOwnProperty.call(row, series.key)));
  let max = 0;
  rows.forEach((row) => {
    present.forEach((series) => {
      max = Math.max(max, numberValue(row, series.key));
    });
  });
  const yTicks = niceYTicks(max);
  const yMax = yTicks[yTicks.length - 1] || 1;
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const coords = rows.map((row, index) => {
    const date = parseBucket(row.bucket || row.t || row.key);
    const x = rows.length === 1 ? plot.left + plotWidth / 2 : plot.left + (index * plotWidth / (rows.length - 1));
    return { index: index, x: x, date: date, row: row };
  });
  function yAt(value) {
    return plot.top + plotHeight - (Math.max(0, value) / yMax) * plotHeight;
  }
  const labelLimit = range === "30d" ? 6 : range === "24h" ? 8 : range === "7d" ? 7 : 5;
  const xLabels = thinIndexes(rows.length, labelLimit).map((index) => {
    const item = coords[index];
    return {
      x: item.x,
      text: item.date ? formatAxisLabel(item.date, range || "24h") : "",
      anchor: index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle",
    };
  });
  const tooltipPoints = coords.map((item) => {
    const values = {};
    present.forEach((series) => {
      values[series.key] = numberValue(item.row, series.key);
    });
    return {
      index: item.index,
      x: Math.round(item.x * 10) / 10,
      time: item.date ? formatTooltipTime(item.date) : "",
      values: values,
    };
  });
  let svg = "";
  yTicks.forEach((tick) => {
    const y = yAt(tick);
    svg += "<line x1='" + plot.left + "' y1='" + y.toFixed(1) + "' x2='" + (width - plot.right) + "' y2='" + y.toFixed(1) + "' stroke='var(--border, #d7deea)' stroke-width='1'/>";
    svg += "<text x='" + (plot.left - 8) + "' y='" + (y + 4).toFixed(1) + "' text-anchor='end' font-size='11' fill='var(--text-muted, #667085)'>" + tick + "</text>";
  });
  svg += "<text x='14' y='14' font-size='11' fill='var(--text-muted, #667085)'>请求数</text>";
  xLabels.forEach((label) => {
    if (!label.text) return;
    svg += "<text x='" + label.x.toFixed(1) + "' y='" + (height - 16) + "' text-anchor='" + label.anchor + "' font-size='11' fill='var(--text-muted, #667085)'>" + esc(label.text) + "</text>";
  });
  present.forEach((series) => {
    const commands = coords.map((item, index) => {
      const y = yAt(numberValue(item.row, series.key));
      return (index ? "L" : "M") + item.x.toFixed(1) + " " + y.toFixed(1);
    }).join(" ");
    if (rows.length > 1) {
      svg += "<path d='" + commands + "' fill='none' stroke='" + series.color + "' stroke-width='1.75' stroke-dasharray='" + series.dash + "'/>";
    }
    coords.forEach((item) => {
      const y = yAt(numberValue(item.row, series.key));
      svg += "<circle cx='" + item.x.toFixed(1) + "' cy='" + y.toFixed(1) + "' r='3.5' fill='" + series.color + "'/>";
    });
  });
  coords.forEach((item) => {
    svg += "<circle class='cs-hit' data-i='" + item.index + "' cx='" + item.x.toFixed(1) + "' cy='" + (plot.top + plotHeight / 2).toFixed(1) + "' r='10' fill='transparent'/>";
  });
  return {
    empty: false,
    message: "",
    viewBox: "0 0 " + width + " " + height,
    yTicks: yTicks,
    xLabels: xLabels,
    legend: present.map((series) => ({ key: series.key, label: series.label, color: series.color, dash: series.dash })),
    points: tooltipPoints,
    svg: svg,
  };
}

module.exports = {
  SERIES: SERIES,
  buildCampusSyncTrend: buildCampusSyncTrend,
  formatAxisLabel: formatAxisLabel,
  niceYTicks: niceYTicks,
  parseBucket: parseBucket,
};
