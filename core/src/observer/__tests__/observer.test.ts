import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runObserver } from "../index";
import type { MerlinConfig } from "../../lib/types";

const dummyLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

function makeConfig(fork: string, original: string): MerlinConfig {
  return {
    target: { original, fork, branch_prefix: "stage" },
    llm: { provider: "ollama", model: "test", base_url: "http://localhost:11434" },
    thresholds: { max_bench_regression_pct: 3, max_coverage_drop_pct: 1, clippy_zero_warnings: true },
    cycle: { auto_plan: true, auto_build: true, auto_pr: false, require_human_merge: true, interval_seconds: 300, max_iterations: 0 },
    stages: { max_concurrent: 1, stability_min_commits: 3 },
  };
}

function initGitRepo(dir: string, name = "Test", email = "test@test.test"): void {
  Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "config", "user.name", name], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "config", "user.email", email], { cwd: dir, stdout: "pipe", stderr: "pipe" });
}

describe("runObserver", () => {
  test("gera snapshot com estrutura correta para git repos simples", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-obs-"));
    const originalDir = join(tmp, "original");
    const forkDir = join(tmp, "fork");

    // Create original repo with one commit
    initGitRepo(originalDir);
    await writeFile(join(originalDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });

    // Clone to fork and add a commit ahead
    Bun.spawnSync(["git", "clone", originalDir, forkDir], { stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "config", "user.email", "test@test.test"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    await writeFile(join(forkDir, "extra.txt"), "extra", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "fork ahead"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir, originalDir);
    const snapshot = await runObserver(config, dummyLogger);

    expect(snapshot.timestamp).toBeTruthy();
    expect(snapshot.forkPath).toBe(forkDir);
    expect(snapshot.originalPath).toBe(originalDir);
    expect(snapshot.commitDistanceAhead).toBe(1);
    expect(snapshot.test).toHaveProperty("exitCode");
    expect(snapshot.test).toHaveProperty("command");
    expect(snapshot.test).toHaveProperty("durationMs");
    expect(snapshot.clippy).toHaveProperty("exitCode");
    expect(snapshot.bench).toHaveProperty("exitCode");
  });

  test("calcula distancia zero quando fork e original estao alinhados", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-obs-"));
    const originalDir = join(tmp, "original");
    const forkDir = join(tmp, "fork");

    initGitRepo(originalDir);
    await writeFile(join(originalDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });

    Bun.spawnSync(["git", "clone", originalDir, forkDir], { stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir, originalDir);
    const snapshot = await runObserver(config, dummyLogger);

    expect(snapshot.commitDistanceAhead).toBe(0);
  });

  test("snapshot contem campos de CommandResult validos", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-obs-"));
    const originalDir = join(tmp, "original");
    const forkDir = join(tmp, "fork");

    initGitRepo(originalDir);
    await writeFile(join(originalDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: originalDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "clone", originalDir, forkDir], { stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir, originalDir);
    const snapshot = await runObserver(config, dummyLogger);

    // cargo commands will fail (no Rust project) but CommandResult structure is valid
    for (const gate of [snapshot.test, snapshot.clippy, snapshot.bench]) {
      expect(typeof gate.command).toBe("string");
      expect(typeof gate.exitCode).toBe("number");
      expect(typeof gate.stdout).toBe("string");
      expect(typeof gate.stderr).toBe("string");
      expect(typeof gate.durationMs).toBe("number");
      expect(gate.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});
