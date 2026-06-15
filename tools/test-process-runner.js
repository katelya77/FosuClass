const assert = require("assert");
const path = require("path");

const {
  resolveCommand,
  runCommand,
  runProcess,
} = require("./shared/processRunner");

function mockFs(existingFile) {
  return {
    existsSync(filePath) {
      return String(filePath) === String(existingFile);
    },
    statSync(filePath) {
      assert.strictEqual(String(filePath), String(existingFile));
      return { isFile: () => true };
    },
  };
}

function run() {
  const npmCli = "C:\\Users\\Katelya\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js";
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const cwd = "C:\\Users\\Katelya\\Documents\\VScode\\中文 Project";

  const execpathPlan = resolveCommand("npm", ["--version"], {
    env: { npm_execpath: npmCli },
  }, {
    platform: "win32",
    execPath,
    fs: mockFs(npmCli),
  });
  assert.strictEqual(execpathPlan.file, execPath);
  assert.deepStrictEqual(execpathPlan.args, [npmCli, "--version"]);
  assert.strictEqual(execpathPlan.invocation, "npm_execpath");

  const fallbackPlan = resolveCommand("npm", ["run", "sync:publish", "--", "--term", "2025-2026-2"], {
    env: { npm_execpath: "" },
  }, {
    platform: "win32",
    execPath,
  });
  assert.strictEqual(path.basename(fallbackPlan.file).toLowerCase(), "cmd.exe");
  assert.deepStrictEqual(fallbackPlan.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert(fallbackPlan.args[3].includes("call npm.cmd"), "Windows fallback must call npm.cmd through cmd.exe");

  const warning = runProcess("npm", ["--version"], {
    cwd,
    env: { npm_execpath: npmCli },
  }, {
    platform: "win32",
    execPath,
    fs: mockFs(npmCli),
    spawnSync(file, args, options) {
      assert.strictEqual(file, execPath);
      assert.deepStrictEqual(args, [npmCli, "--version"]);
      assert.strictEqual(options.cwd, cwd);
      return {
        status: 0,
        stdout: "11.12.1\n",
        stderr: "npm warn Unknown user config \"electron_mirror\"\n",
      };
    },
  });
  assert.strictEqual(warning.ok, true);
  assert.strictEqual(warning.status, 0);
  assert(warning.stderrTail.includes("electron_mirror"));

  assert.throws(() => runCommand("npm", ["--version"], {
    cwd,
    env: { npm_execpath: "" },
  }, {
    platform: "win32",
    execPath,
    spawnSync() {
      return {
        status: null,
        error: Object.assign(new Error("spawn npm.cmd ENOENT"), { code: "ENOENT" }),
        stdout: "",
        stderr: "",
      };
    },
  }), (error) => {
    assert.strictEqual(error.status, null);
    assert.strictEqual(error.originalError.code, "ENOENT");
    assert.strictEqual(error.diagnostics.spawnErrorCode, "ENOENT");
    assert(error.message.includes("status=null"));
    assert(error.message.includes("spawn=ENOENT"));
    return true;
  });

  const spaced = runProcess("npm", ["run", "sync:publish", "--", "--note", "path has spaces"], {
    cwd,
    env: { npm_execpath: "" },
  }, {
    platform: "win32",
    execPath,
    spawnSync(file, args, options) {
      assert.strictEqual(options.cwd, cwd);
      assert(args[3].includes("\"path has spaces\""));
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.strictEqual(spaced.ok, true);

  const redacted = runProcess("node", ["script.js", "--ticket=abc123", "--admin-token", "secret-value", "Bearer abc.def"], {}, {
    execPath,
    spawnSync() {
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert(redacted.safeArgs.includes("--ticket=[redacted]"));
  const tokenIndex = redacted.safeArgs.indexOf("--admin-token");
  assert.strictEqual(redacted.safeArgs[tokenIndex + 1], "[redacted]");
  assert(redacted.safeArgs.some((arg) => arg.includes("Bearer [redacted]")));

  console.log("test-process-runner passed");
}

run();
