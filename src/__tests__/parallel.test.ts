import { describe, it, expect } from "vitest";
import { runWithConcurrency } from "../parallel.js";

describe("runWithConcurrency", () => {
  it("모든 아이템을 처리하고 결과 순서를 보존한다", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await runWithConcurrency(items, 2, async (x) => x * 10);
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("동시성 상한을 초과하지 않는다", async () => {
    let running = 0;
    let maxRunning = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);

    await runWithConcurrency(items, 3, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    });

    expect(maxRunning).toBeLessThanOrEqual(3);
    expect(maxRunning).toBeGreaterThan(1);
  });

  it("빈 배열도 처리한다", async () => {
    const results = await runWithConcurrency<number, number>([], 5, async (x) => x);
    expect(results).toEqual([]);
  });

  it("limit 이 items 길이보다 커도 정상 동작", async () => {
    const results = await runWithConcurrency([1, 2], 10, async (x) => x + 100);
    expect(results).toEqual([101, 102]);
  });

  it("첫 번째 에러가 던져지면 실패를 전파한다", async () => {
    await expect(
      runWithConcurrency([1, 2, 3], 2, async (x) => {
        if (x === 2) throw new Error("boom");
        return x;
      }),
    ).rejects.toThrow("boom");
  });
});
