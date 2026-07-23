# claude-notice

Get a **Telegram push notification** when your Claude Code task finishes, check
**session status**, and **ask follow-up questions** to finished sessions — all
from your phone, from anywhere.

Works over any network (LTE included) — your Mac only makes outbound HTTPS
requests (long polling), so no port forwarding, static IP, or extra server is
needed.

![Demo: a task-finished alert arrives, /sessions lists recent sessions, and replying to the alert asks Claude a follow-up question](https://raw.githubusercontent.com/wjsrbgus04/claude-notice/master/docs/demo.gif)

*A task-finished alert arrives → `/sessions` lists recent sessions → replying
to the alert sends a follow-up question to that session, and the answer comes
back.*

## Install

```bash
npx claude-notice setup
```

The setup wizard walks you through everything:

1. **Enter your bot token** — create one with Telegram's `@BotFather` (`/newbot`)
2. **chat_id auto-detection** — just send any message to your bot
3. Registers Claude Code hooks (`~/.claude/settings.json`)
4. Registers the daemon (macOS launchd — starts on boot, restarts on crash)
5. Sends a test notification

> Requirements: Node.js ≥ 18, `jq`, `curl`, and the Claude Code CLI.
> Automatic daemon registration is macOS-only. On other platforms, run
> `claude-notice start` directly or register it with systemd or your own
> service manager.

## Features

| | |
|---|---|
| ✅ Task-finished alerts | Push notification with the project name when a Claude Code turn ends |
| ⏸ Attention alerts | Push notification when Claude Code is waiting for permission or input |
| `/status` | Recent session status (running / done / needs attention) |
| `/sessions` | Five most recent sessions |
| `/ask <question>` | Ask a follow-up question to the most recent session |
| **Reply to an alert** | Continues that exact session and sends the answer back |

Follow-up questions run headlessly via `claude -p --resume --fork-session`.
They run in the default permission mode: reading and answering work normally,
while actions that require approval (file edits, etc.) may fail.

## CLI commands

```bash
claude-notice setup      # setup wizard (re-running reuses existing config)
claude-notice status     # daemon status and recent logs
claude-notice restart    # restart the daemon (after updates)
claude-notice logs       # follow logs
claude-notice stop       # stop the daemon
claude-notice start      # run in the foreground (non-macOS)
claude-notice uninstall  # remove hooks and daemon (config is kept)
```

## Updating

```bash
npx claude-notice@latest setup   # reinstalls the latest files, reuses your config
claude-notice restart
```

## File locations

All runtime files live in `~/.claude/claude-notice/`:
`config.json` (bot token, chmod 600) · `state.json` (session mappings) ·
`bot.mjs` (daemon) · `notify.sh` (hook script) · `daemon.log`

## Security

- The bot only responds to the **single chat_id** detected during setup;
  every other message is ignored
- If your bot token leaks, your notifications can be read — revoke it with
  BotFather's `/revoke` and run `setup` again

## How it works

```
Claude Code hooks (Stop / Notification / UserPromptSubmit)
   └→ notify.sh ─→ Telegram sendMessage (alert + message↔session mapping)

bot.mjs daemon (resident via launchd, getUpdates long polling)
   └→ handles query commands; replies to alerts run
      claude -p --resume --fork-session and send the answer back
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
