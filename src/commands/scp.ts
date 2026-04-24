import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { uploadFile, downloadFile, isHostAllowed, disconnect } from "../ssh.js";
import { config } from "../config.js";

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

function checkHost(host: string): void {
  if (!isHostAllowed(host)) {
    const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
    console.error(`허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}`);
    process.exit(1);
  }
}

export function registerScpCommands(program: Command): void {
  program
    .command("upload <host> <remotePath>")
    .description("파일을 원격 서버에 업로드합니다 (Gateway 경유 SCP)")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .option("--content <text>", "업로드할 텍스트 내용")
    .option("--file <localFile>", "업로드할 로컬 파일 경로")
    .action(async (host: string, remotePath: string, opts: { user?: string; content?: string; file?: string }) => {
      const user = resolveUser(opts);
      checkHost(host);

      let content: Buffer;
      if (opts.file) {
        try {
          content = readFileSync(opts.file);
        } catch {
          console.error(`로컬 파일 읽기 실패: ${opts.file}`);
          process.exit(1);
        }
      } else if (opts.content !== undefined) {
        content = Buffer.from(opts.content, "utf-8");
      } else {
        console.error("--content 또는 --file 옵션이 필요합니다.");
        process.exit(1);
      }

      try {
        const { stderr } = await uploadFile(host, user, remotePath, content);
        console.log(`업로드 완료: ${user}@${host}:${remotePath}`);
        if (stderr) process.stderr.write(stderr);
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
    .description("원격 서버에서 파일을 다운로드합니다 (Gateway 경유 SCP)")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .option("-o, --output <localPath>", "로컬에 저장할 파일 경로")
    .action(async (host: string, remotePath: string, opts: { user?: string; output?: string }) => {
      const user = resolveUser(opts);
      checkHost(host);

      try {
        const { content, stderr } = await downloadFile(host, user, remotePath);

        if (opts.output) {
          validateLocalPath(opts.output);
          writeFileSync(opts.output, content);
          console.log(`다운로드 완료: ${user}@${host}:${remotePath} → ${opts.output}`);
        } else {
          process.stdout.write(content);
        }

        if (stderr) process.stderr.write(stderr);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`SCP 다운로드 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });
}
