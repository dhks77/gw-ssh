## 작성자 특징 노출 방지

git 에 커밋되는 모든 산출물(코드, 문서, 설정, 커밋 메시지, PR 본문, README 등)에는 작성자/회사/팀을 특정할 수 있는 정보를 남기지 않는다.

### 금지 대상 (카테고리)

구체적 패턴 값은 이 문서에 적지 않는다. 실제 정규식은 `.claude/patterns.json` (gitignored) 에서 관리하고, 구조 예시는 `.claude/patterns.example.json` 참고.

- 사내 이메일 도메인
- 팀명/부서명
- 개인 실명 (한글/영문)
- 사내 전용 도메인/URL (이슈 트래커, 내부 게이트웨이 등)
- 내부 호스트명 접두사 (환경-역할 조합 등)
- 사내 전용 계정/UID

### 예외 (스캔 제외)

- `.gitignore` 에 포함돼 git 에 올라가지 않는 파일 (`.plans/`, 로컬 설정 파일 등)
- git repo 밖 파일 (로컬 노트, 개인 설정)
- 프로젝트가 정상적으로 다루는 공개 가능한 서비스명
- 공개 OSS 이름

### 대체 표현 가이드

실제 값을 쓰지 말고 일반 placeholder 로 대체한다.

| 카테고리 | 대체 |
|---|---|
| 사내 이메일 | `user@example.com`, `user@example.org` |
| 실명 | `사용자`, `개발자`, `reviewer` |
| 내부 호스트 | `host1`, `server-01`, `app-01` |
| 사내 계정명 | `deploy`, `appuser`, `admin` |
| 사내 URL | `<task-tracker-url>`, `<internal-service>` 또는 언급 생략 |

### 훅 방어

`.claude/hooks/no-identifying-info.py` 가 PreToolUse (Write/Edit/MultiEdit) 시 git 추적 대상 파일(gitignore 밖 + repo 안)에 대해 패턴을 스캔해 BLOCK.

- 패턴 정의: `.claude/patterns.json` 에서 로드. 이 파일이 없으면 훅은 no-op.
- 팀원 환경 구축: 레포 clone 후 `.claude/patterns.example.json` 을 복사해 `.claude/patterns.json` 로 만들고 자기 조직의 실제 값으로 교체.
- `.claude/patterns.json` 은 `.gitignore` 대상 — 실제 값이 git 에 올라가지 않음.
- 훅 command 는 `$CLAUDE_PROJECT_DIR/.claude/hooks/...` 로 등록되어 있어 clone 만으로 동작.

### 이유

- git 저장소는 공개되거나 공유될 수 있어, 한 번 커밋되면 회수 어려움.
- 작성자 특징이 남으면 외부 노출 시 개인 식별·회사 내부 구조 추정 가능.
- 공개 OSS 기여 / 포트폴리오 / 이직 시 히스토리로 따라붙음.

### 실수했을 때

- 아직 push 전: 관련 커밋 되돌리거나 재구성(rebase/amend 신중히).
- push 후 remote 배포: 해당 레포 관리자에게 history rewrite 요청 고려. 최소한 이후 커밋에서는 제거.
