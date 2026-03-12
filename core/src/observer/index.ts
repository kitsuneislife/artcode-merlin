import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../lib/logger";
import type { CommandResult, MerlinConfig, Snapshot } from "../lib/types";

function runCommand(command: string[], cwd: string): CommandResult {
  const started = Date.now();
  try {
    const proc = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const durationMs = Date.now() - started;
    return {
      command: command.join(" "),
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    return {
      command: command.join(" "),
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}

function getCommitDistanceAhead(forkPath: string, originalPath: string): number {
  const setRemote = Bun.spawnSync(["git", "remote", "add", "merlin-original", originalPath], {
    cwd: forkPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (setRemote.exitCode !== 0) {
    const updateRemote = Bun.spawnSync(["git", "remote", "set-url", "merlin-original", originalPath], {
      cwd: forkPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (updateRemote.exitCode !== 0) {
      throw new Error(`nao foi possivel configurar remote do original: ${updateRemote.stderr.toString()}`);
    }
  }

  const fetch = Bun.spawnSync(["git", "fetch", "merlin-original"], {
    cwd: forkPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (fetch.exitCode !== 0) {
    throw new Error(`falha ao buscar refs do original: ${fetch.stderr.toString()}`);
  }

  const currentBranchProc = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: forkPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (currentBranchProc.exitCode !== 0) {
    throw new Error(`falha ao resolver branch atual: ${currentBranchProc.stderr.toString()}`);
  }
  const currentBranch = currentBranchProc.stdout.toString().trim();

  const remoteHead = Bun.spawnSync(["git", "symbolic-ref", "refs/remotes/merlin-original/HEAD"], {
    cwd: forkPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  let baseRef = "merlin-original/main";
  if (remoteHead.exitCode === 0) {
    baseRef = remoteHead.stdout.toString().trim().replace("refs/remotes/", "");
  } else {
    const checkMain = Bun.spawnSync(["git", "rev-parse", "--verify", "merlin-original/main"], {
      cwd: forkPath,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (checkMain.exitCode !== 0) {
      const checkMaster = Bun.spawnSync(["git", "rev-parse", "--verify", "merlin-original/master"], {
        cwd: forkPath,
        stdout: "pipe",
        stderr: "pipe",
      });
      if (checkMaster.exitCode === 0) {
        baseRef = "merlin-original/master";
      }
    }
  }

  const distanceProc = Bun.spawnSync(["git", "rev-list", "--count", `${baseRef}..${currentBranch}`], {
    cwd: forkPath,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (distanceProc.exitCode !== 0) {
    throw new Error(`falha ao calcular distancia de commits: ${distanceProc.stderr.toString()}`);
  }

  return Number.parseInt(distanceProc.stdout.toString().trim(), 10);
}

export async function runObserver(config: MerlinConfig, logger: Logger): Promise<Snapshot> {
  const forkPath = config.target.fork;
  const originalPath = config.target.original;

  const test = runCommand(["cargo", "test", "--all"], forkPath);
  const clippy = runCommand(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"], forkPath);
  const bench = runCommand(["cargo", "bench"], forkPath);
  const commitDistanceAhead = getCommitDistanceAhead(forkPath, originalPath);

  const snapshot: Snapshot = {
    timestamp: new Date().toISOString(),
    forkPath,
    originalPath,
    commitDistanceAhead,
    test,
    clippy,
    bench,
  };

  await mkdir("/workspace/baselines", { recursive: true });
  const stamp = snapshot.timestamp.replace(/[.:]/g, "-");
  const outputPath = join("/workspace/baselines", `snapshot-${stamp}.json`);
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf8");

  logger.info("snapshot gerado", { outputPath, commitDistanceAhead });
  return snapshot;
}
