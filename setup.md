# Claude Code Notice — 설치 가이드

Claude Code 작업 완료/승인 대기 시 Telegram으로 푸시 알림을 받고,
봇 채팅으로 작업 현황 조회와 추가 질문까지 할 수 있는 개인용 서비스.

외부 네트워크(LTE)에서도 동작한다 — 맥에서는 아웃바운드 HTTPS(롱폴링)만 사용하므로
포트포워딩·고정 IP·별도 서버가 필요 없다.

## 구성 요소

| 경로 | 역할 |
|---|---|
| `~/claude-notice/bot.mjs` | Telegram 봇 데몬 (조회·추가 질문 담당) |
| `~/.claude/hooks/notify.sh` | Claude Code 훅 → Telegram 알림 발송 |
| `~/.claude/claude-notice/config.json` | 봇 토큰·chat_id (chmod 600, git 밖) |
| `~/.claude/claude-notice/state.json` | 세션 상태·메시지↔세션 매핑 |
| `~/Library/LaunchAgents/com.ivern.claudeNotice.plist` | 데몬 자동 실행 |

## 1. Telegram 봇 만들기

1. Telegram에서 `@BotFather` 검색 → `/newbot`
2. 봇 이름·아이디 입력 → **토큰**(`123456:ABC-...` 형태)을 받는다
3. 만들어진 봇과의 채팅방에서 아무 메시지나 하나 보낸다 (chat_id 확보용)

## 2. config.json 생성

```bash
# chat_id 확인 (봇에게 메시지를 보낸 뒤 실행)
curl -s "https://api.telegram.org/bot<토큰>/getUpdates" | jq '.result[-1].message.chat.id'

mkdir -p ~/.claude/claude-notice
cat > ~/.claude/claude-notice/config.json <<'EOF'
{
  "botToken": "<토큰>",
  "chatId": <chat_id>
}
EOF
chmod 600 ~/.claude/claude-notice/config.json
```

## 3. 훅 등록

`~/.claude/settings.json`에 아래 훅이 등록되어 있어야 한다:

- `Stop` → `notify.sh done` (작업 완료 알림)
- `Notification` → `notify.sh attention` (승인 대기 알림)
- `UserPromptSubmit` → `notify.sh start` (알림 없이 "진행 중" 상태만 기록)

## 4. 데몬 등록 (launchd)

```bash
cp ~/claude-notice/com.ivern.claudeNotice.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.ivern.claudeNotice.plist

# 확인
launchctl list | grep claudeNotice
tail -f ~/.claude/claude-notice/daemon.log
```

해제: `launchctl bootout gui/$(id -u)/com.ivern.claudeNotice`

> nvm으로 Node 버전을 올리면 plist 안의 node 경로(`~/.nvm/versions/node/v22.22.2/...`)도
> 함께 갱신해야 한다.

## 5. 사용법

- **알림**: Claude Code 작업이 끝나면 "✅ 작업 완료", 승인 대기 시 "⏸ 확인 필요" 푸시가 온다
- `/status` — 최근 세션 현황 (진행 중/완료/확인 필요)
- `/sessions` — 최근 세션 기록 5개
- `/ask <질문>` — 가장 최근 세션에 이어서 질문
- **알림에 답장** — 해당 세션에 이어서 질문하고 답변을 받는다

추가 질문은 `claude -p --resume`(헤드리스)으로 실행되며 기본 권한 모드라서
파일 수정 등 승인이 필요한 작업은 실패할 수 있다 (읽기·질문 응답은 정상 동작).

## 보안 메모

- 봇은 `config.json`의 `chatId` 한 명의 메시지에만 응답한다 (그 외 전부 무시)
- 토큰이 유출되면 알림 열람이 가능하므로 `config.json`은 반드시 600 권한 유지
