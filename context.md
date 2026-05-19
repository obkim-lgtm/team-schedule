# team-schedule — 프로젝트 맥락

## 목적

회사 주요 일정(배포·운영·기획·마케팅 등)을 한 화면에 모아 팀이 스크럼 없이도 흐름을 이해할 수 있게 함. 줄리 요청으로 시작.

## 사용자

- **편집자**: 올립 (단일). 운영 일정, 메모, 카테고리 관리.
- **열람자**: 줄리 + 사내 구성원. 내부망 전용.

## 핵심 결정사항

- **노션 배포 일정 → 사이트로 실시간 표시.** 노션 API 직접 호출은 CORS·토큰 노출 이슈. Gitea Actions가 cron으로 노션 API 호출 → `data/notion-events.json` 커밋 → 정적 사이트가 fetch. 동기화 빈도는 일 3회 (9·12·18 KST, off-peak 분 단위 오프셋).
- **운영 일정·메모·카테고리 = 사이트 UI에서 편집.** 메모리에 변경사항 쌓이고 헤더 "변경사항 저장" 버튼으로 JSON ZIP 다운로드 → repo에 덮어쓰고 커밋. 백엔드 없이 정적 사이트로 유지하기 위한 절충.
- **카테고리는 완전 자유.** 이름·색 모두 올립이 설정. 노션 카테고리 이름이 일치하면 색 매핑.
- **노션 일정은 사이트에서 수정 불가.** 모달 열면 읽기 전용 + "노션에서 수정하세요" 안내.

## 배포

- 사내 Gitea `Internal-Tool/team-schedule`
- 공개 URL: `https://internal-tool.pages.ddapp.io/team-schedule/` (CF Access 뒤, 내부망 전용)
- 활성 브랜치: `pages` (Gitea Pages가 직접 서빙)

## 노션 연동 사양

- **Integration**: `team-schedule-sync` (Internal, Read content)
- **대상 DB**: 배포·일정 캘린더 DB
- **필요 속성**:
  - 제목 (Title 타입) — 자동탐지
  - 날짜 (Date 타입) — 기본 이름 `날짜`. 다르면 `vars.NOTION_DATE_PROP`
  - 카테고리 (Select / Multi-select / Status 타입) — 기본 이름 `카테고리`. 다르면 `vars.NOTION_CATEGORY_PROP`
- **시크릿** (Gitea repo Settings → Actions → Secrets):
  - `NOTION_TOKEN`: Integration Secret (secret_...)
  - `NOTION_DATABASE_ID`: 32자리 hex
- **변수** (선택, vars):
  - `NOTION_DATE_PROP`, `NOTION_CATEGORY_PROP`, `NOTION_TITLE_PROP`

## 데이터 구조

```
data/
├── notion-events.json   # ⚙️ Gitea Actions 자동 갱신 (편집 금지)
├── manual-events.json   # ✍️ 사이트에서 편집 → ZIP 다운로드 → 덮어쓰기
├── memos.json           # ✍️ 월별 메모. 키 = "YYYY-MM"
└── categories.json      # ✍️ 카테고리 정의 (이름+색)
```

## TODO / 향후

- [ ] 헤더 "지금 동기화" 버튼 (Gitea Actions API workflow_dispatch 호출, PAT 입력)
- [ ] 일정 색상 외에 아이콘도 카테고리당 1개 지정 가능하게
- [ ] 주간 뷰 토글
- [ ] 노션 DB 다중 연동 (예: 운영팀 캘린더, 마케팅 캘린더 분리)
