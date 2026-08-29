/*
 * R48 Widget V3 — 轻量 JSON Schema 校验器（零依赖）
 * 仅支持本项目 schema 实际使用的关键词：
 *   type / enum / const / properties / required / additionalProperties /
 *   items / minItems / maxItems / minimum / maximum / anyOf / allOf / if-then
 * 用法：validateSchema(schema, data) -> string[]（空数组表示通过）
 */
"use strict";

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(schemaType, value) {
  if (schemaType === "number") return typeof value === "number";
  if (schemaType === "integer") return Number.isInteger(value);
  return typeOf(value) === schemaType;
}

function validate(schema, data, path, errors) {
  if (!schema || typeof schema !== "object") return;

  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`);
    return;
  }
  if (schema.enum !== undefined && !schema.enum.some((item) => item === data)) {
    errors.push(`${path}: value ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`);
    return;
  }
  if (schema.type !== undefined) {
    if (Array.isArray(schema.type)) {
      if (!schema.type.some((t) => matchesType(t, data))) {
        errors.push(`${path}: expected type ${schema.type.join("/")}, got ${typeOf(data)}`);
        return;
      }
    } else if (!matchesType(schema.type, data)) {
      errors.push(`${path}: expected type ${schema.type}, got ${typeOf(data)}`);
      return;
    }
  }

  if (schema.anyOf !== undefined) {
    const anyErrors = [];
    const ok = schema.anyOf.some((sub) => {
      const local = [];
      validate(sub, data, path, local);
      if (local.length === 0) return true;
      anyErrors.push(...local);
      return false;
    });
    if (!ok) {
      errors.push(`${path}: failed anyOf -> ${anyErrors[0]}`);
      return;
    }
  }

  if (schema.allOf !== undefined) {
    for (const sub of schema.allOf) {
      validate(sub, data, path, errors);
    }
  }

  if (schema.if !== undefined) {
    const ifErrors = [];
    validate(schema.if, data, path, ifErrors);
    if (ifErrors.length === 0 && schema.then !== undefined) {
      validate(schema.then, data, path, errors);
    } else if (ifErrors.length > 0 && schema.else !== undefined) {
      validate(schema.else, data, path, errors);
    }
  }

  if (schema.minimum !== undefined && typeof data === "number" && data < schema.minimum) {
    errors.push(`${path}: ${data} < minimum ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && typeof data === "number" && data > schema.maximum) {
    errors.push(`${path}: ${data} > maximum ${schema.maximum}`);
  }
  if (schema.minItems !== undefined && Array.isArray(data) && data.length < schema.minItems) {
    errors.push(`${path}: length ${data.length} < minItems ${schema.minItems}`);
  }
  if (schema.maxItems !== undefined && Array.isArray(data) && data.length > schema.maxItems) {
    errors.push(`${path}: length ${data.length} > maxItems ${schema.maxItems}`);
  }

  if (schema.properties !== undefined && data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of Object.keys(schema.properties)) {
      if (data[key] !== undefined) {
        validate(schema.properties[key], data[key], `${path}.${key}`, errors);
      }
    }
  }

  if (schema.required !== undefined && data && typeof data === "object" && !Array.isArray(data)) {
    for (const key of schema.required) {
      if (data[key] === undefined) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
  }

  if (schema.additionalProperties !== undefined && data && typeof data === "object" && !Array.isArray(data)) {
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(data)) {
        if (!schema.properties || schema.properties[key] === undefined) {
          errors.push(`${path}: unexpected property "${key}" (additionalProperties=false)`);
        }
      }
    } else if (typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(data)) {
        if (!schema.properties || schema.properties[key] === undefined) {
          validate(schema.additionalProperties, data[key], `${path}.${key}`, errors);
        }
      }
    }
  }

  if (schema.items !== undefined && Array.isArray(data)) {
    for (let i = 0; i < data.length; i += 1) {
      validate(schema.items, data[i], `${path}[${i}]`, errors);
    }
  }
}

function validateSchema(schema, data) {
  const errors = [];
  validate(schema, data, "$", errors);
  return errors;
}

module.exports = { validateSchema };