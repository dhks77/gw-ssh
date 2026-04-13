import { Client } from "ssh2";
import type { SFTPWrapper } from "ssh2";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

const UNSAFE_PATTERN = /[;`$()&|><\n\r]/;
function validateShellArg(value: string, label: string): void {
  if (UNSAFE_PATTERN.test(value)) {
    throw new Error(`${label}에 허용되지 않은 문자가 포함되어 있습니다: ${value}`);
  }
}

let gatewayClient: Client | null = null;
let isKinitDone = false;

const DEFAULT_COMMAND_TIMEOUT_SEC = 300;

export function isHostAllowed(host: string): boolean {
  if (config.hosts.allowedHosts.length === 0) {
    return true;
  }
  return config.hosts.allowedHosts.includes(host);
}

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
        resolve(conn);
      })
      .on("error", (err) => {
        reject(new Error(`Gateway 연결 실패: ${err.message}`));
      })
      .on("close", () => {
        gatewayClient = null;
        isKinitDone = false;
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
  const sshCommand = `ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${user}@${host} "echo ${encoded} | base64 --decode | timeout -s TERM --kill-after=5 ${timeoutSec} bash"`;

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

function getGatewaySftp(conn: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) reject(new Error(`SFTP 세션 생성 실패: ${err.message}`));
      else resolve(sftp);
    });
  });
}

// SFTP로 Gateway에 파일 쓰기
function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath);
    stream.on("error", (err: Error) => reject(new Error(`SFTP 쓰기 실패: ${err.message}`)));
    stream.on("close", () => resolve());
    stream.end(content);
  });
}

// SFTP로 Gateway에서 파일 읽기
function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createReadStream(remotePath);
    let data = "";
    stream.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    stream.on("error", (err: Error) => reject(new Error(`SFTP 읽기 실패: ${err.message}`)));
    stream.on("end", () => resolve(data));
  });
}

export async function uploadFile(
  host: string,
  user: string,
  remotePath: string,
  content: string
): Promise<{ stdout: string; stderr: string }> {
  if (!isHostAllowed(host)) {
    throw new Error(`허용되지 않은 호스트: ${host}`);
  }

  validateShellArg(user, "사용자명");
  validateShellArg(remotePath, "원격 경로");

  const conn = await connectGateway();

  if (config.kerberos.password) {
    await executeKinit(conn);
  }

  const tempFile = `/tmp/gw-ssh-upload-${Date.now()}-${randomUUID()}`;

  try {
    // 1. Gateway에 임시파일 쓰기 (SFTP)
    const sftp = await getGatewaySftp(conn);
    await sftpWriteFile(sftp, tempFile, content);

    // 2. Gateway -> Target 서버로 scp
    const scpCommand = `scp -o StrictHostKeyChecking=no -o BatchMode=yes ${tempFile} ${user}@${host}:${remotePath}`;

    if (process.env.DEBUG === "true") {
      console.error(`[DEBUG] SCP 업로드: ${scpCommand}`);
    }

    const result = await execOnGateway(conn, scpCommand);

    if (result.code !== 0) {
      throw new Error(`SCP 실패 (code: ${result.code}): ${result.stderr}`);
    }

    return { stdout: result.stdout, stderr: result.stderr };
  } finally {
    // 3. Gateway 임시파일 삭제
    await execOnGateway(conn, `rm -f ${tempFile}`).catch(() => {});
  }
}

export async function downloadFile(
  host: string,
  user: string,
  remotePath: string
): Promise<{ content: string; stderr: string }> {
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
    // 1. Target 서버 -> Gateway로 scp
    const scpCommand = `scp -o StrictHostKeyChecking=no -o BatchMode=yes ${user}@${host}:${remotePath} ${tempFile}`;

    if (process.env.DEBUG === "true") {
      console.error(`[DEBUG] SCP 다운로드: ${scpCommand}`);
    }

    const result = await execOnGateway(conn, scpCommand);

    if (result.code !== 0) {
      throw new Error(`SCP 실패 (code: ${result.code}): ${result.stderr}`);
    }

    // 2. Gateway 임시파일 읽기 (SFTP)
    const sftp = await getGatewaySftp(conn);
    const content = await sftpReadFile(sftp, tempFile);

    return { content, stderr: result.stderr };
  } finally {
    // 3. Gateway 임시파일 삭제
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
  isKinitDone = false;
}

