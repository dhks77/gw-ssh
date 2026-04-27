import { Command } from "commander";
import { executeCommandStream, disconnect } from "../ssh.js";
import { runWithConcurrency } from "../parallel.js";
import { DEFAULT_JOBS, parseHosts, assertHostsAllowed, resolveUser } from "./common.js";

interface HostResult {
  host: string;
  code: number;
  error?: string;
}

function createLineWriter(host: string, sink: NodeJS.WriteStream): {
  write: (data: string) => void;
  flush: () => void;
} {
  let pending = "";
  return {
    write(data: string) {
      pending += data;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        sink.write(`[${host}] ${line}\n`);
      }
    },
    flush() {
      if (pending.length > 0) {
        sink.write(`[${host}] ${pending}\n`);
        pending = "";
      }
    },
  };
}

async function runSingle(host: string, user: string, command: string): Promise<number> {
  return executeCommandStream(
    host,
    user,
    command,
    (data) => process.stdout.write(data),
    (data) => process.stderr.write(data),
  );
}

async function runPrefixed(host: string, user: string, command: string): Promise<HostResult> {
  const out = createLineWriter(host, process.stdout);
  const err = createLineWriter(host, process.stderr);
  try {
    const code = await executeCommandStream(host, user, command, out.write, err.write);
    out.flush();
    err.flush();
    return { host, code };
  } catch (error) {
    out.flush();
    err.flush();
    const msg = error instanceof Error ? error.message : String(error);
    return { host, code: -1, error: msg };
  }
}

async function runBuffered(host: string, user: string, command: string): Promise<HostResult> {
  let outBuf = "";
  let errBuf = "";
  try {
    const code = await executeCommandStream(
      host,
      user,
      command,
      (d) => { outBuf += d; },
      (d) => { errBuf += d; },
    );
    process.stdout.write(`===== ${host} =====\n`);
    if (outBuf) process.stdout.write(outBuf.endsWith("\n") ? outBuf : outBuf + "\n");
    if (errBuf) process.stderr.write(errBuf.endsWith("\n") ? errBuf : errBuf + "\n");
    return { host, code };
  } catch (error) {
    process.stdout.write(`===== ${host} =====\n`);
    if (outBuf) process.stdout.write(outBuf);
    if (errBuf) process.stderr.write(errBuf);
    const msg = error instanceof Error ? error.message : String(error);
    return { host, code: -1, error: msg };
  }
}

function reportSummary(results: HostResult[]): number {
  const failed = results.filter((r) => r.code !== 0);
  const ok = results.length - failed.length;

  if (failed.length === 0) {
    console.error(`✓ ${ok}/${results.length} 성공`);
    return 0;
  }

  const failSummary = failed
    .map((r) => r.error ? `${r.host} error=${r.error}` : `${r.host} exit=${r.code}`)
    .join(", ");
  console.error(`✗ ${ok}/${results.length} 성공 (실패: ${failSummary})`);
  return 1;
}

export function registerExecCommand(program: Command): void {
  program
    .command("exec <host> <command>")
    .description("원격 서버에서 명령어를 실행합니다 (<host> 에 CSV 지정 시 병렬 실행)")
    .option("-u, --user <user>", "SSH 접속 사용자명")
    .option("-j, --jobs <N>", "병렬 실행 동시성 (기본 5)", String(DEFAULT_JOBS))
    .option("--buffered", "병렬 모드에서 호스트별로 출력을 모아 종료 시 한 번에 출력")
    .action(async (hostArg: string, command: string, opts: { user?: string; jobs?: string; buffered?: boolean }) => {
      const user = resolveUser(opts);
      const hosts = parseHosts(hostArg);

      if (hosts.length === 0) {
        console.error("호스트를 하나 이상 지정해야 합니다.");
        process.exit(1);
      }
      assertHostsAllowed(hosts);

      try {
        if (hosts.length === 1) {
          const code = await runSingle(hosts[0], user, command);
          if (code !== 0) process.exit(code);
          return;
        }

        const jobs = Math.max(1, Number(opts.jobs) || DEFAULT_JOBS);
        const runner = opts.buffered ? runBuffered : runPrefixed;
        const results = await runWithConcurrency(hosts, jobs, (host) => runner(host, user, command));

        const exitCode = reportSummary(results);
        if (exitCode !== 0) process.exit(exitCode);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`명령 실행 실패: ${msg}`);
        process.exit(1);
      } finally {
        disconnect();
      }
    });
}
