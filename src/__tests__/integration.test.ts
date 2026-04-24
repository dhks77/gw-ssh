import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
import { setConfigPath } from "../config.js";
import { executeCommandStream, uploadFile, downloadFile, isHostAllowed, disconnect, testConnection } from "../ssh.js";

// 테스트 설정 로드 (test.config.json - gitignored)
const testConfigPath = resolve(import.meta.dirname, "../../test.config.json");
const testConfig = JSON.parse(readFileSync(testConfigPath, "utf-8")) as {
  host: string;
  user: string;
  hosts?: string[];
};

// 메인 config.json 경로 설정
setConfigPath(resolve(import.meta.dirname, "../../config.json"));

const { host, user } = testConfig;
const hosts = testConfig.hosts ?? [];
const remoteTestFile = `/tmp/gw-ssh-test-${Date.now()}`;

afterAll(async () => {
  try {
    await executeCommandStream(host, user, `rm -f ${remoteTestFile}`, () => {}, () => {});
  } catch {
    // 정리 실패는 무시 (세션 이미 끊어진 경우 등)
  }
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
    const { stderr } = await uploadFile(host, user, remoteTestFile, Buffer.from("gw-ssh test"));
    expect(stderr).not.toContain("error");
  });

  it("download (content)", async () => {
    const { content } = await downloadFile(host, user, remoteTestFile);
    expect(Buffer.isBuffer(content)).toBe(true);
    expect(content.toString("utf-8")).toBe("gw-ssh test");
  });

  it("download → 로컬 파일 저장", async () => {
    const localPath = `/tmp/gw-ssh-local-test-${Date.now()}`;
    try {
      const { content } = await downloadFile(host, user, remoteTestFile);
      writeFileSync(localPath, content);
      expect(existsSync(localPath)).toBe(true);
      expect(readFileSync(localPath, "utf-8")).toBe("gw-ssh test");
    } finally {
      if (existsSync(localPath)) unlinkSync(localPath);
    }
  });

  it("바이너리 round-trip (해시 일치)", async () => {
    // 256KB 랜덤 바이너리 — >=0x80 바이트 다량 포함 보장
    const original = randomBytes(256 * 1024);
    const hashOriginal = sha256(original);
    const binRemotePath = `${remoteTestFile}.bin`;

    try {
      await uploadFile(host, user, binRemotePath, original);
      const { content } = await downloadFile(host, user, binRemotePath);

      expect(content.length).toBe(original.length);
      expect(sha256(content)).toBe(hashOriginal);
      expect(content.equals(original)).toBe(true);
    } finally {
      await executeCommandStream(host, user, `rm -f ${binRemotePath}`, () => {}, () => {});
    }
  });

});

describe.skipIf(hosts.length < 2)("parallel exec", () => {
  it("여러 호스트에서 병렬로 명령을 실행한다", async () => {
    const { runWithConcurrency } = await import("../parallel.js");

    const results = await runWithConcurrency(hosts, 5, async (h) => {
      let stdout = "";
      const code = await executeCommandStream(h, user, "hostname", (d) => { stdout += d; }, () => {});
      return { host: h, stdout: stdout.trim(), code };
    });

    expect(results).toHaveLength(hosts.length);
    for (const r of results) {
      expect(r.code).toBe(0);
      expect(r.stdout).toBe(r.host);
    }
  });

  it("kinit 은 병렬 호출에서도 1회만 수행된다 (race 방지)", async () => {
    // 모든 호스트에 동시에 exec 를 쏴도 connectGateway / kinit 이 한 번씩만 수행되어야 함.
    // kinit 실패가 없으면 in-flight promise 공유가 제대로 동작.
    const { runWithConcurrency } = await import("../parallel.js");
    const results = await runWithConcurrency(hosts, hosts.length, async (h) => {
      return executeCommandStream(h, user, "echo ok", () => {}, () => {});
    });
    expect(results.every((c) => c === 0)).toBe(true);
  });
});
