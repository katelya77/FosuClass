"use strict";

const { validateCanonicalEvent } = require("../validator");

/**
 * 数据枢纽适配器基类。所有适配器必须：
 * - 暴露 id（provider 家族契约）；
 * - validateInput 预检输入形状；
 * - adapt 对无法处理的输入 fail-closed（返回 { ok:false, errors:[...] }），
 *   绝不静默产出部分数据；
 * - 产出事件全部经过 validateCanonicalEvent（anonymous 语义）。
 */
class BaseAdapter {
  constructor({ id, name, capabilities = {} }) {
    if (!id || typeof id !== "string") throw new Error("BaseAdapter 必须提供 id");
    this.id = id;
    this.name = name || id;
    this.capabilities = capabilities;
  }

  validateInput(_input) {
    return { ok: true };
  }

  adapt(_input) {
    return { ok: false, errors: ["not implemented"] };
  }

  validateEvents(events) {
    const errors = [];
    for (const event of events) {
      const check = validateCanonicalEvent(event);
      if (!check.ok) errors.push(...check.errors.map((e) => `event「${event && event.course && event.course.name}」: ${e}`));
    }
    return errors;
  }

  normalizeEvents(events) {
    const errors = this.validateEvents(events);
    if (errors.length > 0) return { ok: false, errors };
    return { ok: true, events };
  }
}

module.exports = { BaseAdapter };