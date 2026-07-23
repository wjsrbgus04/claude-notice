# Contributing to claude-notice

Thanks for your interest in contributing! This document explains how to get set
up and what we expect from contributions.

## Design principles

Please keep these in mind — PRs that follow them are much easier to merge:

- **Zero runtime dependencies.** The daemon and CLI use only Node.js built-ins
  (Node ≥ 18). Adding a dependency needs a very strong justification.
- **Small and auditable.** This tool runs resident on people's machines and
  executes the Claude Code CLI. Every line should be easy to review.
- **Fail quietly in hooks.** `notify.sh` runs inside Claude Code hooks — it
  must never block or break a Claude Code session (always `exit 0`, always
  time-bound network calls).
- **Security first.** The bot must only ever respond to the configured
  `chatId`. Secrets stay in `~/.claude/claude-notice/config.json` (chmod 600)
  and never in the repository.

## Project layout

```
bin/cli.mjs    # CLI: setup wizard + daemon management (setup/start/stop/…)
lib/bot.mjs    # Telegram bot daemon (long polling, /status, /ask, replies)
lib/notify.sh  # Claude Code hook script (alerts + state recording)
```

Runtime files are installed to `~/.claude/claude-notice/` by `setup`.

## Development setup

```bash
git clone https://github.com/wjsrbgus04/claude-notice.git
cd claude-notice

# syntax checks
node --check bin/cli.mjs
node --check lib/bot.mjs
bash -n lib/notify.sh

# run your local copy
node bin/cli.mjs setup     # installs your working copy's files
node bin/cli.mjs start     # run the daemon in the foreground for debugging
```

To test the hook script in isolation:

```bash
echo '{"session_id":"test","cwd":"/tmp"}' | lib/notify.sh done
```

## Making changes

1. Fork the repository and create a branch from `master`.
2. Make your change. Match the existing style — plain modern JavaScript
   (ESM, no TypeScript, no build step), 2-space indentation.
3. Verify:
   - `node --check` / `bash -n` pass on every changed file
   - `npm pack --dry-run` shows only intended files
   - Run the affected flow end-to-end with a real bot (setup, an alert, and a
     reply-question if you touched that path)
4. Commit using the `[TYPE] summary` format, e.g. `[FIX] handle empty
   transcript files` (types: `FEAT`, `FIX`, `DOCS`, `CHORE`, `REFACTOR`).
5. Open a pull request describing **what** changed, **why**, and **how you
   tested it**.

## Reporting bugs

Open an issue with:

- your OS and Node.js version
- the command or flow that failed
- relevant lines from `~/.claude/claude-notice/daemon.log`
  (**redact your bot token and chat_id**)

## Reporting security issues

Please do **not** open a public issue for security vulnerabilities.
Report them privately via
[GitHub Security Advisories](https://github.com/wjsrbgus04/claude-notice/security/advisories/new).

## License

By contributing, you agree that your contributions are licensed under the MIT
License.
