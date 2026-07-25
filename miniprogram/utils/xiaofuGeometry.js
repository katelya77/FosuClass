/**
 * Geometry helpers for 小佛助手 layout measurements (selectorQuery results).
 * Pure functions — unit-testable without WeChat runtime.
 */

/**
 * @param {{left:number,width:number}} capsule
 * @param {{left:number,width:number}} wrap
 * @returns {{leftGap:number,rightGap:number,absDiff:number,centered:boolean}}
 */
function measureStatusIslandGaps(capsule, wrap) {
  const wrapLeft = Number(wrap && wrap.left) || 0;
  const wrapWidth = Number(wrap && wrap.width) || 0;
  const capLeft = Number(capsule && capsule.left) || 0;
  const capWidth = Number(capsule && capsule.width) || 0;
  const leftGap = capLeft - wrapLeft;
  const rightGap = wrapLeft + wrapWidth - (capLeft + capWidth);
  const absDiff = Math.abs(leftGap - rightGap);
  return {
    leftGap,
    rightGap,
    absDiff,
    centered: absDiff <= 8,
  };
}

/**
 * @param {object} m measurements in px (or rpx-consistent units)
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
  return {
    gapScrollToComposer,
    gapMessageToComposer,
    scrollComposerOk: gapScrollToComposer != null && gapScrollToComposer >= 4 && gapScrollToComposer <= 24,
    messageComposerOk: gapMessageToComposer != null && gapMessageToComposer >= 6 && gapMessageToComposer <= 48,
  };
}

/**
 * Convert rpx gap bounds used in product spec (8–16rpx, 12–32rpx) with a px-per-rpx factor.
 * Default factor 0.5 approximates 375px-wide devices (750rpx design).
 */
function rpxToPx(rpx, pxPerRpx = 0.5) {
  return Number(rpx) * Number(pxPerRpx);
}

function assertStatusCentered(gaps, maxDiffRpx = 8, pxPerRpx = 0.5) {
  const maxDiffPx = rpxToPx(maxDiffRpx, pxPerRpx);
  return Boolean(gaps && gaps.absDiff <= maxDiffPx);
}

module.exports = {
  measureStatusIslandGaps,
  measureComposerMessageGaps,
  rpxToPx,
  assertStatusCentered,
};
