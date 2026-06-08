async function generate() {
  if (!process.env.COZE_API_BASE_URL || !process.env.COZE_API_KEY || !process.env.COZE_BOT_ID) {
    const error = new Error("Coze provider is not configured.");
    error.code = "NOT_CONFIGURED";
    throw error;
  }
  const error = new Error("Coze provider adapter is reserved for deployment integration.");
  error.code = "COZE_ADAPTER_NOT_IMPLEMENTED";
  throw error;
}

module.exports = {
  generate,
  name: "coze",
};
