#!/bin/bash
# Claude Code 훅 이벤트를 Telegram 알림으로 전달하고 세션 상태를 기록한다.
# 사용법: notify.sh <done|attention|start>  (훅 입력 JSON은 stdin으로 전달됨)
#   done      — Stop 훅: 작업 완료 알림
#   attention — Notification 훅: 승인 대기/입력 필요 알림
#   start     — UserPromptSubmit 훅: 알림 없이 세션을 "진행 중"으로만 기록

CONFIG="$HOME/.claude/claude-notice/config.json"
STATE="$HOME/.claude/claude-notice/state.json"

EVENT="${1:-done}"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty' 2>/dev/null)
PROJECT=$(basename "${CWD:-unknown}")

[ -f "$STATE" ] || echo '{"messages":{},"sessions":{}}' > "$STATE"

MSG_ID=""

# start 이벤트는 상태 기록만 하고 알림은 보내지 않는다
if [ "$EVENT" != "start" ] && [ -f "$CONFIG" ]; then
  BOT_TOKEN=$(jq -r '.botToken // empty' "$CONFIG")
  CHAT_ID=$(jq -r '.chatId // empty' "$CONFIG")

  # 메시지 언어 (config.lang: "en" | "ko", 미설정 시 한국어)
  MSG_LANG=$(jq -r '.lang // "ko"' "$CONFIG" 2>/dev/null)
  if [ "$MSG_LANG" = "en" ]; then
    ATTENTION_PREFIX="⏸ Needs attention"
    DONE_PREFIX="✅ Task finished"
    DEFAULT_DETAIL="Waiting for your input."
  else
    ATTENTION_PREFIX="⏸ 확인 필요"
    DONE_PREFIX="✅ 작업 완료"
    DEFAULT_DETAIL="입력을 기다리고 있습니다."
  fi

  if [ -n "$BOT_TOKEN" ] && [ -n "$CHAT_ID" ]; then
    case "$EVENT" in
      attention)
        DETAIL=$(echo "$INPUT" | jq -r ".message // \"${DEFAULT_DETAIL}\"" 2>/dev/null)
        TEXT="${ATTENTION_PREFIX}: ${PROJECT}
${DETAIL}"
        ;;
      *)
        TEXT="${DONE_PREFIX}: ${PROJECT}"
        ;;
    esac

    RESP=$(curl -s --max-time 10 "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${CHAT_ID}" \
      --data-urlencode "text=${TEXT}")
    MSG_ID=$(echo "$RESP" | jq -r '.result.message_id // empty' 2>/dev/null)
  fi
fi

# 세션 상태·메시지→세션 매핑 기록 (tmp 파일 후 mv로 원자적 갱신)
if [ -n "$SESSION_ID" ]; then
  STATUS="done"
  case "$EVENT" in
    start) STATUS="running" ;;
    attention) STATUS="attention" ;;
  esac

  TMP=$(mktemp)
  if jq --arg mid "$MSG_ID" \
        --arg sid "$SESSION_ID" \
        --arg cwd "$CWD" \
        --arg status "$STATUS" \
        --arg ts "$(date +%s)" \
        '.sessions[$sid] = {cwd: $cwd, status: $status, updatedAt: ($ts | tonumber)}
         | .lastSessionId = $sid
         | if $mid != "" then .messages[$mid] = {sessionId: $sid, cwd: $cwd} else . end' \
        "$STATE" > "$TMP" 2>/dev/null; then
    mv "$TMP" "$STATE"
  else
    rm -f "$TMP"
  fi
fi

exit 0
