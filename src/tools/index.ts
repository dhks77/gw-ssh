import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerConnectTools } from "./connect.js";
import { registerExecTools } from "./exec.js";
import { registerConfigTools } from "./config.js";
import { registerScpTools } from "./scp.js";

export function registerAllTools(server: McpServer): void {
  registerConnectTools(server);
  registerExecTools(server);
  registerConfigTools(server);
  registerScpTools(server);
}
