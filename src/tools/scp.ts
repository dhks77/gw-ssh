import { z } from "zod";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { uploadFile, downloadFile, isHostAllowed } from "../ssh.js";
import { checkConfirmDialog } from "../dialog.js";
import { config } from "../config.js";

// localPath 검증: 절대경로 + 부모 디렉토리 존재 확인
function validateLocalPath(localPath: string): void {
  const resolved = resolve(localPath);
  if (resolved !== localPath) {
    throw new Error(`절대 경로를 사용해주세요: ${localPath}`);
  }
  if (!existsSync(dirname(resolved))) {
    throw new Error(`디렉토리가 존재하지 않습니다: ${dirname(resolved)}`);
  }
}

// 허용된 SCP 작업 캐시
const allowedScpOps = new Set<string>();

export function registerScpTools(server: McpServer): void {
  // 파일 업로드 Tool
  server.registerTool(
    "scp_upload",
    {
      description: "파일 내용을 서버에 업로드합니다. (Gateway 경유 SCP)",
      inputSchema: {
        host: z.string().describe("대상 서버 호스트명"),
        user: z.string().describe("SSH 접속 사용자명"),
        remotePath: z.string().describe("서버에 저장할 파일 경로"),
        content: z.string().describe("업로드할 파일 내용"),
      },
    },
    async ({ host, user, remotePath, content }) => {
      // 다이얼로그 확인
      const msg = `서버: ${user}@${host}\n작업: 업로드\n경로: ${remotePath}\n\n• 확인: 이번만 실행\n• 항상 허용: 이 작업은 다시 묻지 않음`;
      const { allowed } = checkConfirmDialog("MCP SCP 실행 확인", msg, `upload:${host}:${remotePath}`, allowedScpOps);

      if (!allowed) {
        return {
          content: [{ type: "text" as const, text: "사용자가 SCP 업로드를 취소했습니다." }],
          isError: true,
        };
      }

      // 호스트 확인
      if (!isHostAllowed(host)) {
        const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
        return {
          content: [{ type: "text" as const, text: `허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}` }],
          isError: true,
        };
      }

      try {
        const { stderr } = await uploadFile(host, user, remotePath, content);

        const parts = [`파일 업로드 완료: ${user}@${host}:${remotePath}`];
        if (stderr) parts.push(`[stderr]\n${stderr.trim()}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n\n") }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `SCP 업로드 실패: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // 파일 다운로드 Tool
  server.registerTool(
    "scp_download",
    {
      description: "서버에서 파일 내용을 다운로드합니다. (Gateway 경유 SCP)",
      inputSchema: {
        host: z.string().describe("대상 서버 호스트명"),
        user: z.string().describe("SSH 접속 사용자명"),
        remotePath: z.string().describe("다운로드할 파일 경로"),
        localPath: z.string().optional().describe("로컬에 저장할 파일 경로 (지정하면 파일로 저장, 미지정 시 내용만 반환)"),
      },
    },
    async ({ host, user, remotePath, localPath }) => {
      // 다이얼로그 확인
      const msg = `서버: ${user}@${host}\n작업: 다운로드\n경로: ${remotePath}\n\n• 확인: 이번만 실행\n• 항상 허용: 이 작업은 다시 묻지 않음`;
      const { allowed } = checkConfirmDialog("MCP SCP 실행 확인", msg, `download:${host}:${remotePath}`, allowedScpOps);

      if (!allowed) {
        return {
          content: [{ type: "text" as const, text: "사용자가 SCP 다운로드를 취소했습니다." }],
          isError: true,
        };
      }

      // 호스트 확인
      if (!isHostAllowed(host)) {
        const allowedList = config.hosts.allowedHosts.join(", ") || "(제한 없음)";
        return {
          content: [{ type: "text" as const, text: `허용되지 않은 호스트: ${host}\n허용된 호스트: ${allowedList}` }],
          isError: true,
        };
      }

      try {
        const { content, stderr } = await downloadFile(host, user, remotePath);

        // localPath가 지정되면 로컬에 파일 저장
        if (localPath) {
          validateLocalPath(localPath);
          writeFileSync(localPath, content);
          const parts = [`파일 다운로드 완료: ${user}@${host}:${remotePath} → ${localPath}`];
          if (stderr) parts.push(`[stderr]\n${stderr.trim()}`);
          return {
            content: [{ type: "text" as const, text: parts.join("\n\n") }],
          };
        }

        const parts = [`[파일: ${user}@${host}:${remotePath}]\n${content}`];
        if (stderr) parts.push(`[stderr]\n${stderr.trim()}`);

        return {
          content: [{ type: "text" as const, text: parts.join("\n\n") }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `SCP 다운로드 실패: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
