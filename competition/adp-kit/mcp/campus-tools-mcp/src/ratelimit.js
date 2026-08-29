/**
 * 简单令牌桶限流器：按客户端 IP 维度限流，防止比赛演示服务被打爆。
 * 环境变量：
 *   RATE_LIMIT_RPM   每分钟允许的请求数（默认 120）
 *   RATE_LIMIT_BURST 瞬时突发容量（默认 30）
 */

const RPM = Number(process.env.RATE_LIMIT_RPM || 120);
const BURST = Number(process.env.RATE_LIMIT_BURST || 30);

const buckets = new Map(); // key -> { tokens, last }

function takeToken(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: BURST, last: now };
    buckets.set(key, b);
  }
  // 按时间补充令牌
  const refill = ((now - b.last) / 60000) * RPM;
  if (refill > 0) {
    b.tokens = Math.min(BURST, b.tokens + refill);
    b.last = now;
  }
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}

// 定期清理空闲桶，避免内存膨胀
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (now - b.last > 10 * 60 * 1000) buckets.delete(k);
  }
}, 60 * 1000).unref();

module.exports = { takeToken };
