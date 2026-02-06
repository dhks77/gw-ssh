import { readFileSync } from "fs";

// Gateway SSH 설정
export interface GatewayConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

// Kerberos 설정
export interface KerberosConfig {
  password: string;
}

// 호스트 설정
export interface HostConfig {
  allowedHosts: string[];
}

// 서버 정보 (AI에게 노출되는 정보)
export interface ServerInfo {
  [key: string]: unknown;
}

// UI 설정
export interface UIConfig {
  confirmDialog: boolean; // 명령 실행 전 다이얼로그 확인
}

// 전체 설정
export interface Config {
  gateway: GatewayConfig;
  kerberos: KerberosConfig;
  hosts: HostConfig;
  serverInfo: ServerInfo;
  ui: UIConfig;
}

// CONFIG_FILE 로드
function loadConfigFile(): Record<string, unknown> {
  const configPath = process.env.CONFIG_FILE;
  if (!configPath) {
    return {};
  }
  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    console.error("CONFIG_FILE 읽기 실패:", err);
    return {};
  }
}

// Gateway 설정 파싱
function parseGatewayConfig(configFile: Record<string, unknown>): GatewayConfig {
  const connection = (configFile.gatewayConnection as string) || "root@localhost:22";
  const password = (configFile.gatewayPassword as string) || "";

  const match = connection.match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
  if (!match) {
    throw new Error(
      `잘못된 gatewayConnection 형식: ${connection} (올바른 형식: user@host:port)`
    );
  }

  return {
    username: match[1],
    host: match[2],
    port: parseInt(match[3] || "22", 10),
    password,
  };
}

// Kerberos 설정 파싱
function parseKerberosConfig(configFile: Record<string, unknown>): KerberosConfig {
  return {
    password: (configFile.kinitPassword as string) || "",
  };
}

// 호스트 설정 파싱
function parseHostConfig(configFile: Record<string, unknown>): HostConfig {
  let allowedHosts: string[] = [];
  if (Array.isArray(configFile.allowedHosts)) {
    allowedHosts = configFile.allowedHosts as string[];
  }

  return {
    allowedHosts,
  };
}

// serverInfo 파싱 (AI에게 노출되는 정보)
function parseServerInfo(configFile: Record<string, unknown>): ServerInfo {
  const serverInfo = configFile.serverInfo as Record<string, unknown> | undefined;
  return serverInfo || {};
}

// UI 설정 파싱
function parseUIConfig(configFile: Record<string, unknown>): UIConfig {
  return {
    confirmDialog: (configFile.confirmDialog as boolean) ?? true, // 기본값: true
  };
}

// 전체 설정 로드
export function loadConfig(): Config {
  const configFile = loadConfigFile();

  return {
    gateway: parseGatewayConfig(configFile),
    kerberos: parseKerberosConfig(configFile),
    hosts: parseHostConfig(configFile),
    serverInfo: parseServerInfo(configFile),
    ui: parseUIConfig(configFile),
  };
}

export let config = loadConfig();

// config 재로드
export function reloadConfig(): void {
  config = loadConfig();
  console.error("설정 재로드 완료");
}
