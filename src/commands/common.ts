import { isHostAllowed } from "../ssh.js";
import { config } from "../config.js";

export const DEFAULT_JOBS = 5;

export function parseHosts(raw: string): string[] {
  return [...new Set(raw.split(",").map((h) => h.trim()).filter((h) => h.length > 0))];
}

export function assertHostsAllowed(hosts: string[]): void {
  for (const host of hosts) {
    if (!isHostAllowed(host)) {
      const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
      console.error(`허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}`);
      process.exit(1);
    }
  }
}

export function resolveUser(opts: { user?: string }): string {
  const user = opts.user || (config.serverInfo.user as string);
  if (!user) {
    console.error("사용자명이 필요합니다. -u 옵션 또는 config.json의 serverInfo.user를 설정하세요.");
    process.exit(1);
  }
  return user;
}
