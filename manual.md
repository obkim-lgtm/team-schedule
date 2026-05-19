# team-schedule — 사용·운영 매뉴얼

## URL

- **사용자 보는 URL**: https://internal-tool.pages.ddapp.io/team-schedule/ (내부망 전용)
- **Gitea repo**: http://192.168.50.201:3000/Internal-Tool/team-schedule
- **로컬 작업 경로**: `F:\내 드라이브\Claude\_team_schedule\`

## 일정·메모 편집 (올립용)

1. 사이트 접속 → 좌측 캘린더에서 **날짜 클릭** 또는 헤더 **+ 일정 추가**
2. 모달에서 제목·시작일·종료일·카테고리·메모 입력 → 저장
3. 우측 **이달의 메모** 텍스트박스에 월별 아젠다 자유 기재
4. 카테고리 추가·색 변경은 헤더 **카테고리** 버튼
5. 변경 끝나면 헤더 **변경사항 저장** 클릭 → 변경된 JSON 파일들 다운로드
6. 다운로드한 파일을 `data/` 폴더에 덮어쓰고 커밋·푸시:
   ```bash
   cd "F:\내 드라이브\Claude\_team_schedule"
   git add data/manual-events.json data/memos.json data/categories.json
   git commit -m "일정 갱신: YYYY-MM-DD"
   git push
   ```
   (모달 하단의 명령어 그대로 복사 가능)
7. 약 30초 후 사이트에 반영

## 노션 동기화

### 자동
- 매일 09:00 / 12:00 / 18:00 KST (Gitea Actions cron)
- 결과: `data/notion-events.json` 자동 커밋

### 수동
- Gitea repo → **Actions** 탭 → **Notion → notion-events.json** 워크플로 → **Run workflow**

### 새 노션 DB 연동 시
1. 노션에서 Integration `team-schedule-sync`를 해당 DB 페이지의 Connections에 추가
2. Gitea repo → Settings → Actions → Secrets에서 `NOTION_DATABASE_ID` 갱신
3. 속성 이름이 기본값(`날짜`, `카테고리`)과 다르면 Settings → Actions → Variables에서 `NOTION_DATE_PROP` / `NOTION_CATEGORY_PROP` 설정
4. 수동 실행으로 검증

## 초기 세팅 (1회)

### 노션 Integration 만들기
1. https://www.notion.so/profile/integrations → **New integration**
2. Name: `team-schedule-sync`, Type: `Internal`, Capabilities: `Read content`만 체크
3. 발급된 **Internal Integration Secret** 복사

### 노션 DB 연결
1. 대상 캘린더 DB 페이지 우상단 `⋯` → **Connections** → `team-schedule-sync` 추가
2. DB URL에서 32자리 hex ID 추출 (`notion.so/<ws>/<32hex>?v=...`)

### Gitea Secrets/Vars 등록
- repo Settings → Actions → Secrets:
  - `NOTION_TOKEN` = `secret_...`
  - `NOTION_DATABASE_ID` = `32hex`
- repo Settings → Actions → Variables (DB 속성 이름이 다를 때만):
  - `NOTION_DATE_PROP`, `NOTION_CATEGORY_PROP`, `NOTION_TITLE_PROP`

### 첫 동기화
- Actions 탭 → Notion 워크플로 → Run workflow → 성공 확인 → 사이트 새로고침

## 새 카테고리 만들 때 노션과 매칭

노션 DB의 카테고리 select 값 이름이 **사이트 카테고리 이름과 정확히 일치**하면 같은 색으로 표시됩니다.

예) 노션에 select 값 `기획`, 사이트에 카테고리 `기획`(보라) → 노션 일정이 보라색으로 표시.

이름이 안 맞으면 회색(기타)으로 표시되니, 양쪽 이름을 똑같이 유지하세요.

## 로컬 미리보기

`preview_start`로 띄우거나, 그냥 `index.html`을 브라우저로 열어도 동작합니다.

## 트러블슈팅

| 증상 | 원인·해결 |
|---|---|
| 헤더에 "노션 동기화 실패" | Gitea Actions 로그 확인. 토큰 만료, DB ID 변경, Integration이 DB에 연결 안 됨 등 |
| 노션 일정이 안 보임 | (1) DB 속성 이름 확인 (2) 해당 row에 날짜 비어있지 않은지 (3) 수동 트리거 후 새로고침 |
| 사이트가 안 떠요 | Gitea Pages 활성화 확인. repo Settings → Pages → Branch: `pages` |
| "변경사항 없음" 토스트만 뜸 | 실제로 편집 안 됐거나 페이지 새로고침 후 메모리 초기화됨 |

## 관련

- 허브 카드: https://obkim-lgtm.github.io/hub/ (Internal App 섹션)
- 참고 사례: `_dd_att` (DD_Attendance) — Gitea 이주 + cron 동기화 패턴 동일
