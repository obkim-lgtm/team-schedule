# team-schedule — 사용·운영 매뉴얼

## URL

- **올립 작업용**: http://localhost:5184 (편집 가능)
- **줄리·팀원 보기용**: https://internal-tool.pages.ddapp.io/team-schedule/ (내부망 전용, 보기 전용)
- **Gitea repo**: http://192.168.50.201:3000/Internal-Tool/team-schedule
- **로컬 경로**: `F:\내 드라이브\Claude\_team_schedule\`

## 작업 시작 — 매일

Claude Code에서:
```
preview_start('team-schedule')
```

오른쪽 패널 또는 브라우저에서 http://localhost:5184 접속 → 끝.

## 일정·메모 편집

- **일정 추가**: 날짜 클릭 또는 [+ 일정 추가] → 폼 입력 → 저장
- **일정 수정/삭제**: 캘린더에서 해당 칩 클릭 → 수정·삭제
- **메모 작성**: 우측 메모 영역에 자유 기재 (1.5초 멈추면 자동 저장)
- **카테고리 관리**: 헤더 [카테고리] → 이름·색 자유 설정

저장하면 즉시 `data/*.json`에 기록되고, 1.5초 후 자동으로 git commit·push. 약 30초 후 줄리 사이트에 반영.

## 저장 상태 표시

헤더에 표시:

| 표시 | 의미 |
|---|---|
| `대기` | 변경 없음 |
| `입력 중…` | 메모 입력 중 (debounce 대기) |
| `저장 중…` | 서버에 PUT 호출 중 |
| `저장됨` | 완료 (2.5초 후 사라짐) |
| `저장 실패` | 서버 다운 또는 git push 실패 |

git push가 실패해도 파일은 로컬에 저장됨. 서버 로그(콘솔)에서 원인 확인 가능. 

## 트러블슈팅

| 증상 | 원인·해결 |
|---|---|
| "저장 실패" 빨간 칩 | server.js 안 켜져 있음. `preview_start('team-schedule')` 다시 실행 |
| 줄리 사이트가 안 바뀜 | (1) git push 성공했는지 서버 로그 확인 (2) Gitea Pages 활성화 확인 (Settings → Pages → Branch: `pages`) (3) 30초~1분 대기 |
| `fatal: bad object refs/desktop.ini` | Google Drive 동기화가 `.git/refs/`에 desktop.ini 박은 거. `find .git -name desktop.ini -delete` 실행 |
| git push가 자꾸 rejected | remote에 다른 커밋 있음. `git pull --rebase` 후 다시 시도 |

## server.js 동작 요약

- 포트 5184에서 정적 파일 서빙 (index.html, app.js, styles.css, data/*.json)
- PUT `/api/save/{categories,manual-events,memos}.json` — body의 JSON을 그대로 받아 파일에 쓰기
- 파일 쓰기 직후 응답 즉시 반환 (push는 background)
- 1.5초 디바운스 후 `git add → git commit → git push`. 여러 저장이 연달아 일어나도 한 번의 commit으로 묶임
- 변경 없으면 commit skip (조용히 넘어감)

## 줄리에게 공유

1. 처음 1회만 안내: https://internal-tool.pages.ddapp.io/team-schedule/ 북마크
2. 이후 올립이 편집 → 자동 반영
3. 줄리는 페이지 새로고침만 하면 최신 상태 보임 (캐시 때문에 안 보이면 Ctrl+F5)
