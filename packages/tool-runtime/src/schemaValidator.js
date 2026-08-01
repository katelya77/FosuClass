function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function validateType(value, expected) {
  if (!expected) return true;
  const allowed = Array.isArray(expected) ? expected : [expected];
  const actual = valueType(value);
  return allowed.some((item) => item === actual || item === "number" && (actual === "number" || actual === "integer"));
}

function validateAgainstSchema(value, schema = {}, path = "$", errors = []) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return errors;
  if (!validateType(value, schema.type)) {
    errors.push({ path, code: "TYPE", expected: schema.type, actual: valueType(value) });
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push({ path, code: "ENUM" });
  }
  if (typeof value === "string") {
    if (Number.isFinite(schema.minLength) && value.length < schema.minLength) errors.push({ path, code: "MIN_LENGTH" });
    if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) errors.push({ path, code: "MAX_LENGTH" });
    if (schema.pattern) {
      try {
        if (!(new RegExp(schema.pattern)).test(value)) errors.push({ path, code: "PATTERN" });
      } catch (error) {
        errors.push({ path, code: "SCHEMA_PATTERN_INVALID" });
      }
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isFinite(schema.minimum) && value < schema.minimum) errors.push({ path, code: "MINIMUM" });
    if (Number.isFinite(schema.maximum) && value > schema.maximum) errors.push({ path, code: "MAXIMUM" });
  }
  if (Array.isArray(value)) {
    if (Number.isFinite(schema.minItems) && value.length < schema.minItems) errors.push({ path, code: "MIN_ITEMS" });
    if (Number.isFinite(schema.maxItems) && value.length > schema.maxItems) errors.push({ path, code: "MAX_ITEMS" });
    if (schema.items) value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${path}[${index}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    (Array.isArray(schema.required) ? schema.required : []).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push({ path: `${path}.${key}`, code: "REQUIRED" });
    });
    Object.entries(value).forEach(([key, item]) => {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateAgainstSchema(item, properties[key], `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push({ path: `${path}.${key}`, code: "ADDITIONAL_PROPERTY" });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateAgainstSchema(item, schema.additionalProperties, `${path}.${key}`, errors);
      }
    });
  }
  return errors;
}

module.exports = {
  validateAgainstSchema,
};
