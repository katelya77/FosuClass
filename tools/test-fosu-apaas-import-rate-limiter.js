const assert = require("assert");

const {
  __resetForTest,
  assertImportAttemptAllowed,
  recordImportCredentialFailure,
} = require("../server/src/services/fosuApaasImportRateLimiter");

function withRateLimitEnv(fn) {
  const oldEnabled = process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
  const oldIpLimit = process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M;
  process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = "true";
  process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M = "100";
  try {
    fn();
  } finally {
    if (oldEnabled == null) delete process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED;
    else process.env.FOSU_IMPORT_RATE_LIMIT_ENABLED = oldEnabled;
    if (oldIpLimit == null) delete process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M;
    else process.env.FOSU_IMPORT_IP_RATE_LIMIT_10M = oldIpLimit;
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

  console.log("test-fosu-apaas-import-rate-limiter passed");
}

run();
