const samples = [];

function record(sample) {
  samples.push({
    route: String(sample.route || "").slice(0, 40),
    durationMs: Math.max(0, Math.round(Number(sample.durationMs) || 0)),
    cacheHit: sample.cacheHit === true,
    range: String(sample.range || "").slice(0, 8),
    filesRead: Math.max(0, Number(sample.filesRead) || 0),
    at: Date.now(),
  });
  if (samples.length > 200) samples.shift();
}

function snapshot() {
  return samples.slice();
}

module.exports = { record, snapshot };
