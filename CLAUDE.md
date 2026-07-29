# CLAUDE.md — 프로젝트 내부 가이드

사용자용 CLI 설명은 `README.md` 를 본다. 이 문서는 **개발자/에이전트가 코드를 수정할 때 알아야 할 내부 구조와 제약** 을 정리한다.

## 한 줄 요약

Node.js CLI. `ssh2` 라이브러리로 Gateway 에 1회 연결하고, 그 위에서 SSH channel multiplexing 으로 원격 명령 실행 / SCP 를 수행한다.

## 프로젝트 레이아웃

```
src/
├── index.ts                 # commander.js 엔트리, 서브커맨드 등록, 시그널 핸들러
├── config.ts                # config.json 로드, Proxy 기반 lazy-load
├── ssh.ts                   # 핵심: Gateway 연결, kinit, exec, SFTP, SCP
├── commands/
│   ├── exec.ts              # `exec` 서브커맨드
│   ├── scp.ts               # `upload` / `download` 서브커맨드
│   └── config.ts            # `config` / `status` 서브커맨드
└── __tests__/
    └── integration.test.ts  # Vitest 통합 테스트 (실제 gateway 필요)
```

빌드: `tsc` → `dist/` 로 출력, `bin` 엔트리는 `dist/index.js`.

## 핵심 구조 — Gateway 연결 재사용

### 싱글톤 Client

`src/ssh.ts` 에 **모듈 스코프 싱글톤 2개**:

```ts
let gatewayClient: Client | null = null;   // ssh2 Client
let isKinitDone = false;                    // Kerberos 티켓 발급 여부
```

- `connectGateway()` 는 `gatewayClient` 가 있으면 그대로 반환. 첫 호출에서만 TCP + SSH handshake.
- `close` 이벤트 시 둘 다 리셋.
- `executeKinit(conn)` 은 `isKinitDone` true 면 즉시 resolve → 중복 kinit 방지.

### SSH channel multiplexing

`conn.exec(cmd, cb)` 를 호출하면 ssh2 가 **기존 TCP 연결 위에 새 SSH channel** 을 연다. 같은 `gatewayClient` 로 여러 `conn.exec` 를 동시에 부르면 N 개 channel 이 병렬로 동작 — 이게 "Gateway 에서 fan-out" 이 실현되는 메커니즘이다.

Gateway sshd 의 `MaxSessions` 기본값(10) 을 초과하면 channel 열기 실패. 병렬 작업에서 동시성 상한이 필요한 이유.

### Command pipeline (exec)

`executeCommandStream(host, user, command, onStdout, onStderr)`:

1. host 허용 검증 (`isHostAllowed`)
2. `connectGateway()` → gateway Client 확보
3. kinit 필요 시 `executeKinit` (첫 번째 호출만 실제 발급)
4. command 를 base64 인코딩해 `ssh <target> "echo ... | base64 --decode | timeout ... bash"` 형태로 wrap — 셸 인젝션 방지 + 타임아웃 강제
5. `conn.exec(sshCommand)` 로 nested ssh 를 gateway 에서 실행, stream 데이터를 callback 으로 릴레이

nested ssh / scp 의 공통 옵션은 src/ssh.ts 의 SSH_OPTS 상수로 관리한다. LogLevel=ERROR 가 포함돼 있어 대상 서버 sshd 의 Banner(접속 경고문)가 stderr 로 섞이지 않는다.
- ssh 클라이언트는 LogLevel 이 INFO 이상일 때만 배너를 출력하므로, 문자열 필터링 없이 소스에서 차단된다.
- ssh/scp 자체 에러 메시지는 LogLevel=ERROR 에서도 그대로 출력된다.

### SCP pipeline (upload/download)

SCP 는 `ssh2` 의 SFTP + shell `scp` 조합:

- **Upload (단일 호스트, `uploadFile`)**: 로컬 → SFTP 로 gateway `/tmp/` 에 임시 업로드 → gateway 에서 `scp tempFile user@target:remotePath` → 임시파일 삭제
- **Upload (다중 호스트, `uploadFileMulti`)**: 로컬 → SFTP 로 gateway 에 **공용 임시파일 1회**만 업로드 → 호스트별로 `scp sharedTemp user@host_i:remotePath` 를 병렬 발사 → 마지막에 공용 임시파일 1회 삭제. payload 가 로컬→gateway 구간을 N번 타지 않도록 amortize.
- **Download**: gateway 에서 `scp user@target:remotePath tempFile` → SFTP 로 로컬에 읽기 → 임시파일 삭제. 호스트별 파일 내용이 다르므로 공용 temp 재사용 불가 — 병렬 모드에서도 호스트별 독립 temp 가 생성됨.

임시파일명은 `crypto.randomUUID()` 로 충돌 방지.

## 중요 제약과 함정

### disconnect() 타이밍

`disconnect()` 는 `gatewayClient.end()` 를 호출해 TCP 를 닫는다. 현재 각 서브커맨드의 `finally` 에서 호출:

```ts
finally { disconnect(); }
```

**여러 작업을 같은 프로세스에서 이어 할 때**는 루프 내부에서 호출하면 안 된다. Client 가 종료되면 다음 호출이 재연결 → auth 비용 amortize 실패. 루프 바깥에서 한 번만 호출.

### Buffer vs String

- `executeCommandStream` 의 stdout/stderr callback 은 `data.toString()` 결과(string)를 넘긴다 — 원격 명령 출력은 텍스트 전제.
- 하지만 **SCP 는 바이너리** 를 다뤄야 하므로 `sftpReadFile` / `sftpWriteFile` 는 `Buffer` 를 그대로 취급해야 한다. 문자열 concat(`data += chunk.toString()`) 은 UTF-8 디코드를 거치며 `>=0x80` 바이트를 U+FFFD 로 치환시켜 바이너리 파괴.

### 셸 인자 검증

`validateShellArg()` 가 `[;`$()&|><\n\r]` 을 거부. user / remotePath 에 적용. command 본문은 base64 encode 로 우회.

### Kerberos 패스워드

`config.kinitPassword` 가 비어있으면 kinit 전체 skip. 설정돼 있으면 `pty: true` 로 `kinit` 실행하고 `Password` 프롬프트에 비밀번호 투입.

### 타임아웃

원격 명령은 `timeout -s TERM --kill-after=5 <sec> bash` 로 감싸 hang 방지. `commandTimeoutSec` 설정 (기본 300초). 명령어 단위 override 는 없음 — 필요 시 config 수정.

## 설정 로딩

`src/config.ts` 는 Proxy 기반 lazy load:

- `config` 는 `new Proxy({}, ...)` — 첫 속성 접근 시 파일 읽기
- 경로 우선순위: `setConfigPath()` → `CONFIG_FILE` 환경변수 → 없으면 에러
- `gatewayConnection: "user@host:port"` 형태 문자열을 정규식으로 파싱해 `{host, port, username}` 반환

## 테스트

`src/__tests__/integration.test.ts` 는 **실제 gateway 연결을 필요** 로 하는 통합 테스트. `test.config.json` (gitignored) 에 호스트/유저 정보 기입 필요.

```bash
npm test    # vitest run
```

단위 테스트는 아직 없음. `runWithConcurrency` 같은 순수 함수는 유닛 테스트 가능.

## 확장 가이드

### 서브커맨드 추가

1. `src/commands/<name>.ts` 생성, `register<Name>Command(program: Command)` 를 export
2. `src/index.ts` 에서 import + 호출
3. 종료 시 `disconnect()` 호출 (시그널 핸들러 외 별도 finally 블록)

### 새 호스트 작업 패턴

여러 호스트 대상으로 작업하려면 **하나의 프로세스 안에서** 루프 돌려야 auth 비용 amortize 가 유효하다. 개별 `gw-ssh` 프로세스를 여러 번 띄우면 각 프로세스가 독립적으로 TCP/auth → 이득 없음.

## 외부 의존성

- `commander` — CLI 파싱
- `ssh2` — SSH client + SFTP
- devDep: `typescript`, `vitest`, `eslint` (+ sonarjs plugin), `@typescript-eslint/*`

의존성 최소 유지. 병렬성 제한 같은 단순 유틸은 직접 구현.

## 디버그

- `DEBUG=true gw-ssh ...` 로 실행된 원격 명령 / SCP 명령을 stderr 로 확인 가능 (`src/ssh.ts` 의 `process.env.DEBUG === "true"` 게이트)
- `gw-ssh status` 로 gateway 연결 + Kerberos 인증만 분리 테스트 가능

## 개발 규칙

@.claude/rules/readme-update.md
@.claude/rules/no-identifying-info.md
