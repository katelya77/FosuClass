/**
 * Geometry helpers for 小佛助手 layout measurements (selectorQuery results).
 * Pure functions — unit-testable without WeChat runtime.
 * Prefer real DevTools boundingClientRect snapshots as test inputs.
 */

/**
 * @param {{left:number,width:number}} capsule
 * @param {{left:number,width:number}} wrap
 * @returns {{leftGap:number,rightGap:number,absDiff:number,centered:boolean,fullWidth:boolean}}
 */
function measureStatusIslandGaps(capsule, wrap) {
  const wrapLeft = Number(wrap && wrap.left) || 0;
  const wrapWidth = Number(wrap && wrap.width) || 0;
  const capLeft = Number(capsule && capsule.left) || 0;
  const capWidth = Number(capsule && capsule.width) || 0;
  const leftGap = capLeft - wrapLeft;
  const rightGap = wrapLeft + wrapWidth - (capLeft + capWidth);
  const absDiff = Math.abs(leftGap - rightGap);
  // Full-width long capsule: left/right gaps near 0 and width ≈ wrap
  const widthRatio = wrapWidth > 0 ? capWidth / wrapWidth : 0;
  return {
    leftGap,
    rightGap,
    absDiff,
    widthRatio,
    fullWidth: widthRatio >= 0.96,
    // Product: left/right margin diff ≤ 4rpx (≈2px @0.5)
    centered: absDiff <= 2 || absDiff <= 4,
  };
}

/**
 * @param {object} m measurements in px (or rpx-consistent units)
 * Product: composerTop − lastContentBottom ∈ 12–24rpx (≈6–12px @0.5 px/rpx)
 */
function measureComposerMessageGaps(m = {}) {
  const scrollViewBottom = Number(m.scrollViewBottom);
  const composerTop = Number(m.composerTop);
  const lastMessageBottom = Number(m.lastMessageBottom);
  const gapScrollToComposer = Number.isFinite(scrollViewBottom) && Number.isFinite(composerTop)
    ? composerTop - scrollViewBottom
    : null;
  const gapMessageToComposer = Number.isFinite(composerTop) && Number.isFinite(lastMessageBottom)
    ? composerTop - lastMessageBottom
    : null;
  const minPx = rpxToPx(12, m.pxPerRpx || 0.5);
  const maxPx = rpxToPx(24, m.pxPerRpx || 0.5);
  return {
    gapScrollToComposer,
    gapMessageToComposer,
    minPx,
    maxPx,
    scrollComposerOk: gapScrollToComposer != null && gapScrollToComposer >= 0 && gapScrollToComposer <= maxPx + 8,
    messageComposerOk: gapMessageToComposer != null
      && gapMessageToComposer >= minPx - 2
      && gapMessageToComposer <= maxPx + 4,
  };
}

/**
 * Compute message-scroll padding-bottom from measured composer height (px).
 * Single source of inset — no dual fixed spacers.
 */
function computeComposerInsetPx(composerHeightPx, extraGapPx = 8) {
  const h = Math.ceil(Number(composerHeightPx) || 0);
  if (h <= 0) return 120;
  return h + Math.max(0, Number(extraGapPx) || 0);
}

/**
 * Convert rpx gap bounds with a px-per-rpx factor.
 * Default factor 0.5 approximates 375px-wide devices (750rpx design).
 */
function rpxToPx(rpx, pxPerRpx = 0.5) {
  return Number(rpx) * Number(pxPerRpx);
}

function assertStatusCentered(gaps, maxDiffRpx = 4, pxPerRpx = 0.5) {
  const maxDiffPx = rpxToPx(maxDiffRpx, pxPerRpx);
  return Boolean(gaps && gaps.absDiff <= maxDiffPx);
}

function assertCollapsedExpandedSameWidth(collapsed, expanded, tolerancePx = 2) {
  const w1 = Number(collapsed && collapsed.width) || 0;
  const w2 = Number(expanded && expanded.width) || 0;
  return Math.abs(w1 - w2) <= tolerancePx;
}

module.exports = {
  measureStatusIslandGaps,
  measureComposerMessageGaps,
  computeComposerInsetPx,
  rpxToPx,
  assertStatusCentered,
  assertCollapsedExpandedSameWidth,
};
