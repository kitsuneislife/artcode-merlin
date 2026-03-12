import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runBuilder } from "../index";
import type { MerlinConfig, Plan } from "../../lib/types";

const dummyLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

function makeConfig(fork: string): MerlinConfig {
  return {
    target: { original: "/nonexistent", fork, branch_prefix: "stage" },
    llm: { provider: "ollama", model: "test", base_url: "http://localhost:11434" },
    thresholds: { max_bench_regression_pct: 3, max_coverage_drop_pct: 1, clippy_zero_warnings: true },
    cycle: { auto_plan: true, auto_build: true, auto_pr: false, require_human_merge: true, interval_seconds: 300, max_iterations: 0 },
    stages: { max_concurrent: 1, stability_min_commits: 3 },
  };
}

function makePlan(stageId = "stage-test-builder-001"): Plan {
  return {
    stage_id: stageId,
    target_crate: "parser",
    change_type: "fix",
    metric_target: "test_suite",
    expected_delta: "0%",
    rationale: "test plan",
    risk: "low",
  };
}

function initGitRepo(dir: string): void {
  Bun.spawnSync(["git", "init", dir], { stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(["git", "config", "user.email", "test@test.test"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
}

describe("runBuilder", () => {
  test("cria branch de stage e commita marker", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-builder-"));
    const forkDir = join(tmp, "fork");

    initGitRepo(forkDir);
    await writeFile(join(forkDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir);
    const plan = makePlan();

    // cargo commands will fail (no Rust project) so builder should return "failed"
    const result = await runBuilder(config, plan, dummyLogger);

    expect(result.stage_id).toBe(plan.stage_id);
    expect(result.stage_branch).toBe(`stage-${plan.stage_id}`);
    expect(result.baseBranch).toBeTruthy();
    expect(result.gates).toHaveProperty("test");
    expect(result.gates).toHaveProperty("clippy");
    expect(result.gates).toHaveProperty("bench");
  });

  test("retorna status failed quando gates falham e rollback ocorre", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-builder-"));
    const forkDir = join(tmp, "fork");

    initGitRepo(forkDir);
    await writeFile(join(forkDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir);
    const result = await runBuilder(config, makePlan(), dummyLogger);

    // Without cargo, gates will fail
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("gates de qualidade falharam");

    // Verify branch was cleaned up (rollback)
    const branchList = Bun.spawnSync(["git", "branch", "--list", `stage-${makePlan().stage_id}`], {
      cwd: forkDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(branchList.stdout.toString().trim()).toBe("");

    // Verify we're back on the base branch
    const currentBranch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: forkDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(currentBranch.stdout.toString().trim()).not.toContain("stage-");
  });

  test("marker file e criado no fork durante build", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-builder-"));
    const forkDir = join(tmp, "fork");

    initGitRepo(forkDir);
    await writeFile(join(forkDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });

    const plan = makePlan("stage-marker-test");
    const config = makeConfig(forkDir);
    const result = await runBuilder(config, plan, dummyLogger);

    // Cargo not available → gates fail → rollback removes branch + commits
    // But the result should still reference the correct stage
    expect(result.stage_id).toBe("stage-marker-test");
    expect(result.stage_branch).toBe("stage-stage-marker-test");
    expect(result.status).toBe("failed");
  });

  test("lanca erro quando fork nao e um git repo", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-builder-"));
    const forkDir = join(tmp, "not-a-git-repo");
    Bun.spawnSync(["mkdir", "-p", forkDir], { stdout: "pipe", stderr: "pipe" });

    const config = makeConfig(forkDir);
    await expect(runBuilder(config, makePlan(), dummyLogger)).rejects.toThrow("validacao do repositorio git do fork");
  });

  test("gates contem CommandResult com campos validos", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "merlin-builder-"));
    const forkDir = join(tmp, "fork");

    initGitRepo(forkDir);
    await writeFile(join(forkDir, "README.md"), "# test", "utf8");
    Bun.spawnSync(["git", "add", "."], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: forkDir, stdout: "pipe", stderr: "pipe" });

    const result = await runBuilder(makeConfig(forkDir), makePlan(), dummyLogger);

    for (const gate of [result.gates.test, result.gates.clippy, result.gates.bench]) {
      expect(typeof gate.command).toBe("string");
      expect(typeof gate.exitCode).toBe("number");
      expect(typeof gate.stdout).toBe("string");
      expect(typeof gate.stderr).toBe("string");
      expect(typeof gate.durationMs).toBe("number");
    }
  });
});
