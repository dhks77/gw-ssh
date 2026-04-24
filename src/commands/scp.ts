import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { uploadFile, uploadFileMulti, downloadFile, isHostAllowed, disconnect } from "../ssh.js";
import { config } from "../config.js";
import { runWithConcurrency } from "../parallel.js";

const DEFAULT_JOBS = 5;

interface HostResult {
  host: string;
  ok: boolean;
  error?: string;
  destination?: string;
}

function parseHosts(raw: string): string[] {
  return raw.split(",").map((h) => h.trim()).filter((h) => h.length > 0);
}

function validateLocalDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    throw new Error(`디렉토리가 존재하지 않습니다: ${dirPath}`);
  }
  if (!statSync(dirPath).isDirectory()) {
    throw new Error(`디렉토리가 아닙니다: ${dirPath}`);
  }
}

function validateLocalPath(localPath: string): void {
  const resolved = resolve(localPath);
  if (!existsSync(dirname(resolved))) {
    throw new Error(`디렉토리가 존재하지 않습니다: ${dirname(resolved)}`);
  }
}

function resolveUser(opts: { user?: string }): string {
  const user = opts.user || (config.serverInfo.user as string);
  if (!user) {
    console.error("사용자명이 필요합니다. -u 옵션 또는 config.json의 serverInfo.user를 설정하세요.");
    process.exit(1);
  }
  return user;
}

function assertHostsAllowed(hosts: string[]): void {
  for (const host of hosts) {
    if (!isHostAllowed(host)) {
      const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
      console.error(`허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}`);
      process.exit(1);
    }
  }
}

function reportSummary(results: HostResult[]): number {
  const failed = results.filter((r) => !r.ok);
  const ok = results.length - failed.length;

  if (failed.length === 0) {
    console.error(`✓ ${ok}/${results.length} 성공`);
    return 0;
  }

  const failSummary = failed.map((r) => `${r.host}: ${r.error ?? "unknown"}`).join("; ");
  console.error(`✗ ${ok}/${results.length} 성공 (실패: ${failSummary})`);
  return 1;
}

function readLocalUploadContent(opts: { content?: string; file?: string }): Buffer {
  if (opts.file) {
    try {
      return readFileSync(opts.file);
    } catch {
      console.error(`로컬 파일 읽기 실패: ${opts.file}`);
      process.exit(1);
    }
  }
  if (opts.content !== undefined) {
    return Buffer.from(opts.content, "utf-8");
  }
  console.error("--content 또는 --file 옵션이 필요합니다.");
  process.exit(1);
}

export function registerScpCommands(program: Command): void {
  program
    .command("upload <host> <remotePath>")
    .description("파일을 원격 서버에 업로드합니다 (<host> 에 CSV 지정 시 병렬 실행)")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .option("--content <text>", "업로드할 텍스트 내용")
    .option("--file <localFile>", "업로드할 로컬 파일 경로")
    .option("-j, --jobs <N>", "병렬 실행 동시성 (기본 5)", String(DEFAULT_JOBS))
    .action(async (hostArg: string, remotePath: string, opts: { user?: string; content?: string; file?: string; jobs?: string }) => {
      const user = resolveUser(opts);
      const hosts = parseHosts(hostArg);
      if (hosts.length === 0) {
        console.error("호스트를 하나 이상 지정해야 합니다.");
        process.exit(1);
      }
      assertHostsAllowed(hosts);

      const content = readLocalUploadContent(opts);

      try {
        if (hosts.length === 1) {
          const host = hosts[0];
          const { stderr } = await uploadFile(host, user, remotePath, content);
          console.log(`업로드 완료: ${user}@${host}:${remotePath}`);
          if (stderr) process.stderr.write(stderr);
          return;
        }

        // 병렬 모드: 로컬→gateway SFTP 는 1회만, gateway→target scp 만 fan-out
        const jobs = Math.max(1, Number(opts.jobs) || DEFAULT_JOBS);
        const multi = await uploadFileMulti(hosts, user, remotePath, content, jobs);

        const results: HostResult[] = multi.map((r) => {
          if (r.ok) {
            console.log(`[${r.host}] 업로드 완료 → ${remotePath}`);
            if (r.stderr) process.stderr.write(r.stderr);
          } else {
            console.error(`[${r.host}] 업로드 실패: ${r.error}`);
          }
          return { host: r.host, ok: r.ok, error: r.error };
        });

        const exitCode = reportSummary(results);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`SCP 업로드 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });

  program
    .command("download <host> <remotePath>")
    .description("원격 서버에서 파일을 다운로드합니다 (<host> 에 CSV 지정 시 병렬 실행)")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .option("-o, --output <localPath>", "저장 위치. 단일 호스트는 파일 경로, 다중 호스트는 디렉토리")
    .option("-j, --jobs <N>", "병렬 실행 동시성 (기본 5)", String(DEFAULT_JOBS))
    .action(async (hostArg: string, remotePath: string, opts: { user?: string; output?: string; jobs?: string }) => {
      const user = resolveUser(opts);
      const hosts = parseHosts(hostArg);
      if (hosts.length === 0) {
        console.error("호스트를 하나 이상 지정해야 합니다.");
        process.exit(1);
      }
      assertHostsAllowed(hosts);

      try {
        if (hosts.length === 1) {
          const host = hosts[0];
          const { content, stderr } = await downloadFile(host, user, remotePath);

          if (opts.output) {
            validateLocalPath(opts.output);
            writeFileSync(opts.output, content);
            console.log(`다운로드 완료: ${user}@${host}:${remotePath} → ${opts.output}`);
          } else {
            process.stdout.write(content);
          }

          if (stderr) process.stderr.write(stderr);
          return;
        }

        // 병렬 모드: 저장 디렉토리 필수
        if (!opts.output) {
          console.error("다중 호스트 다운로드는 -o/--output 에 저장 디렉토리를 지정해야 합니다.");
          process.exit(1);
        }
        const outDir = resolve(opts.output);
        validateLocalDir(outDir);

        const remoteBasename = basename(remotePath);
        if (!remoteBasename) {
          console.error(`원격 경로에서 파일명을 추출할 수 없습니다: ${remotePath}`);
          process.exit(1);
        }

        const jobs = Math.max(1, Number(opts.jobs) || DEFAULT_JOBS);
        const results = await runWithConcurrency<string, HostResult>(hosts, jobs, async (host) => {
          const localPath = join(outDir, `${host}-${remoteBasename}`);
          try {
            const { content, stderr } = await downloadFile(host, user, remotePath);
            writeFileSync(localPath, content);
            console.log(`[${host}] 다운로드 완료 → ${localPath}`);
            if (stderr) process.stderr.write(stderr);
            return { host, ok: true, destination: localPath };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`[${host}] 다운로드 실패: ${msg}`);
            return { host, ok: false, error: msg };
          }
        });

        const exitCode = reportSummary(results);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`SCP 다운로드 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });
}
