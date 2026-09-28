const fs = require("fs");
const path = require("path");

const banned = ["CAMPUS_AGENT_TOKEN", "CAMPUS_AGENT_SIGNING_SECRET", "FULL_SYNC_AGENT_TOKEN", "FULL_SYNC_SIGNING_SECRET", "ADMIN_API_TOKEN"];
const roots = ["miniprogram", "dist"].map((name) => path.join(__dirname, "..", name)).filter((dir) => fs.existsSync(dir));
const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      walk(full);
      continue;
    }
    if (!/\.(js|json|wxml|wxss|ts)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    banned.forEach((name) => {
      if (text.includes(name)) hits.push(path.relative(path.join(__dirname, ".."), full) + ":" + name);
    });
  }
}

roots.forEach(walk);
if (hits.length) {
  console.error(hits.join("\n"));
  process.exit(1);
}
console.log("client-secrets-absent PASS");
