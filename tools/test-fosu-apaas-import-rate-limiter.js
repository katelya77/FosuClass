const assert = require("assert");

const {
  __resetForTest,
  assertImportAttemptAllowed,
  recordImportFailure,
  recordImportCredentialFailure,
} = require("../server/src/services/fosuApaasImportRateLimiter");

function withRateLimitEnv(fn) {
  const oldEnabled = process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
  const oldIpLimit = process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M;
  const oldNetworkCooldown = process.env.FOSU_IMPORT_NETWORK_COOLDOWN_SECONDS;
  process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = "true";
  process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M = "100";
  process.env.FOSU_IMPORT_NETWORK_COOLDOWN_SECONDS = "60";
  try {
    fn();
  } finally {
    if (oldEnabled == null) delete process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
    else process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = oldEnabled;
    if (oldIpLimit == null) delete process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M;
    else process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M = oldIpLimit;
    if (oldNetworkCooldown == null) delete process.env.FOSU_IMPORT_NETWORK_COOLDOWN_SECONDS;
    else process.env.FOSU_IMPORT_NETWORK_COOLDOWN_SECONDS = oldNetworkCooldown;
    __resetForTest();
  }
}

function run() {
  withRateLimitEnv(() => {
    __resetForTest();
    for (let index = 0; index < 6; index += 1) {
      assertImportAttemptAllowed({
        userKey: "user-a",
        studentId: "202512340303",
        ip: `127.0.0.${index}`,
      });
    }
  });

  withRateLimitEnv(() => {
    __resetForTest();
    for (let index = 0; index < 3; index += 1) {
      assertImportAttemptAllowed({
        userKey: "user-b",
        studentId: "202512340404",
        ip: `127.0.1.${index}`,
      });
      recordImportCredentialFailure({
        userKey: "user-b",
        studentId: "202512340404",
        ip: `127.0.1.${index}`,
      });
    }
    assert.throws(
      () => assertImportAttemptAllowed({
        userKey: "user-b",
        studentId: "202512340404",
        ip: "127.0.1.9",
      }),
      (error) => error && error.code === "IMPORT_RATE_LIMITED"
    );
  });

  withRateLimitEnv(() => {
    __resetForTest();
    const identity = {
      userKey: "user-network",
      studentId: "202512340505",
      ip: "127.0.2.1",
    };
    assertImportAttemptAllowed(identity);
    recordImportFailure(identity, "NETWORK_TIMEOUT");
    assertImportAttemptAllowed(Object.assign({}, identity, { ip: "127.0.2.2" }));
    recordImportFailure(identity, "SCHOOL_SYSTEM_TIMEOUT");
    assert.throws(
      () => assertImportAttemptAllowed(Object.assign({}, identity, { ip: "127.0.2.3" })),
      (error) => error && error.code === "IMPORT_RATE_LIMITED" && error.kind === "network" && error.retryAfterSeconds <= 60
    );
  });

  withRateLimitEnv(() => {
    __resetForTest();
    const identity = {
      userKey: "user-network-not-auth",
      studentId: "202512340606",
      ip: "127.0.3.1",
    };
    recordImportFailure(identity, "NETWORK_TIMEOUT");
    recordImportFailure(identity, "NETWORK_TIMEOUT");
    __resetForTest();
    for (let index = 0; index < 3; index += 1) {
      assertImportAttemptAllowed(Object.assign({}, identity, { ip: `127.0.4.${index}` }));
      recordImportCredentialFailure(identity);
    }
    assert.throws(
      () => assertImportAttemptAllowed(Object.assign({}, identity, { ip: "127.0.4.9" })),
      (error) => error && error.code === "IMPORT_RATE_LIMITED" && error.kind === "credential" && error.retryAfterSeconds > 60
    );
  });

  console.log("test-fosu-apaas-import-rate-limiter passed");
}

run();
