import { Command } from "commander";
import { config } from "../config.js";
import { isHostAllowed } from "../ssh.js";
import { matchHostGroups, resolveEnv } from "../hostInfo.js";
import { parseHosts } from "./common.js";

export function registerInfoCommand(program: Command): void {
  program
    .command("info")
    .description("호스트에 매칭되는 hostGroups 와 serverInfo 를 출력합니다 (<host> 에 CSV 지정 가능, 접속하지 않음)")
    .argument("<host>", "호스트명 (CSV 가능)")
    .action((rawHosts: string) => {
      const hosts = parseHosts(rawHosts).map((host) => {
        const matched = matchHostGroups(host, config.hostGroups);
        return {
          host,
          env: resolveEnv(matched),
          allowed: isHostAllowed(host),
          hostGroups: Object.fromEntries(matched.map((m) => [m.pattern, m.group])),
        };
      });
      console.log(JSON.stringify({ hosts, serverInfo: config.serverInfo }, null, 2));
    });
}
