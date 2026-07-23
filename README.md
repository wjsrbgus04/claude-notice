# claude-notice

Claude Code 작업이 끝나면 **Telegram으로 푸시 알림**을 보내고, 봇 채팅으로
**작업 현황 조회**와 **끝난 세션에 대한 추가 질문**까지 할 수 있는 도구입니다.

외부 네트워크(LTE)에서도 동작합니다 — 맥에서는 아웃바운드 HTTPS(롱폴링)만
사용하므로 포트포워딩·고정 IP·별도 서버가 필요 없습니다.

## 설치

```bash
npx claude-notice setup
```

설치 마법사가 순서대로 안내합니다:

1. **봇 토큰 입력** — Telegram `@BotFather`에서 `/newbot`으로 발급
2. **chat_id 자동 감지** — 봇에게 아무 메시지나 보내면 됨
3. Claude Code 훅 등록 (`~/.claude/settings.json`)
4. 데몬 등록 (macOS launchd — 부팅 시 자동 시작, 죽으면 자동 재시작)
5. 테스트 알림 발송

> 요구사항: Node.js ≥ 18, `jq`, `curl`, Claude Code CLI.
> 자동 상주 실행은 macOS 지원. 다른 OS는 `claude-notice start`로 직접 실행하거나
> systemd 등에 등록하세요.

## 기능

| | |
|---|---|
| ✅ 작업 완료 알림 | Claude Code 턴이 끝나면 프로젝트명과 함께 푸시 |
| ⏸ 확인 필요 알림 | 권한 승인 등 입력 대기 시 푸시 |
| `/status` | 최근 세션 현황 (진행 중/완료/확인 필요) |
| `/sessions` | 최근 세션 기록 5개 |
| `/ask <질문>` | 가장 최근 세션에 이어서 질문 |
| **알림에 답장** | 해당 세션에 이어서 질문하고 답변 수신 |

추가 질문은 `claude -p --resume --fork-session`(헤드리스)으로 실행됩니다.
기본 권한 모드라서 읽기·질문 응답은 정상 동작하고, 파일 수정 등 승인이 필요한
작업은 실패할 수 있습니다.

## CLI 명령

```bash
claude-notice setup      # 설치 마법사 (재실행 시 기존 설정 재사용)
claude-notice status     # 데몬 상태·최근 로그
claude-notice restart    # 데몬 재시작 (패키지 업데이트 후 setup → restart)
claude-notice logs       # 로그 실시간 보기
claude-notice stop       # 데몬 중지
claude-notice start      # 포그라운드 실행 (macOS 외 환경용)
claude-notice uninstall  # 훅·데몬 제거 (설정은 유지)
```

## 파일 위치

모든 런타임 파일은 `~/.claude/claude-notice/`에 설치됩니다:
`config.json`(봇 토큰, chmod 600) · `state.json`(세션 매핑) · `bot.mjs`(데몬) ·
`notify.sh`(훅) · `daemon.log`

## 보안

- 봇은 setup 때 감지한 **chat_id 한 명**의 메시지에만 응답합니다 (그 외 전부 무시)
- 봇 토큰이 유출되면 알림 열람이 가능합니다 — BotFather `/revoke`로 재발급 후
  `setup`을 다시 실행하세요

## 동작 원리

```
Claude Code 훅 (Stop/Notification/UserPromptSubmit)
   └→ notify.sh ─→ Telegram sendMessage (알림 + 메시지↔세션 매핑 기록)

bot.mjs 데몬 (launchd 상주, getUpdates 롱폴링)
   └→ 조회 명령 처리, 알림 답장 시 claude -p --resume --fork-session 실행
```

## License

MIT
