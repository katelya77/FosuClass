#!/usr/bin/env node
/**
 * AI assistant UI: composer spacing, status tokens, modalOpen scroll lock.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const wxss = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxss"), "utf8");
const wxml = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.wxml"), "utf8");
const pageJs = fs.readFileSync(path.join(root, "miniprogram/packageXiaofu/pages/ai-assistant/ai-assistant.js"), "utf8");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log("PASS " + name); }
  else { fail += 1; console.log("FAIL " + name + (extra ? " :: " + extra : "")); }
}

// No double padding 200rpx
const pageBlock = (wxss.match(/\.ai-page\s*\{[\s\S]*?\n\}/) || [""])[0];
check("ai-page no padding-bottom 200rpx", !/padding-bottom:\s*200rpx/.test(pageBlock) && !/padding:[^;]*200rpx/.test(pageBlock), pageBlock.slice(0, 200));
check("ai-page flex column", /display:\s*flex/.test(pageBlock) && /flex-direction:\s*column/.test(pageBlock));

// message-scroll flex 1 min-height 0
const scrollBlock = (wxss.match(/\.message-scroll\s*\{[\s\S]*?\n\}/) || [""])[0];
check("message-scroll flex grow", /flex:\s*1/.test(scrollBlock));
check("message-scroll min-height 0", /min-height:\s*0/.test(scrollBlock));

// composer not fixed
const composerBlock = (wxss.match(/\.composer\s*\{[\s\S]*?\n\}/) || [""])[0];
check("composer not position fixed", !/position:\s*fixed/.test(composerBlock));
check("composer flex-shrink 0", /flex:\s*0\s+0\s+auto/.test(composerBlock) || /flex-shrink:\s*0/.test(composerBlock));

// status tokens
check("status text strong token", /agent-status-text[\s\S]{0,120}--xf-text-strong/.test(wxss));
check("status detail secondary token", /agent-status-detail[\s\S]{0,120}--xf-text-secondary/.test(wxss));
check("status chevron faint token", /agent-status-chevron[\s\S]{0,120}--xf-text-faint/.test(wxss));
check("no white detail on light", !/agent-status-detail[\s\S]{0,80}rgba\(255,\s*255,\s*255/.test(wxss));

// modal / scroll lock
check("scroll-y gated by sheets", /scroll-y="\{\{!\(showTaskPanel/.test(wxml) || /scroll-y="\{\{!modalOpen\}\}"/.test(wxml));
check("mask catchtap", /catchtap="closeSheets"/.test(wxml));
check("mask catchtouchmove", /catchtouchmove="preventScrollPassThrough"/.test(wxml));
check("preventScrollPassThrough handler", /preventScrollPassThrough\s*\(/.test(pageJs));
check("computeModalOpen / withModalOpen", /computeModalOpen|withModalOpen|SHEET_MODAL_FLAGS/.test(pageJs));

console.log("--- pass=" + pass + " fail=" + fail);
process.exit(fail ? 1 : 0);
