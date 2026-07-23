#!/usr/bin/env node
// claude-notice CLI — 설치 마법사와 데몬 관리 명령
// 사용법: claude-notice <setup|start|stop|restart|status|logs|uninstall>

import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  mkdirSync,
  existsSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const APP_DIR = join(homedir(), ".claude", "claude-notice");
const CONFIG_PATH = join(APP_DIR, "config.json");
const STATE_PATH = join(APP_DIR, "state.json");
const LOG_PATH = join(APP_DIR, "daemon.log");
const BOT_PATH = join(APP_DIR, "bot.mjs");
const NOTIFY_PATH = join(APP_DIR, "notify.sh");
const SETTINGS_PATH = join(homedir(), ".claude", "settings.json");

const PLIST_LABEL = "com.claudeNotice.daemon";
const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
const IS_MAC = platform() === "darwin";

// 훅 병합/제거 시 claude-notice 소유 항목을 식별하는 마커
// (.claude/hooks/notify.sh 는 패키지화 이전 수동 설치 경로의 마이그레이션용)
const HOOK_MARKERS = ["claude-notice/notify.sh", ".claude/hooks/notify.sh"];
const HOOK_EVENTS = [
  ["Stop", "done"],
  ["Notification", "attention"],
  ["UserPromptSubmit", "start"],
];

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", ...opts });
  } catch {
    return null;
  }
}

function telegramApi(token, method, params) {
  return fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  }).then((r) => r.json());
}

// ---------- setup ----------

async function acquireConfig() {
  if (existsSync(CONFIG_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
      if (existing.botToken && existing.chatId) {
        const me = await telegramApi(existing.botToken, "getMe");
        if (me.ok) {
          console.log(`✔ 기존 설정 재사용: @${me.result.username} (chat_id: ${existing.chatId})`);
          return existing;
        }
      }
    } catch {
      // 손상된 설정이면 새로 만든다
    }
  }

  console.log(`
Telegram 봇이 필요합니다. 아직 없다면:
  1. Telegram에서 @BotFather 검색 → /newbot
  2. 봇 이름과 아이디(..._bot) 입력 → 토큰 발급
`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let token;
  while (true) {
    token = (await rl.question("봇 토큰을 붙여넣으세요: ")).trim();
    const me = await telegramApi(token, "getMe");
    if (me.ok) {
      console.log(`✔ 봇 확인: @${me.result.username}`);
      break;
    }
    console.log("✘ 유효하지 않은 토큰입니다. 다시 확인해 주세요.");
  }
  rl.close();

  console.log("\n이제 Telegram에서 봇 채팅방을 열고 아무 메시지나 보내주세요. (최대 3분 대기)");
  let chatId = null;
  for (let i = 0; i < 4 && !chatId; i++) {
    const updates = await telegramApi(token, "getUpdates", { timeout: 50 });
    const chat = updates.result?.findLast?.((u) => u.message?.chat?.id)?.message.chat;
    if (chat) {
      chatId = chat.id;
      console.log(`✔ chat_id 확인: ${chatId} (${chat.first_name ?? ""})`);
    }
  }
  if (!chatId) {
    console.error("✘ 메시지를 받지 못했습니다. 봇에게 메시지를 보낸 뒤 setup을 다시 실행해 주세요.");
    process.exit(1);
  }

  const config = { botToken: token, chatId };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  chmodSync(CONFIG_PATH, 0o600);
  return config;
}

function installFiles() {
  copyFileSync(join(PKG_DIR, "lib", "bot.mjs"), BOT_PATH);
  copyFileSync(join(PKG_DIR, "lib", "notify.sh"), NOTIFY_PATH);
  chmodSync(NOTIFY_PATH, 0o755);
  if (!existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, JSON.stringify({ messages: {}, sessions: {} }));
  }
  console.log(`✔ 파일 설치: ${APP_DIR}`);
}

function isOurHook(entry) {
  return (entry.hooks ?? []).some((h) =>
    HOOK_MARKERS.some((marker) => (h.command ?? "").includes(marker)),
  );
}

function installHooks() {
  let settings = {};
  if (existsSync(SETTINGS_PATH)) {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  }
  settings.hooks ??= {};
  for (const [event, arg] of HOOK_EVENTS) {
    const entries = (settings.hooks[event] ?? []).filter((e) => !isOurHook(e));
    entries.push({ hooks: [{ type: "command", command: `${NOTIFY_PATH} ${arg}` }] });
    settings.hooks[event] = entries;
  }
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log(`✔ Claude Code 훅 등록: ${SETTINGS_PATH}`);
}

function removeHooks() {
  if (!existsSync(SETTINGS_PATH)) return;
  const settings = JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  if (!settings.hooks) return;
  for (const [event] of HOOK_EVENTS) {
    const entries = (settings.hooks[event] ?? []).filter((e) => !isOurHook(e));
    if (entries.length > 0) settings.hooks[event] = entries;
    else delete settings.hooks[event];
  }
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  console.log("✔ Claude Code 훅 제거");
}

function daemonPath() {
  // 데몬과 훅이 참조할 PATH — node, claude CLI, 표준 경로 포함
  const dirs = [dirname(process.execPath)];
  const claudeBin = run("/bin/sh", ["-lc", "command -v claude"])?.trim();
  if (claudeBin) dirs.push(dirname(claudeBin));
  else console.warn("⚠ claude CLI를 찾지 못했습니다. 추가 질문 기능에는 claude CLI가 필요합니다.");
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin");
  return [...new Set(dirs)].join(":");
}

function installDaemon() {
  if (!IS_MAC) {
    console.log(`
⚠ 자동 상주 실행(launchd)은 macOS에서만 지원합니다.
  다른 OS에서는 'claude-notice start'로 직접 실행하거나 systemd/작업 스케줄러에 등록하세요:
  ${process.execPath} ${BOT_PATH}`);
    return;
  }
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${BOT_PATH}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${daemonPath()}</string></dict>
  <key>StandardOutPath</key><string>${LOG_PATH}</string>
  <key>StandardErrorPath</key><string>${LOG_PATH}</string>
</dict>
</plist>
`;
  const uid = process.getuid();
  run("launchctl", ["bootout", `gui/${uid}/${PLIST_LABEL}`]);
  writeFileSync(PLIST_PATH, plist);
  const result = run("launchctl", ["bootstrap", `gui/${uid}`, PLIST_PATH]);
  if (result === null) {
    console.error("✘ launchd 등록에 실패했습니다. 'claude-notice start'로 직접 실행해 보세요.");
    return;
  }
  console.log(`✔ 데몬 등록: ${PLIST_LABEL} (부팅 시 자동 시작, 비정상 종료 시 재시작)`);
}

async function setup() {
  mkdirSync(APP_DIR, { recursive: true });
  chmodSync(APP_DIR, 0o700);
  const config = await acquireConfig();
  installFiles();
  installHooks();
  installDaemon();
  await telegramApi(config.botToken, "sendMessage", {
    chat_id: config.chatId,
    text: "🎉 claude-notice 설치 완료! Claude Code 작업이 끝나면 알림이 옵니다.\n/help 를 보내 사용법을 확인하세요.",
  });
  console.log("\n🎉 설치 완료! Telegram으로 확인 메시지를 보냈습니다.");
  console.log("   새 Claude Code 세션부터 작업 완료 알림이 전송됩니다.");
}

// ---------- daemon management ----------

function requireSetup() {
  if (!existsSync(CONFIG_PATH) || !existsSync(BOT_PATH)) {
    console.error("설치가 필요합니다: claude-notice setup");
    process.exit(1);
  }
}

function start() {
  requireSetup();
  console.log("데몬을 포그라운드로 실행합니다. 종료: Ctrl+C");
  const child = spawn(process.execPath, [BOT_PATH], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function stop() {
  if (IS_MAC) run("launchctl", ["bootout", `gui/${process.getuid()}/${PLIST_LABEL}`]);
  run("pkill", ["-f", BOT_PATH]);
  console.log("✔ 데몬 중지");
}

function restart() {
  requireSetup();
  if (!IS_MAC) {
    console.log("macOS 외 환경에서는 'claude-notice start'로 직접 실행하세요.");
    return;
  }
  const uid = process.getuid();
  if (run("launchctl", ["kickstart", "-k", `gui/${uid}/${PLIST_LABEL}`]) === null) {
    run("launchctl", ["bootstrap", `gui/${uid}`, PLIST_PATH]);
  }
  console.log("✔ 데몬 재시작");
}

function status() {
  const pid = run("pgrep", ["-f", BOT_PATH])?.trim();
  console.log(`설정: ${existsSync(CONFIG_PATH) ? CONFIG_PATH : "없음 (setup 필요)"}`);
  console.log(`데몬: ${pid ? `실행 중 (pid ${pid.split("\n")[0]})` : "중지됨"}`);
  if (existsSync(LOG_PATH)) {
    const lines = readFileSync(LOG_PATH, "utf8").trim().split("\n");
    console.log(`\n최근 로그 (${LOG_PATH}):`);
    for (const line of lines.slice(-5)) console.log(`  ${line}`);
  }
}

function logs() {
  if (!existsSync(LOG_PATH)) {
    console.log("로그 파일이 아직 없습니다.");
    return;
  }
  const child = spawn("tail", ["-f", LOG_PATH], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function uninstall() {
  stop();
  if (IS_MAC && existsSync(PLIST_PATH)) unlinkSync(PLIST_PATH);
  removeHooks();
  console.log(`✔ 제거 완료. 설정/로그(${APP_DIR})는 남겨두었습니다.`);
  console.log(`  완전히 삭제하려면: rm -rf ${APP_DIR}`);
}

// ---------- entry ----------

const HELP = `claude-notice — Claude Code 작업 알림·현황 조회·원격 질문 Telegram 봇

사용법: claude-notice <명령>

  setup      설치 마법사 (봇 연결, 훅 등록, 데몬 등록)
  start      데몬 포그라운드 실행 (macOS 외 환경용)
  stop       데몬 중지
  restart    데몬 재시작 (업데이트 후 실행)
  status     데몬 상태·최근 로그 확인
  logs       로그 실시간 보기
  uninstall  훅·데몬 제거 (설정은 유지)
`;

const command = process.argv[2];
const commands = { setup, start, stop, restart, status, logs, uninstall };
if (commands[command]) {
  await commands[command]();
} else {
  console.log(HELP);
  process.exit(command ? 1 : 0);
}
