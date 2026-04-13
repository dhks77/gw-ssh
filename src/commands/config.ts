import { Command } from "commander";
import { config } from "../config.js";
import { testConnection, disconnect } from "../ssh.js";

export function registerConfigCommands(program: Command): void {
  program
    .command("config")
    .description("현재 설정 정보를 출력합니다")
    .action(() => {
      console.log(JSON.stringify({
        gateway: `${config.gateway.username}@${config.gateway.host}:${config.gateway.port}`,
        allowedHosts: config.hosts.allowedHosts.length > 0
          ? config.hosts.allowedHosts
          : "(제한 없음)",
        serverInfo: config.serverInfo,
        commandTimeoutSec: config.commandTimeoutSec ?? 300,
      }, null, 2));
    });

  program
    .command("status")
    .description("Gateway 연결을 테스트합니다")
    .action(async () => {
      try {
        const result = await testConnection();
        console.log(`Gateway 연결: 성공`);
        console.log(`Kerberos 인증: ${result.kerberos ? "성공" : "미사용"}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Gateway 연결 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });
}
