import { Client } from "ssh2";
import type { SFTPWrapper } from "ssh2";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { runWithConcurrency } from "./parallel.js";

const UNSAFE_PATTERN = /[;`$()&|><\n\r]/;
function validateShellArg(value: string, label: string): void {
  if (UNSAFE_PATTERN.test(value)) {
    throw new Error(`${label}에 허용되지 않은 문자가 포함되어 있습니다: ${value}`);
  }
}

let gatewayClient: Client | null = null;
let gatewayClientPromise: Promise<Client> | null = null;
let isKinitDone = false;
let kinitPromise: Promise<void> | null = null;
let gatewaySftp: SFTPWrapper | null = null;
let gatewaySftpPromise: Promise<SFTPWrapper> | null = null;

const DEFAULT_COMMAND_TIMEOUT_SEC = 300;

// LogLevel=ERROR: 대상 서버 sshd Banner(접속 경고문)가 stderr 로 섞이는 것을 차단
const SSH_OPTS = "-o StrictHostKeyChecking=no -o BatchMode=yes -o LogLevel=ERROR";

export function isHostAllowed(host: string): boolean {
  if (config.hosts.allowedHosts.length === 0) {
    return true;
  }
  return config.hosts.allowedHosts.includes(host);
}

function connectGateway(): Promise<Client> {
  if (gatewayClient) return Promise.resolve(gatewayClient);
  if (gatewayClientPromise) return gatewayClientPromise;

  gatewayClientPromise = new Promise((resolve, reject) => {
    const conn = new Client();

    conn
      .on("ready", () => {
        gatewayClient = conn;
        resolve(conn);
      })
      .on("error", (err) => {
        gatewayClientPromise = null;
        reject(new Error(`Gateway 연결 실패: ${err.message}`));
      })
      .on("close", () => {
        gatewayClient = null;
        gatewayClientPromise = null;
        gatewaySftp = null;
        gatewaySftpPromise = null;
        isKinitDone = false;
        kinitPromise = null;
      })
      .connect({
        host: config.gateway.host,
        port: config.gateway.port,
        username: config.gateway.username,
        password: config.gateway.password,
      });
  });

  return gatewayClientPromise;
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

// kinit 실행 (in-flight 중복 방지)
function executeKinit(conn: Client): Promise<void> {
  if (isKinitDone) return Promise.resolve();
  if (!config.kerberos.password) return Promise.resolve();
  if (kinitPromise) return kinitPromise;

  kinitPromise = new Promise((resolve, reject) => {
    conn.exec("kinit", { pty: true }, (err, stream) => {
      if (err) {
        kinitPromise = null;
        reject(err);
        return;
      }

      let output = "";

      stream
        .on("close", (code: number) => {
          if (code === 0) {
            isKinitDone = true;
            resolve();
          } else {
            kinitPromise = null;
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

  return kinitPromise;
}

export async function executeCommandStream(
  host: string,
  user: string,
  command: string,
  onStdout: (data: string) => void,
  onStderr: (data: string) => void,
): Promise<number> {
  if (!isHostAllowed(host)) {
    throw new Error(`허용되지 않은 호스트: ${host}`);
  }

  const conn = await connectGateway();

  if (config.kerberos.password) {
    await executeKinit(conn);
  }

  const timeoutSec = config.commandTimeoutSec ?? DEFAULT_COMMAND_TIMEOUT_SEC;
  const encoded = Buffer.from(command).toString('base64');
  const sshCommand = `ssh ${SSH_OPTS} ${user}@${host} "echo ${encoded} | base64 --decode | timeout -s TERM --kill-after=5 ${timeoutSec} bash"`;

  if (process.env.DEBUG === "true") {
    console.error(`[DEBUG] 실행: ${sshCommand}`);
  }

  return new Promise((resolve, reject) => {
    conn.exec(sshCommand, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      stream
        .on("close", (code: number) => {
          resolve(code || 0);
        })
        .on("data", (data: Buffer) => {
          onStdout(data.toString());
        })
        .stderr.on("data", (data: Buffer) => {
          onStderr(data.toString());
        });
    });
  });
}

/** conn 은 현재 싱글톤 gatewayClient 여야 함. 다른 인스턴스 전달 시 cache 가 stale 해짐. */
function getGatewaySftp(conn: Client): Promise<SFTPWrapper> {
  if (gatewaySftp) return Promise.resolve(gatewaySftp);
  if (gatewaySftpPromise) return gatewaySftpPromise;

  gatewaySftpPromise = new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) {
        gatewaySftpPromise = null;
        reject(new Error(`SFTP 세션 생성 실패: ${err.message}`));
        return;
      }
      gatewaySftp = sftp;
      sftp.on("close", () => {
        gatewaySftp = null;
        gatewaySftpPromise = null;
      });
      resolve(sftp);
    });
  });

  return gatewaySftpPromise;
}

// SFTP로 Gateway에 파일 쓰기 (Buffer 안전)
function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, content: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, (err) => {
      if (err) reject(new Error(`SFTP 쓰기 실패: ${err.message}`));
      else resolve();
    });
  });
}

// SFTP로 Gateway에서 파일 읽기 (Buffer 안전)
function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (err, data) => {
      if (err) reject(new Error(`SFTP 읽기 실패: ${err.message}`));
      else resolve(data);
    });
  });
}

/**
 * 단일 호스트 업로드. 실패 시 throw.
 * 내부 구현은 {@link uploadFileMulti} 에 위임해 파이프라인 로직 중복을 제거.
 */
export async function uploadFile(
  host: string,
  user: string,
  remotePath: string,
  content: Buffer,
): Promise<{ stderr: string }> {
  const [result] = await uploadFileMulti([host], user, remotePath, content, 1);
  if (!result.ok) {
    throw new Error(result.error ?? "SCP 업로드 실패");
  }
  return { stderr: result.stderr ?? "" };
}

export interface MultiUploadResult {
  host: string;
  ok: boolean;
  stderr?: string;
  error?: string;
}

/**
 * 여러 호스트에 같은 파일을 배포한다.
 *
 * 구조: 로컬→gateway SFTP **1회** 로 공용 임시파일 작성, gateway→target scp 만
 * `runWithConcurrency` 로 병렬 발사. 호스트 수만큼 payload 가 WAN 을 타지 않아
 * 로컬 대역폭 비용이 1/N 으로 amortize 된다.
 */
export async function uploadFileMulti(
  hosts: string[],
  user: string,
  remotePath: string,
  content: Buffer,
  concurrency: number,
): Promise<MultiUploadResult[]> {
  for (const host of hosts) {
    if (!isHostAllowed(host)) {
      throw new Error(`허용되지 않은 호스트: ${host}`);
    }
  }
  validateShellArg(user, "사용자명");
  validateShellArg(remotePath, "원격 경로");

  const conn = await connectGateway();

  if (config.kerberos.password) {
    await executeKinit(conn);
  }

  const tempFile = `/tmp/gw-ssh-upload-${Date.now()}-${randomUUID()}`;

  try {
    const sftp = await getGatewaySftp(conn);
    await sftpWriteFile(sftp, tempFile, content);

    return await runWithConcurrency<string, MultiUploadResult>(hosts, concurrency, async (host) => {
      const scpCommand = `scp ${SSH_OPTS} ${tempFile} ${user}@${host}:${remotePath}`;
      if (process.env.DEBUG === "true") {
        console.error(`[DEBUG] SCP 업로드: ${scpCommand}`);
      }
      try {
        const result = await execOnGateway(conn, scpCommand);
        if (result.code !== 0) {
          return { host, ok: false, error: `SCP 실패 (code: ${result.code}): ${result.stderr}` };
        }
        return { host, ok: true, stderr: result.stderr };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { host, ok: false, error: msg };
      }
    });
  } finally {
    await execOnGateway(conn, `rm -f ${tempFile}`).catch(() => {});
  }
}

export async function downloadFile(
  host: string,
  user: string,
  remotePath: string
): Promise<{ content: Buffer; stderr: string }> {
  if (!isHostAllowed(host)) {
    throw new Error(`허용되지 않은 호스트: ${host}`);
  }

  validateShellArg(user, "사용자명");
  validateShellArg(remotePath, "원격 경로");

  const conn = await connectGateway();

  if (config.kerberos.password) {
    await executeKinit(conn);
  }

  const tempFile = `/tmp/gw-ssh-download-${Date.now()}-${randomUUID()}`;

  try {
    const scpCommand = `scp ${SSH_OPTS} ${user}@${host}:${remotePath} ${tempFile}`;

    if (process.env.DEBUG === "true") {
      console.error(`[DEBUG] SCP 다운로드: ${scpCommand}`);
    }

    const result = await execOnGateway(conn, scpCommand);

    if (result.code !== 0) {
      throw new Error(`SCP 실패 (code: ${result.code}): ${result.stderr}`);
    }

    const sftp = await getGatewaySftp(conn);
    const content = await sftpReadFile(sftp, tempFile);

    return { content, stderr: result.stderr };
  } finally {
    await execOnGateway(conn, `rm -f ${tempFile}`).catch(() => {});
  }
}

export async function testConnection(): Promise<{ gateway: boolean; kerberos: boolean }> {
  const conn = await connectGateway();
  let kerberos = false;

  if (config.kerberos.password) {
    await executeKinit(conn);
    kerberos = true;
  }

  const { stdout } = await execOnGateway(conn, "echo ok");
  if (stdout.trim() !== "ok") {
    throw new Error(`Gateway 응답 이상: ${stdout.trim()}`);
  }

  return { gateway: true, kerberos };
}

export function disconnect(): void {
  if (gatewayClient) {
    gatewayClient.end();
    gatewayClient = null;
  }
  gatewayClientPromise = null;
  gatewaySftp = null;
  gatewaySftpPromise = null;
  isKinitDone = false;
  kinitPromise = null;
}

