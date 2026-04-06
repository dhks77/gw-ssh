import { execSync } from "node:child_process";
import { config } from "./config.js";

export interface DialogResult {
  confirmed: boolean;
  allowForAll: boolean;
}

const escapeForAppleScript = (str: string) =>
  str.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n");

// macOS 네이티브 다이얼로그 표시
function showDialog(title: string, message: string): DialogResult {
  const escaped = escapeForAppleScript(message);

  const script = `
    tell application "System Events"
      activate
      set dialogResult to display dialog "${escaped}" buttons {"취소", "확인", "항상 허용"} default button "확인" with title "${escapeForAppleScript(title)}"
      return button returned of dialogResult
    end tell
  `;

  try {
    const result = execSync(`osascript -e '${script}'`, { stdio: "pipe", encoding: "utf-8" }); // NOSONAR: intentional OS command
    const button = result.trim();

    if (button === "취소") return { confirmed: false, allowForAll: false };
    if (button === "항상 허용") return { confirmed: true, allowForAll: true };
    return { confirmed: true, allowForAll: false };
  } catch {
    return { confirmed: false, allowForAll: false };
  }
}

// 다이얼로그 확인 + 캐시 처리 (confirmDialog 설정 off 시 항상 통과)
export function checkConfirmDialog(
  title: string,
  message: string,
  cacheKey: string,
  cache: Set<string>
): { allowed: boolean } {
  if (!config.ui.confirmDialog) {
    return { allowed: true };
  }

  if (cache.has(cacheKey)) {
    return { allowed: true };
  }

  const result = showDialog(title, message);

  if (!result.confirmed) {
    return { allowed: false };
  }

  if (result.allowForAll) {
    cache.add(cacheKey);
  }

  return { allowed: true };
}
