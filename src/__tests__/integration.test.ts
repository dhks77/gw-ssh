import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { setConfigPath } from "../config.js";
import { executeCommandStream, uploadFile, downloadFile, isHostAllowed, disconnect, testConnection } from "../ssh.js";

// 테스트 설정 로드 (test.config.json - gitignored)
const testConfigPath = resolve(import.meta.dirname, "../../test.config.json");
const testConfig = JSON.parse(readFileSync(testConfigPath, "utf-8")) as {
  host: string;
  user: string;
};

// 메인 config.json 경로 설정
setConfigPath(resolve(import.meta.dirname, "../../config.json"));

const { host, user } = testConfig;
const remoteTestFile = `/tmp/gw-ssh-test-${Date.now()}`;

afterAll(() => {
  disconnect();
});

describe("status", () => {
  it("Gateway 연결 및 Kerberos 인증", async () => {
    const result = await testConnection();
    expect(result.gateway).toBe(true);
    expect(result.kerberos).toBe(true);
  });
});

describe("exec", () => {
  it("hostname 실행", async () => {
    let stdout = "";
    await executeCommandStream(host, user, "hostname", (d) => { stdout += d; }, () => {});
    expect(stdout.trim()).toBe(host);
  });

  it("uptime 실행", async () => {
    let stdout = "";
    await executeCommandStream(host, user, "uptime", (d) => { stdout += d; }, () => {});
    expect(stdout).toContain("up");
  });

  it("스트리밍 출력 (여러 줄)", async () => {
    const lines: string[] = [];
    await executeCommandStream(
      host, user,
      'for i in 1 2 3; do echo "line $i"; done',
      (d) => { lines.push(...d.trim().split("\n")); },
      () => {},
    );
    expect(lines).toContain("line 1");
    expect(lines).toContain("line 2");
    expect(lines).toContain("line 3");
  });

  it("exit code 반환", async () => {
    const code = await executeCommandStream(host, user, "exit 42", () => {}, () => {});
    expect(code).toBe(42);
  });
});

describe("host 제한", () => {
  it("허용된 호스트", () => {
    expect(isHostAllowed(host)).toBe(true);
  });

  it("허용되지 않은 호스트", () => {
    expect(isHostAllowed("invalid-host-xxx")).toBe(false);
  });

  it("허용되지 않은 호스트로 exec 시 에러", async () => {
    await expect(
      executeCommandStream("invalid-host-xxx", user, "hostname", () => {}, () => {}),
    ).rejects.toThrow("허용되지 않은 호스트");
  });
});

describe("scp", () => {
  it("upload (content)", async () => {
    const { stderr } = await uploadFile(host, user, remoteTestFile, "gw-ssh test");
    expect(stderr).not.toContain("error");
  });

  it("download (content)", async () => {
    const { content } = await downloadFile(host, user, remoteTestFile);
    expect(content).toBe("gw-ssh test");
  });

  it("download → 로컬 파일 저장", async () => {
    const localPath = `/tmp/gw-ssh-local-test-${Date.now()}`;
    try {
      const { content } = await downloadFile(host, user, remoteTestFile);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(localPath, content);
      expect(existsSync(localPath)).toBe(true);
      expect(readFileSync(localPath, "utf-8")).toBe("gw-ssh test");
    } finally {
      if (existsSync(localPath)) unlinkSync(localPath);
    }
  });

  it("정리: 원격 테스트 파일 삭제", async () => {
    await executeCommandStream(host, user, `rm -f ${remoteTestFile}`, () => {}, () => {});
  });
});
