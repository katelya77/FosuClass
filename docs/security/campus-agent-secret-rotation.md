# Campus Agent secret rotation

The campus agent token and signing secret do not have a current/previous pair. Do not extend the protocol in the same change as a rotation. Rotate only in a maintenance window.

1. Pause personal sync in the admin console.
2. Confirm the queue shows queued 0 and processing 0.
3. Generate a new token and a new signing secret in a trusted environment. `openssl rand -hex 32` is suitable. Do not put the values in Git, issues, pull requests, Actions logs, chat, or tests.
4. Enter them with a hidden prompt, a permission-restricted env file, or the 1Panel env UI. Do not use a shell command that places the secret in the command line.
5. Update the Oracle runtime env.
6. Update `/etc/fosu-campus-agent.env` on WYZ the same way.
7. Restart or reload only the components that read those env files.
8. Confirm the agent heartbeat.
9. Run one real personal sync.
10. Resume personal sync.

Do not print the old or new values while doing this.
