# team-schedule — 프로젝트 맥락

## 목적

팀 내 주요 일정(배포·운영·박람회·기획 등)을 한 화면에 모아 줄리·구성원이 흐름을 이해할 수 있게 함.

## 사용자

- **편집자**: 올립 한 명. 본인 PC에서 localhost로 작업.
- **열람자**: 줄리 + 사내 구성원. Gitea Pages로 배포된 사이트(내부망 전용)에서 조회.

## 아키텍처

```
[올립 PC]                                [줄리·팀원 PC]
  node server.js                          internal-tool.pages.ddapp.io/team-schedule/
  → localhost:5184                        ↑
  → GET: 정적 서빙                        Gitea Pages (정적, 보기 전용)
  → PUT /api/save/<file>:                  ↑
     1. data/<file> 쓰기                   git push로 자동 재배포
     2. background로 git commit + push
```

**핵심 아이디어**: 정적 사이트로 협업 편집을 하려고 PAT·CORS·CF Access를 우회하는 대신, 편집자(올립) PC에 작은 Node 서버를 띄워서 파일 직접 쓰기 + 자동 git push. 줄리 등 열람자는 백엔드 없는 정적 사이트만 보면 됨.

## 핵심 결정사항

- **노션 연동 없음.** 처음엔 노션 "릴리즈 노트" DB를 자동 fetch하려 했으나, 그 DB는 과거 배포 기록용이지 일정 캘린더가 아니라 맥락 부적합. 현재는 모든 일정 수동 입력. 향후 노션 자동화 필요해지면 별도로 추가.
- **편집은 올립이만, localhost에서.** 줄리는 보기 전용. 배포된 사이트는 PUT 엔드포인트가 없어서 (server.js가 아니라 Gitea Pages가 서빙) 편집 불가.
- **자동 push 1.5초 디바운스.** 메모 입력 같이 짧은 간격으로 저장이 일어나도 한 번의 commit·push로 묶임.
- **카테고리 완전 자유.** 이름·색 모두 올립이 설정. 기본 5개(HIAI/CLIPO/운영/마케팅/기획).

## 배포

- 사내 Gitea `Internal-Tool/team-schedule`
- 공개 URL: `https://internal-tool.pages.ddapp.io/team-schedule/` (CF Access 뒤, 내부망 전용)
- 활성 브랜치: `pages` (Gitea Pages가 직접 서빙)

## 데이터 구조

```
data/
├── manual-events.json   # 일정 목록 (server가 PUT으로 갱신)
├── memos.json           # 월별 메모 (키 = "YYYY-MM")
└── categories.json      # 카테고리 정의 (이름+색)
```

## TODO / 향후

- [ ] 노션 캘린더 자동 연동 (별도 노션 DB 만들고 cron으로 fetch — 현재는 모든 일정 수동)
- [ ] 주간 뷰 토글
- [ ] 일정에 URL 첨부 (노션 페이지, PR 링크 등)
- [ ] 검색·필터링
