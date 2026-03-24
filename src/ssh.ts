import { Client } from "ssh2";
import { config } from "./config.js";

// Gateway 클라이언트 (재사용)
let gatewayClient: Client | null = null;
let isKinitDone = false;

// 세션 타임아웃 (5분)
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;
let sessionTimeoutId: NodeJS.Timeout | null = null;

// 타임아웃 리셋
function resetSessionTimeout(): void {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
  }
  sessionTimeoutId = setTimeout(() => {
    console.error("세션 타임아웃 (5분 비활성) - 연결 종료");
    disconnect();
  }, SESSION_TIMEOUT_MS);
}

// 타임아웃 정리
function clearSessionTimeout(): void {
  if (sessionTimeoutId) {
    clearTimeout(sessionTimeoutId);
    sessionTimeoutId = null;
  }
}

// 호스트 허용 여부 확인
export function isHostAllowed(host: string): boolean {
  if (config.hosts.allowedHosts.length === 0) {
    return true;
  }
  return config.hosts.allowedHosts.includes(host);
}

// Gateway 연결
function connectGateway(): Promise<Client> {
  return new Promise((resolve, reject) => {
    if (gatewayClient) {
      resolve(gatewayClient);
      return;
    }

    const conn = new Client();

    conn
      .on("ready", () => {
        gatewayClient = conn;
        console.error("Gateway 연결 성공");
        resolve(conn);
      })
      .on("error", (err) => {
        reject(new Error(`Gateway 연결 실패: ${err.message}`));
      })
      .on("close", () => {
        gatewayClient = null;
        isKinitDone = false;
        console.error("Gateway 연결 종료");
      })
      .connect({
        host: config.gateway.host,
        port: config.gateway.port,
        username: config.gateway.username,
        password: config.gateway.password,
      });
  });
}

// Gateway에서 명령 실행
function execOnGateway(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream
        .on("close", (code: number) => {
          resolve({ stdout, stderr, code: code || 0 });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

// kinit 실행
function executeKinit(conn: Client): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isKinitDone) {
      resolve();
      return;
    }

    if (!config.kerberos.password) {
      resolve();
      return;
    }

    conn.exec("kinit", { pty: true }, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let output = "";

      stream
        .on("close", (code: number) => {
          if (code === 0) {
            isKinitDone = true;
            console.error("kinit 인증 성공");
            resolve();
          } else {
            reject(new Error(`kinit 실패 (code: ${code}): ${output}`));
          }
        })
        .on("data", (data: Buffer) => {
          output += data.toString();
          if (output.includes("Password")) {
            stream.write(config.kerberos.password + "\n");
          }
        });
    });
  });
}

// 명령 실행 (host + user + command)
export async function executeCommand(host: string, user: string, command: string): Promise<{ stdout: string; stderr: string }> {
  if (!isHostAllowed(host)) {
    throw new Error(`허용되지 않은 호스트: ${host}`);
  }

  const conn = await connectGateway();

  if (config.kerberos.password) {
    await executeKinit(conn);
  }

  resetSessionTimeout();

  // Gateway에서 ssh로 target 서버에 명령 실행
  // Base64 인코딩으로 따옴표/특수문자 이슈 원천 방지
  const encoded = Buffer.from(command).toString('base64');
  const sshCommand = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${user}@${host} "echo ${encoded} | base64 --decode | bash"`;

  if (process.env.DEBUG === "true") {
    console.error(`[DEBUG] 실행: ${sshCommand}`);
  }

  const result = await execOnGateway(conn, sshCommand);

  if (process.env.DEBUG === "true") {
    console.error(`[DEBUG] stdout: ${result.stdout}`);
    console.error(`[DEBUG] stderr: ${result.stderr}`);
    console.error(`[DEBUG] code: ${result.code}`);
  }

  return { stdout: result.stdout, stderr: result.stderr };
}

// 연결 종료
export function disconnect(): void {
  clearSessionTimeout();

  if (gatewayClient) {
    gatewayClient.end();
    gatewayClient = null;
  }
  isKinitDone = false;
}

// 상태 확인 함수들
export function isConnected(): boolean {
  return gatewayClient !== null;
}

export function isAuthenticated(): boolean {
  return isKinitDone;
}
