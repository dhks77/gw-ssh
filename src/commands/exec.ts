import { Command } from "commander";
import { executeCommandStream, isHostAllowed, disconnect } from "../ssh.js";
import { config } from "../config.js";

export function registerExecCommand(program: Command): void {
  program
    .command("exec <host> <command>")
    .description("원격 서버에서 명령어를 실행합니다")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .action(async (host: string, command: string, opts: { user?: string }) => {
      const user = opts.user || (config.serverInfo.user as string);
      if (!user) {
        console.error("사용자명이 필요합니다. -u 옵션 또는 config.json의 serverInfo.user를 설정하세요.");
        process.exit(1);
      }

      if (!isHostAllowed(host)) {
        const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
        console.error(`허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}`);
        process.exit(1);
      }

      try {
        const code = await executeCommandStream(
          host, user, command,
          (data) => process.stdout.write(data),
          (data) => process.stderr.write(data),
        );
        if (code !== 0) process.exit(code);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`명령 실행 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });
}
