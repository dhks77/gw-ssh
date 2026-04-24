# gw-ssh

SSH Gateway를 경유하여 원격 서버에 명령을 실행하고 파일을 전송하는 CLI 도구입니다.

## 기능

- SSH Gateway를 경유한 원격 서버 명령 실행 (실시간 스트리밍 출력)
- Gateway 경유 SCP 파일 업로드/다운로드 (바이너리 무결성 보장)
- Kerberos 인증 (kinit) 지원
- 원격 명령어 타임아웃으로 프로세스 hang 방지
- 호스트 허용 목록으로 접속 제한

## 설치

```bash
npm install
npm run build
npm link        # gw-ssh 명령어 글로벌 등록
```

## 설정

### config.json 생성

```json
{
  "gatewayConnection": "user@gateway.example.com:22",
  "gatewayPassword": "your-password",
  "kinitPassword": "your-kerberos-password",
  "allowedHosts": ["server1", "server2"],
  "commandTimeoutSec": 300,
  "serverInfo": {
    "user": "default-ssh-user",
    "logPaths": {
      "app": "/var/log/app"
    }
  }
}
```

### 설정 파일 경로 지정

```bash
# 방법 1: 환경변수 (~/.zshrc 등에 추가)
export CONFIG_FILE=/path/to/config.json

# 방법 2: --config 옵션
gw-ssh -c /path/to/config.json <command>
```

## 설정 옵션

| 키 | 설명 | 기본값 |
|---|---|---|
| `gatewayConnection` | Gateway SSH 연결 (user@host:port) | 필수 |
| `gatewayPassword` | Gateway SSH 비밀번호 | 필수 |
| `kinitPassword` | Kerberos 인증 비밀번호 (미설정 시 kinit 생략) | - |
| `allowedHosts` | 접속 허용 호스트 목록 | [] (모두 허용) |
| `commandTimeoutSec` | 원격 명령어 타임아웃 (초). GNU timeout으로 래핑 | 300 |
| `serverInfo` | 서버 메타 정보 (user, logPaths 등) | {} |

### 환경변수

| 변수 | 설명 |
|---|---|
| `CONFIG_FILE` | config.json 파일 경로 |
| `DEBUG` | 디버그 로그 활성화 (`true`/`false`) |

## 사용법

### 명령 실행

```bash
gw-ssh exec <host> <command> [-u user]
```

```bash
# 서버 상태 확인
gw-ssh exec server1 "hostname"
gw-ssh exec server1 "uptime" -u appuser

# 로그 조회
gw-ssh exec server1 "tail -100 /var/log/app/app.log"
gw-ssh exec server1 "grep ERROR /var/log/app/app.log | tail -20"
```

`-u`를 생략하면 `serverInfo.user` 값을 사용합니다.

### 파일 업로드

```bash
gw-ssh upload <host> <remotePath> [options] [-u user]
```

```bash
# 텍스트 내용 직접 업로드
gw-ssh upload server1 /tmp/hello.txt --content "hello world"

# 로컬 파일 업로드 (바이너리 포함 - gzip, zip, 실행파일 등)
gw-ssh upload server1 /tmp/app.tar.gz --file ./app.tar.gz
```

### 파일 다운로드

```bash
gw-ssh download <host> <remotePath> [options] [-u user]
```

```bash
# 표준 출력으로 내용 확인
gw-ssh download server1 /etc/hosts

# 로컬 파일로 저장
gw-ssh download server1 /etc/hosts -o ./downloaded-hosts.txt

# 바이너리 파일도 무결성 유지 (gzip, zip, 실행파일 등)
gw-ssh download server1 /var/app/release.tar.gz -o ~/Downloads/release.tar.gz
```

### 설정 확인

```bash
gw-ssh config
```

### 연결 테스트

```bash
gw-ssh status
```

## 보안

- **config.json**에 민감한 정보(비밀번호)가 포함되므로 git에 커밋하지 마세요
- `allowedHosts`로 접속 가능한 서버를 제한합니다
- Base64 인코딩 + 셸 인젝션 방지 패턴으로 명령어 안전성 확보
- 예외 발생 시에도 SSH 세션 자동 정리

## 라이선스

MIT
