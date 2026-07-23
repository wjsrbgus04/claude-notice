# claude-notice

Get a **Telegram push notification** when your Claude Code task finishes, check
**session status**, and **ask follow-up questions** to finished sessions — all
from your phone, from anywhere.

Works over any network (LTE included) — your Mac only makes outbound HTTPS
requests (long polling), so no port forwarding, static IP, or extra server is
needed.

*A task-finished alert arrives → `/sessions` lists recent sessions → replying
to the alert sends a follow-up question to that session, and the answer comes
back.*

## Install

```bash
npx claude-notice setup
```

The setup wizard walks you through everything:

1. **Pick your language** — English or Korean, for notifications and bot replies
2. **Enter your bot token** — create one with Telegram's `@BotFather` (`/newbot`)
3. **chat_id auto-detection** — just send any message to your bot
4. Registers Claude Code hooks (`~/.claude/settings.json`)
5. Registers the daemon (macOS launchd — starts on boot, restarts on crash)
6. Sends a test notification

To change the language later, re-run `npx claude-notice setup` — it reuses your
existing bot config and only asks again for the language.

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

## How is this different from Claude Code Channels?

[Claude Code Channels](https://code.claude.com/docs/en/channels) (research
preview) bridges chats like Telegram into a **live, currently-open** Claude Code
session — great for remote-controlling a session while it runs, including
approving permission prompts from your phone.

claude-notice solves the opposite problem: **finding out what happened while
you were away**, with nothing but a lightweight daemon running.

| | claude-notice | Channels |
|---|---|---|
| Task-finished push alerts (Stop hook) | ✅ core feature | ❌ ask manually |
| Works with no Claude Code session open | ✅ lightweight daemon | ❌ session must stay running |
| Follow-up questions to **finished** sessions | ✅ `--resume --fork-session` | ❌ live session only |
| Session status across projects (`/status`) | ✅ | ❌ |
| Approve permission prompts remotely | ❌ alert only | ✅ |
| Requirements | Node ≥ 18 | Bun runtime + persistent session |

They compose well: use claude-notice to get notified and ask post-hoc
questions, and Channels when you want to drive a live session remotely.

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
