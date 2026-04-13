#!/usr/bin/env node

import { Command } from "commander";
import { setConfigPath } from "./config.js";
import { registerExecCommand } from "./commands/exec.js";
import { registerScpCommands } from "./commands/scp.js";
import { registerConfigCommands } from "./commands/config.js";
import { disconnect } from "./ssh.js";

const program = new Command();

program
  .name("gw-ssh")
  .description("SSH Gateway를 경유하여 원격 서버에 명령을 실행하고 파일을 전송하는 CLI 도구")
  .version("2.0.0")
  .option("-c, --config <path>", "설정 파일 경로 (기본: CONFIG_FILE 환경변수)")
  .hook("preAction", (thisCommand) => {
    const configPath = thisCommand.opts().config;
    if (configPath) {
      setConfigPath(configPath);
    }
  });

registerExecCommand(program);
registerScpCommands(program);
registerConfigCommands(program);

process.on("SIGINT", () => {
  disconnect();
  process.exit(0);
});

process.on("SIGTERM", () => {
  disconnect();
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  console.error("오류:", error.message);
  disconnect();
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("오류:", reason);
  disconnect();
  process.exit(1);
});

program.parse();
