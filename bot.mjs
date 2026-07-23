#!/usr/bin/env node
// Claude Code Notice — Telegram 봇 데몬
// 알림에 답장하거나 명령을 보내면 로컬 Claude Code 세션을 조회/재개한다.
// 의존성 없음 (Node >= 18, 내장 fetch 사용)

import {
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join, basename } from "node:path";

const CONFIG_DIR = join(homedir(), ".claude", "claude-notice");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const STATE_PATH = join(CONFIG_DIR, "state.json");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

const RESUME_TIMEOUT_MS = 10 * 60 * 1000;
const TELEGRAM_MAX_LEN = 4000;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

if (!existsSync(CONFIG_PATH)) {
  console.error(`설정 파일이 없습니다: ${CONFIG_PATH}`);
  process.exit(1);
}

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
if (!config.botToken || !config.chatId) {
  console.error("config.json에 botToken/chatId가 필요합니다.");
  process.exit(1);
}
const ALLOWED_CHAT_ID = Number(config.chatId);
const API = `https://api.telegram.org/bot${config.botToken}`;

// ---------- state ----------

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { messages: {}, sessions: {} };
  }
}

function writeState(mutate) {
  // notify.sh(훅)와 동일하게 tmp 후 rename으로 원자적 갱신
  const state = readState();
  mutate(state);
  const tmp = `${STATE_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
  return state;
}

// ---------- telegram ----------

async function api(method, params) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params ?? {}),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`${method} 실패: ${JSON.stringify(body)}`);
  return body.result;
}

async function sendText(text, replyToMessageId) {
  // 텔레그램 메시지 길이 제한 대응: 4000자 단위 분할 전송, 마지막 메시지 id 반환
  let lastMessage = null;
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_LEN) {
    lastMessage = await api("sendMessage", {
      chat_id: ALLOWED_CHAT_ID,
      text: text.slice(i, i + TELEGRAM_MAX_LEN),
      ...(i === 0 && replyToMessageId
        ? { reply_to_message_id: replyToMessageId }
        : {}),
    });
  }
  return lastMessage;
}

// ---------- helpers ----------

function relativeTime(epochSeconds) {
  const diff = Math.floor(Date.now() / 1000) - epochSeconds;
  if (diff < 60) return "방금";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

const STATUS_LABEL = {
  running: "🟢 진행 중",
  done: "✅ 완료",
  attention: "⏸ 확인 필요",
};

function statusReport() {
  const state = readState();
  const entries = Object.entries(state.sessions ?? {})
    .sort(([, a], [, b]) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 5);
  if (entries.length === 0) return "기록된 세션이 없습니다.";
  const lines = entries.map(([sid, s]) => {
    const project = basename(s.cwd || "unknown");
    const label = STATUS_LABEL[s.status] ?? s.status;
    return `${label} · ${project} · ${relativeTime(s.updatedAt ?? 0)}\n   ${sid.slice(0, 8)}…`;
  });
  return `최근 세션 현황:\n\n${lines.join("\n")}`;
}

function transcriptCwd(filePath) {
  // cwd는 첫 줄이 아니라 user 이벤트 줄부터 나오고, 그 앞에 수 MB짜리
  // 스냅샷 줄이 끼어 있을 수 있어 청크 단위로 "cwd" 첫 등장을 찾는다
  const CHUNK = 1024 * 1024;
  const MAX_SCAN = 16 * 1024 * 1024;
  let fd;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(CHUNK);
    let tail = "";
    for (let pos = 0; pos < MAX_SCAN; pos += CHUNK) {
      const n = readSync(fd, buf, 0, CHUNK, pos);
      if (n <= 0) break;
      const text = tail + buf.toString("utf8", 0, n);
      const match = text.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
      if (match) return JSON.parse(`"${match[1]}"`);
      tail = text.slice(-4096);
      if (n < CHUNK) break;
    }
  } catch {
    // 파일 접근 실패 시 null
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return null;
}

function findSessionFile(sessionId) {
  for (const dir of readdirSync(PROJECTS_DIR)) {
    const filePath = join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function sessionsReport() {
  // 트랜스크립트 파일 mtime 기준 최근 5개. 프로젝트 경로는 첫 줄 JSON의 cwd에서 추출
  const files = [];
  for (const dir of readdirSync(PROJECTS_DIR)) {
    const dirPath = join(PROJECTS_DIR, dir);
    let names;
    try {
      names = readdirSync(dirPath).filter((n) => n.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const name of names) {
      const filePath = join(dirPath, name);
      try {
        files.push({ filePath, sessionId: name.replace(/\.jsonl$/, ""), mtime: statSync(filePath).mtimeMs });
      } catch {
        // 파일이 그 사이 지워졌으면 무시
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const recent = files.slice(0, 5).map((f) => {
    const cwd = transcriptCwd(f.filePath);
    const project = cwd ? basename(cwd) : "unknown";
    return `📁 ${project} · ${relativeTime(Math.floor(f.mtime / 1000))}\n   ${f.sessionId.slice(0, 8)}…`;
  });
  if (recent.length === 0) return "세션 기록이 없습니다.";
  return `최근 세션 기록:\n\n${recent.join("\n")}`;
}

// ---------- claude resume ----------

const runningSessions = new Set();

function runClaude(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "claude",
      args,
      {
        cwd: cwd && existsSync(cwd) ? cwd : homedir(),
        timeout: RESUME_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024,
        env: process.env,
      },
      (error, stdout, stderr) => {
        if (error) reject(new Error(stderr?.trim() || error.message));
        else resolve(stdout);
      },
    );
    // stdin을 닫지 않으면 claude가 파이프 입력을 3초간 기다린다
    child.stdin?.end();
  });
}

async function askSession(sessionId, cwd, question, questionMessageId) {
  if (runningSessions.has(sessionId)) {
    await sendText("⚠️ 이 세션에 대한 질문이 이미 실행 중입니다. 끝나면 다시 시도해 주세요.", questionMessageId);
    return;
  }
  runningSessions.add(sessionId);
  try {
    // --resume은 실행 위치의 프로젝트 폴더에서만 세션을 찾으므로,
    // 훅이 기록한 cwd 대신 트랜스크립트 파일 위치에서 실제 cwd를 역산한다
    const sessionFile = findSessionFile(sessionId);
    if (!sessionFile) {
      await sendText(`❌ 세션(${sessionId.slice(0, 8)}…)의 기록 파일을 찾을 수 없습니다.`, questionMessageId);
      return;
    }
    const resolvedCwd = transcriptCwd(sessionFile) || cwd;

    await sendText(`⏳ 세션(${sessionId.slice(0, 8)}…)에 질문을 전달했습니다. 응답을 기다리는 중…`, questionMessageId);
    // --fork-session: 원본 세션 파일을 건드리지 않아 활성 세션과의 충돌을 방지
    const stdout = await runClaude(
      ["-p", "--resume", sessionId, question, "--output-format", "json", "--fork-session"],
      resolvedCwd,
    );
    const result = JSON.parse(stdout);
    const answer = result.result?.trim() || "(빈 응답)";
    const newSessionId = result.session_id || sessionId;

    const sent = await sendText(`💬 ${answer}`, questionMessageId);

    // fork된 새 session_id로 매핑을 갱신해 연속 질문을 지원
    writeState((state) => {
      state.sessions ??= {};
      state.messages ??= {};
      state.sessions[newSessionId] = {
        cwd: resolvedCwd,
        status: "done",
        updatedAt: Math.floor(Date.now() / 1000),
      };
      state.lastSessionId = newSessionId;
      if (sent) state.messages[String(sent.message_id)] = { sessionId: newSessionId, cwd: resolvedCwd };
    });
  } catch (error) {
    log("resume 실패:", error.message);
    await sendText(`❌ 질문 처리에 실패했습니다:\n${String(error.message).slice(0, 1000)}`, questionMessageId);
  } finally {
    runningSessions.delete(sessionId);
  }
}

// ---------- message handling ----------

const HELP_TEXT = [
  "Claude Code Notice 봇입니다.",
  "",
  "/status — 최근 세션 현황 (진행 중/완료/확인 필요)",
  "/sessions — 최근 세션 기록 5개",
  "/ask <질문> — 가장 최근 세션에 이어서 질문",
  "",
  "또는 작업 완료 알림에 **답장**하면 해당 세션에 이어서 질문합니다.",
].join("\n");

async function handleMessage(msg) {
  if (msg.chat?.id !== ALLOWED_CHAT_ID) {
    log(`허용되지 않은 chat_id 무시: ${msg.chat?.id}`);
    return;
  }
  const text = (msg.text ?? "").trim();
  if (!text) return;

  // 알림/답변 메시지에 대한 답장 → 매핑된 세션에 이어서 질문
  const replyId = msg.reply_to_message?.message_id;
  if (replyId != null) {
    const mapped = readState().messages?.[String(replyId)];
    if (mapped?.sessionId) {
      await askSession(mapped.sessionId, mapped.cwd, text, msg.message_id);
      return;
    }
    await sendText("이 메시지는 세션과 연결되어 있지 않습니다. /ask <질문> 을 사용해 주세요.", msg.message_id);
    return;
  }

  if (text === "/start" || text === "/help") {
    await sendText(HELP_TEXT);
    return;
  }
  if (text === "/status") {
    await sendText(statusReport());
    return;
  }
  if (text === "/sessions") {
    await sendText(sessionsReport());
    return;
  }
  if (text.startsWith("/ask")) {
    const question = text.slice(4).trim();
    if (!question) {
      await sendText("사용법: /ask <질문>");
      return;
    }
    const state = readState();
    const sid = state.lastSessionId;
    if (!sid) {
      await sendText("아직 기록된 세션이 없습니다. Claude Code 작업이 한 번 끝난 뒤 사용해 주세요.");
      return;
    }
    await askSession(sid, state.sessions?.[sid]?.cwd, question, msg.message_id);
    return;
  }

  await sendText(HELP_TEXT);
}

// ---------- main loop ----------

async function main() {
  const me = await api("getMe");
  log(`봇 시작: @${me.username} (chat_id 허용: ${ALLOWED_CHAT_ID})`);

  // "/" 입력 시 자동완성 메뉴와 봇 프로필 설명 등록 (실패해도 봇 동작에는 지장 없음)
  try {
    await api("setMyCommands", {
      commands: [
        { command: "status", description: "최근 세션 현황 (진행 중/완료/확인 필요)" },
        { command: "sessions", description: "최근 세션 기록 5개" },
        { command: "ask", description: "가장 최근 세션에 이어서 질문" },
        { command: "help", description: "도움말" },
      ],
    });
    await api("setMyShortDescription", {
      short_description: "Claude Code 작업 알림·현황 조회·원격 질문 봇",
    });
    await api("setMyDescription", {
      description:
        "Claude Code 작업이 끝나면 알림을 보내고, 알림에 답장하면 그 세션에 이어서 질문할 수 있습니다. /status로 현황을 확인하세요.",
    });
  } catch (error) {
    log("명령어/설명 등록 실패:", error.message);
  }

  let offset = 0;
  while (true) {
    try {
      const updates = await api("getUpdates", { offset, timeout: 50 });
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) {
          // 개별 메시지 처리 실패가 폴링 루프를 죽이지 않도록 분리
          handleMessage(update.message).catch((e) => log("메시지 처리 오류:", e.message));
        }
      }
    } catch (error) {
      log("폴링 오류:", error.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

main().catch((error) => {
  console.error("치명적 오류:", error);
  process.exit(1);
});
