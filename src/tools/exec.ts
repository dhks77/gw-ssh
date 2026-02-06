import { z } from "zod";
import { execSync } from "child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeCommand, isHostAllowed } from "../ssh.js";
import { config } from "../config.js";

// 허용된 명령어 캐시 (세션 동안 유지)
const allowedCommands = new Set<string>();

// 다이얼로그 결과
interface DialogResult {
  confirmed: boolean;
  allowForAll: boolean;
}

// macOS 다이얼로그로 명령어 실행 확인
function showConfirmDialog(host: string, user: string, command: string): DialogResult {
  // 특수문자 이스케이프
  const escapeForAppleScript = (str: string) =>
    str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

  const message = escapeForAppleScript(
    `서버: ${user}@${host}\n명령어: ${command}\n\n• 확인: 이번만 실행\n• 항상 허용: 이 명령은 다시 묻지 않음`
  );

  // 버튼 3개로 한 번에 처리
  const script = `
    tell application "System Events"
      activate
      set dialogResult to display dialog "${message}" buttons {"취소", "확인", "항상 허용"} default button "확인" with title "MCP 명령 실행 확인"
      return button returned of dialogResult
    end tell
  `;

  try {
    const result = execSync(`osascript -e '${script}'`, { stdio: "pipe", encoding: "utf-8" });
    const button = result.trim();

    if (button === "취소") {
      return { confirmed: false, allowForAll: false };
    } else if (button === "항상 허용") {
      return { confirmed: true, allowForAll: true };
    } else {
      return { confirmed: true, allowForAll: false };
    }
  } catch {
    return { confirmed: false, allowForAll: false }; // ESC 또는 에러
  }
}

export function registerExecTools(server: McpServer): void {
  // 명령어 실행 Tool
  server.registerTool(
    "exec",
    {
      description: "서버에서 명령어를 실행합니다.",
      inputSchema: {
        host: z.string().describe("명령어를 실행할 서버 호스트명"),
        user: z.string().describe("SSH 접속 사용자명 (예: irteam, irteamsu)"),
        command: z.string().describe("실행할 명령어"),
      },
    },
    async ({ host, user, command }) => {
      // 다이얼로그 확인 (설정이 켜져 있을 때)
      if (config.ui.confirmDialog) {
        // 이미 허용된 명령어인지 확인
        if (!allowedCommands.has(command)) {
          const result = showConfirmDialog(host, user, command);

          if (!result.confirmed) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "사용자가 명령어 실행을 취소했습니다.",
                },
              ],
              isError: true,
            };
          }

          // "모든 호스트 허용" 선택 시 캐시에 저장
          if (result.allowForAll) {
            allowedCommands.add(command);
            if (process.env.DEBUG === "true") {
              console.error(`[DEBUG] 명령어 허용 목록에 추가됨: ${command}`);
            }
          }
        } else if (process.env.DEBUG === "true") {
          console.error(`[DEBUG] 이미 허용된 명령어: ${command}`);
        }
      }

      // 호스트 허용 여부 확인
      if (!isHostAllowed(host)) {
        const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
        return {
          content: [
            {
              type: "text" as const,
              text: `허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}`,
            },
          ],
          isError: true,
        };
      }

      try {
        const { stdout, stderr } = await executeCommand(host, user, command);

        const parts: string[] = [];
        if (stdout) {
          parts.push(`[stdout]\n${stdout.trim()}`);
        }
        if (stderr) {
          parts.push(`[stderr]\n${stderr.trim()}`);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: parts.length > 0 ? parts.join("\n\n") : "(출력 없음)",
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `명령 실행 실패: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
