import { readFileSync } from "node:fs";

interface GatewayConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

interface KerberosConfig {
  password: string;
}

interface HostConfig {
  allowedHosts: string[];
}

interface ServerInfo {
  [key: string]: unknown;
}

export interface Config {
  gateway: GatewayConfig;
  kerberos: KerberosConfig;
  hosts: HostConfig;
  serverInfo: ServerInfo;
  commandTimeoutSec?: number;
}

let configFilePath: string | undefined;

export function setConfigPath(path: string): void {
  configFilePath = path;
}

function loadConfigFile(): Record<string, unknown> {
  const configPath = configFilePath || process.env.CONFIG_FILE;
  if (!configPath) {
    console.error("설정 파일 경로가 지정되지 않았습니다. --config 옵션 또는 CONFIG_FILE 환경변수를 사용하세요.");
    process.exit(1);
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error(`설정 파일 읽기 실패 (${configPath}):`, err);
    process.exit(1);
  }
}

function parseGatewayConfig(configFile: Record<string, unknown>): GatewayConfig {
  const connection = (configFile.gatewayConnection as string) || "";
  const password = (configFile.gatewayPassword as string) || "";

  if (!connection) {
    throw new Error("gatewayConnection이 설정되지 않았습니다.");
  }

  const match = /^([^@]+)@([^:]+)(?::(\d+))?$/.exec(connection);
  if (!match) {
    throw new Error(
      `잘못된 gatewayConnection 형식: ${connection} (올바른 형식: user@host:port)`
    );
  }

  return {
    username: match[1],
    host: match[2],
    port: Number.parseInt(match[3] || "22", 10),
    password,
  };
}

function parseKerberosConfig(configFile: Record<string, unknown>): KerberosConfig {
  return {
    password: (configFile.kinitPassword as string) || "",
  };
}

function parseHostConfig(configFile: Record<string, unknown>): HostConfig {
  let allowedHosts: string[] = [];
  if (Array.isArray(configFile.allowedHosts)) {
    allowedHosts = configFile.allowedHosts as string[];
  }
  return { allowedHosts };
}

function parseServerInfo(configFile: Record<string, unknown>): ServerInfo {
  return (configFile.serverInfo as Record<string, unknown>) || {};
}

function loadConfig(): Config {
  const configFile = loadConfigFile();

  return {
    gateway: parseGatewayConfig(configFile),
    kerberos: parseKerberosConfig(configFile),
    hosts: parseHostConfig(configFile),
    serverInfo: parseServerInfo(configFile),
    commandTimeoutSec: configFile.commandTimeoutSec as number | undefined,
  };
}

let _config: Config | null = null;

export const config = new Proxy({} as Config, {
  get: (_target, prop) => {
    _config ??= loadConfig();
    return Reflect.get(_config, prop);
  },
});
