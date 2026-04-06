import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeCommand, isHostAllowed } from "../ssh.js";
import { checkConfirmDialog } from "../dialog.js";
import { config } from "../config.js";

// 허용된 명령어 캐시 (세션 동안 유지)
const allowedCommands = new Set<string>();

export function registerExecTools(server: McpServer): void {
  // 명령어 실행 Tool
  server.registerTool(
    "exec",
    {
      description: "서버에서 명령어를 실행합니다.",
      inputSchema: {
        host: z.string().describe("명령어를 실행할 서버 호스트명"),
        user: z.string().describe("SSH 접속 사용자명"),
        command: z.string().describe("실행할 명령어"),
      },
    },
    async ({ host, user, command }) => {
      // 다이얼로그 확인
      const message = `서버: ${user}@${host}\n명령어: ${command}\n\n• 확인: 이번만 실행\n• 항상 허용: 이 명령은 다시 묻지 않음`;
      const { allowed } = checkConfirmDialog("MCP 명령 실행 확인", message, command, allowedCommands);

      if (!allowed) {
        return {
          content: [{ type: "text" as const, text: "사용자가 명령어 실행을 취소했습니다." }],
          isError: true,
        };
      }

      // 호스트 허용 여부 확인
      if (!isHostAllowed(host)) {
        const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
        return {
          content: [{ type: "text" as const, text: `허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}` }],
          isError: true,
        };
      }

      try {
        const { stdout, stderr } = await executeCommand(host, user, command);

        const parts: string[] = [];
        if (stdout) parts.push(`[stdout]\n${stdout.trim()}`);
        if (stderr) parts.push(`[stderr]\n${stderr.trim()}`);

        return {
          content: [{ type: "text" as const, text: parts.length > 0 ? parts.join("\n\n") : "(출력 없음)" }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `명령 실행 실패: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
