const blocks = require("./src/blocks");

module.exports = Object.freeze({
  UI_BLOCK_TYPES: blocks.UI_BLOCK_TYPES,
  normalizeUiBlocks: blocks.normalizeUiBlocks,
  blocksFromAgentResult: blocks.blocksFromAgentResult,
});
