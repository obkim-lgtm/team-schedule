# team-schedule — 사용·운영 매뉴얼

## URL

- **사용자 보는 URL**: https://internal-tool.pages.ddapp.io/team-schedule/ (내부망 전용)
- **Gitea repo**: http://192.168.50.201:3000/Internal-Tool/team-schedule
- **로컬 작업 경로**: `F:\내 드라이브\Claude\_team_schedule\`

## 일정·메모 편집 (올립 + 권한 있는 사람)

### 첫 1회: PAT 입력
1. 사이트 접속 → 운영 일정·메모를 처음 수정하려고 하면 **Gitea PAT 입력** 모달이 뜸
2. Gitea PAT 발급 → 토큰 붙여넣기 → 저장
3. localStorage에 저장돼서 이후 자동 사용

### PAT 발급 방법
1. http://192.168.50.201:3000/user/settings/applications
2. Generate New Token
3. Name: `team-schedule-edit` (또는 원하는 이름)
4. Scopes: **write:repository** 체크 필수
5. Generate → 토큰 복사 (이 화면 닫으면 다시 못 봄)

### 이후 사용
- **일정 추가**: 날짜 클릭 또는 [+ 일정 추가] → 저장 → 자동 커밋·push (약 30초 후 사이트 반영)
- **일정 수정/삭제**: 캘린더에서 해당 칩 클릭 → 수정 또는 삭제
- **메모 작성**: 우측 메모 영역에 자유 기재 → 1.5초 멈추면 자동 저장
- **카테고리 관리**: 헤더 [카테고리] 버튼 → 이름·색 편집 → 저장

### 저장 상태 인디케이터
헤더 좌측에 표시:

| 표시 | 의미 |
|---|---|
| `변경 없음` | 대기 중 |
| `입력 중…` | 메모 입력 중 (debounce 대기) |
| `저장 중…` | Gitea API 호출 중 |
| `저장됨` | 완료 (2.5초 후 사라짐) |
| `PAT 미설정` | 토큰 없음 — 편집 시도하면 입력 모달 |
| `PAT 오류` | 토큰 유효하지 않음 — 클릭해서 재입력 |
| `저장 실패` | 네트워크/권한 등 — 클릭해서 PAT 재입력 |

## 노션 동기화 (배포 일정)

노션 "릴리즈 노트" DB → `data/notion-events.json` 자동 갱신.

### 자동
- 매일 09:00 / 12:00 / 18:00 KST (Gitea Actions cron)
- 결과: `data/notion-events.json` 자동 커밋

### 수동
- Gitea repo → **Actions** 탭 → **Notion → notion-events.json** 워크플로 → **Run workflow**

## 노션과 사이트 색 매핑

- 노션 DB의 `프로젝트` Select 값 = 사이트 카테고리 이름 일치 → 같은 색
- 현재: `HIAI` 보라(#7E44FB), `CLIPO` 파랑(#416BFF)
- 일치 안 하면 회색 표시 — 사이트 카테고리 수정으로 맞추세요

## 초기 세팅 (이미 완료된 항목)

### 노션 Integration
- 이름: `team-schedule-sync`
- 워크스페이스: Datadriven
- 권한: Read content
- 연결된 DB: 릴리즈 노트 (`26f17e5c8cf180f7ac6ef4650e89e859`)

### Gitea Secrets
repo Settings → Actions → Secrets:
- `NOTION_TOKEN`: Notion Integration Secret
- `NOTION_DATABASE_ID`: `26f17e5c8cf180f7ac6ef4650e89e859`

### Gitea Variables (선택)
- `NOTION_DATE_PROP`: 기본 `배포일`
- `NOTION_CATEGORY_PROP`: 기본 `프로젝트`
- `NOTION_DATE_FROM`: 기본 `2026-05-01`

## 로컬 미리보기

```
preview_start('team-schedule')  → http://localhost:5184
```

## 트러블슈팅

| 증상 | 원인·해결 |
|---|---|
| "노션 동기화 실패" | Gitea Actions 로그 확인. 토큰 만료, DB ID 변경, Integration이 DB에 연결 안 됨 |
| 노션 일정 안 보임 | (1) DB 속성 이름 확인 (2) 해당 row 날짜 비어있지 않은지 (3) 배포일 < 2026-05-01인지 (필터됨) |
| 사이트 안 뜸 | Gitea Pages 활성화 확인. repo Settings → Pages → Branch: `pages` |
| 저장 실패 | save-status 칩 클릭 → PAT 재입력. PAT에 `write:repository` 권한 있는지 확인 |
| 저장은 됐는데 사이트에 반영 안 됨 | Gitea Pages 재배포(~30초) 대기. 새로고침 |

## 관련

- 허브 카드: https://obkim-lgtm.github.io/hub/ (Internal App 섹션)
- 참고 사례: `_dd_att` (DD_Attendance) — 같은 패턴(localStorage PAT + Gitea API)
