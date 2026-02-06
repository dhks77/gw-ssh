# NHN Server MCP

SSH Gateway를 통해 서버에 접속하고 명령어를 실행하는 MCP (Model Context Protocol) 서버입니다.

## 기능

- SSH Gateway를 통한 서버 접속
- Kerberos 인증 (kinit) 지원
- 명령어 화이트리스트
- 위험 패턴 차단 (설정 가능)
- 서버 정보 조회 (AI가 로그 경로 등 확인 가능)
- 설정 동적 리로드

## 설치

```bash
npm install
npm run build
```

## 설정

### 1. config.json 생성

```json
{
  "gatewayConnection": "user@gateway.example.com:22",
  "gatewayPassword": "your-password",
  "kinitPassword": "your-kerberos-password",
  "allowedHosts": ["server1", "server2"],
  "blockedPatterns": [">", "`", "$(", ";", "&&", "||"],
  "allowedCommands": [
    "tail", "head", "cat", "grep", "ls", "ps", "whoami"
  ],
  "serverInfo": {
    "서버에 대한 user 정보 필수": "exec 할때 user 를 같이 보냅니다.",
    "나머지는": "원하는 내용으로",
    "ex - logPaths": {
      "app": "/var/log/app.log",
      "nginx": "/var/log/nginx/access.log"
    }
  }
}
```

### 2. 클라이언트 설정

#### Claude Code (CLI)

CLI 명령어로 등록:

```bash
# 프로젝트 단위 (해당 프로젝트에서만 사용)
claude mcp add --scope project nhn-server -e CONFIG_FILE=/path/to/config.json -e DEBUG=false -- node /path/to/nhn-server-mcp/dist/index.js

# 글로벌 (모든 프로젝트에서 사용)
claude mcp add --scope user nhn-server -e CONFIG_FILE=/path/to/config.json -e DEBUG=false -- node /path/to/nhn-server-mcp/dist/index.js
```

또는 직접 설정 파일을 편집할 수도 있습니다.

**프로젝트 단위** — 프로젝트 루트에 `.mcp.json` 생성:

```json
{
  "mcpServers": {
    "nhn-server": {
      "command": "node",
      "args": ["/path/to/nhn-server-mcp/dist/index.js"],
      "env": {
        "CONFIG_FILE": "/path/to/config.json",
        "DEBUG": "false"
      }
    }
  }
}
```

**글로벌** — `~/.claude.json`에 추가:

```json
{
  "mcpServers": {
    "nhn-server": {
      "command": "node",
      "args": ["/path/to/nhn-server-mcp/dist/index.js"],
      "env": {
        "CONFIG_FILE": "/path/to/config.json",
        "DEBUG": "false"
      }
    }
  }
}
```

> **`.mcp.json`** — 해당 프로젝트에서만 사용. git에 커밋하면 팀원과 공유 가능 (단, `config.json` 경로가 각자 다를 수 있으므로 주의)
>
> **`~/.claude.json`** — 모든 프로젝트에서 사용. 개인 환경 설정용

#### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "nhn-server": {
      "command": "node",
      "args": ["/path/to/nhn-server-mcp/dist/index.js"],
      "env": {
        "CONFIG_FILE": "/path/to/config.json",
        "DEBUG": "false"
      }
    }
  }
}
```

## 설정 옵션

| 키 | 설명 | 기본값 |
|---|---|---|
| `gatewayConnection` | Gateway SSH 연결 (user@host:port) | - |
| `gatewayPassword` | Gateway SSH 비밀번호 | - |
| `kinitPassword` | Kerberos 인증 비밀번호 | - |
| `allowedHosts` | 접속 허용 호스트 목록 | [] (모두 허용) |
| `allowedCommands` | 실행 허용 명령어 목록 | 기본 명령어 목록 |
| `blockedPatterns` | 차단할 패턴 목록 | `[">", "\`", "$(", ";", "&&", "\|\|"]` |
| `serverInfo` | AI에게 노출할 서버 정보 | {} |

### 환경변수

| 변수 | 설명 |
|---|---|
| `CONFIG_FILE` | config.json 파일 경로 |
| `DEBUG` | 디버그 로그 활성화 (`true`/`false`) |

## MCP 도구

### exec

서버에서 명령어를 실행합니다.

```json
{
  "host": "server-hostname",
  "user": "user",
  "command": "tail -100 /var/log/app.log"
}
```

### get_config

서버 설정 정보를 조회합니다. (허용 호스트, 명령어, 서버 정보)

### reload_config

설정 파일을 다시 로드합니다.

### disconnect_server

Gateway 연결을 종료합니다.

### connection_status

현재 연결 상태를 확인합니다.

## 보안

- **config.json**에 민감한 정보(비밀번호)가 포함되므로 git에 커밋하지 마세요
- `blockedPatterns`로 위험한 명령어 패턴을 차단합니다
- `allowedHosts`로 접속 가능한 서버를 제한합니다
- `allowedCommands`로 실행 가능한 명령어를 제한합니다
- 5분 비활성 시 자동 연결 종료

## 라이선스

MIT
