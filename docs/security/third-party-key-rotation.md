# CloudBase and Coze key rotation

Do not rotate these keys automatically.

1. Create a new key in the provider console.
2. Replace the Oracle env value for `CLOUDBASE_OPENAI_API_KEY` or `COZE_API_KEY` through the secret UI or a hidden prompt.
3. Restart or deploy so the process reads the new value.
4. Run the smallest existing health probe for that provider.
5. After the probe succeeds, revoke the old key in the provider console.

Do not copy the key into Git, issues, pull requests, Actions logs, or chat.
