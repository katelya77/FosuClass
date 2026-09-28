const fs = require("fs");

const file = process.argv[2];
const text = fs.readFileSync(file, "utf8");

function read(key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1] : "";
}

const enabled = read("CAMPUS_AGENT_ENABLED");
if (enabled !== "true") {
  process.exit(0);
}

const token = read("CAMPUS_AGENT_TOKEN");
const secret = read("CAMPUS_AGENT_SIGNING_SECRET");
if (!token || !secret || token === secret || token.length < 32 || secret.length < 32) {
  console.error("campus agent token and signing secret must both be non-empty and different");
  fs.unlinkSync(file);
  process.exit(1);
}
