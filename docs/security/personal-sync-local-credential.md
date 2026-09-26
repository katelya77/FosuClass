# Personal sync local credential

The school password for quick resync is stored only in the WeChat mini program sandbox, under `FOSU_PERSONAL_SYNC_CREDENTIAL_V1`, scoped to the current session owner.

It is not written to the API server, CloudBase, or the Oracle disk. It is not a hardware-backed secret, not end-to-end encryption, and not absolutely safe.

The password can be read by someone who already has the logged-in WeChat client and can read that mini program's local sandbox. During one Route 2 job it also exists in the task payload until the broker claim wipes it.

A later version should ask before remembering the password, expire the local credential, isolate it when the account changes, and keep the existing one-tap clear. This note does not change the mini program.
