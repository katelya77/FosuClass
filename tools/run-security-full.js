const { spawnSync } = require("child_process");

const commands = [
  ["node", ["--check", "miniprogram/utils/request.js"]],
  ["node", ["--check", "miniprogram/services/securitySessionService.js"]],
  ["node", ["--check", "miniprogram/services/staticAccessService.js"]],
  ["node", ["--check", "miniprogram/services/clientSecurityCheckService.js"]],
  ["node", ["--check", "miniprogram/utils/trustedUrl.js"]],
  ["node", ["--check", "server/src/services/securityModeService.js"]],
  ["node", ["--check", "server/src/services/securityEventService.js"]],
  ["node", ["--check", "server/src/services/clientCheckService.js"]],
  ["node", ["--check", "server/src/routes/fosu.js"]],
  ["node", ["--check", "server/src/routes/admin.js"]],
  ["node", ["--check", "server/src/security/routeSecurityPolicy.js"]],
  ["node", ["--check", "server/scripts/security-postdeploy-check.js"]],
  ["node", ["tools/test-miniprogram-url-compatibility.js"]],
  ["node", ["tools/test-miniprogram-session-security.js"]],
  ["node", ["tools/test-raw-wx-request-whitelist.js"]],
  ["node", ["tools/test-miniprogram-build-entry.js"]],
  ["node", ["tools/test-security-client-check.js"]],
  ["node", ["tools/test-api-security.js"]],
  ["node", ["tools/test-route-security-policy.js"]],
  ["node", ["tools/test-static-ticket.js"]],
  ["node", ["tools/test-security-mode.js"]],
  ["node", ["tools/test-admin-auth-modes.js"]],
  ["node", ["tools/test-deploy-static-env-contract.js"]],
  ["node", ["tools/test-logs-mask-sensitive-values.js"]],
  ["node", ["tools/test-openresty-status-schema.js"]],
  ["node", ["tools/test-openresty-security-config.js"]],
  ["git", ["diff", "--check"]],
];

for (const [command, args] of commands) {
  const label = [command].concat(args).join(" ");
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`security-full failed at: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log("\ntest:security-full passed");
