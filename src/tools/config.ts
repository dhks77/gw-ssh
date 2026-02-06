import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { config, reloadConfig } from "../config.js";

export function registerConfigTools(server: McpServer): void {
  // 설정 조회 Tool (AI가 로그 경로, 허용 호스트 등 확인용)
  server.registerTool(
    "get_config",
    {
      description: "서버 설정 정보를 조회합니다. 허용된 호스트, 서버 정보 등을 확인할 수 있습니다.",
    },
    async () => {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                allowedHosts: config.hosts.allowedHosts.length > 0
                  ? config.hosts.allowedHosts
                  : "(제한 없음 - 모든 호스트 허용)",
                serverInfo: config.serverInfo
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 설정 재로드 Tool
  server.registerTool(
    "reload_config",
    {
      description: "서버 설정을 다시 로드합니다. SERVER_INFO_FILE 등이 변경되었을 때 사용합니다.",
    },
    async () => {
      try {
        reloadConfig();
        return {
          content: [
            {
              type: "text" as const,
              text: "설정이 재로드되었습니다.",
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `설정 재로드 실패: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
