import { describe, expect, test } from "bun:test";
import { openPullRequest } from "../index";
import type { MerlinConfig, Plan, ValidatorResult } from "../../lib/types";

function makeConfig(): MerlinConfig {
  return {
    target: { original: "/workspace/original", fork: "/workspace/fork", branch_prefix: "stage" },
    llm: { provider: "ollama", model: "qwen2.5-coder:7b", base_url: "http://ollama:11434" },
    thresholds: { max_bench_regression_pct: 3, max_coverage_drop_pct: 1, clippy_zero_warnings: true },
    cycle: { auto_plan: true, auto_build: true, auto_pr: true, require_human_merge: true, interval_seconds: 300, max_iterations: 0 },
    stages: { max_concurrent: 1, stability_min_commits: 3 },
  };
}

function makePlan(): Plan {
  return {
    stage_id: "stage-test-001",
    target_crate: "parser",
    change_type: "fix",
    metric_target: "test_suite",
    expected_delta: "0%",
    rationale: "test",
    risk: "low",
  };
}

function makeValidatorResult(stable: boolean): ValidatorResult {
  return {
    stage_id: "stage-test-001",
    stable,
    reason: stable ? "stage validado" : "nao estavel",
    checks: {
      tests_pass: true,
      clippy_pass: true,
      bench_pass: true,
      bench_regression_within_threshold: true,
      invariants_pass: true,
      diff_scope_coherent: true,
      changelog_generated: true,
      stability_met: true,
    },
    stability: { consecutive_clean: 3, required_clean: 3 },
    benchmark: { baseline_ms: 100, current_ms: 100, regression_pct: 0, threshold_pct: 3, baseline_source: "existing" },
    benchmark_failures: [],
    invariant_failures: [],
    diff_failures: [],
  };
}

const dummyLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

describe("openPullRequest", () => {
  test("retorna opened=false quando stage nao esta estavel", async () => {
    const result = await openPullRequest(makeConfig(), makePlan(), makeValidatorResult(false), dummyLogger);
    expect(result.opened).toBe(false);
    expect(result.reason).toContain("nao esta estavel");
  });

  test("retorna opened=false quando GITHUB_TOKEN nao configurado", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const result = await openPullRequest(makeConfig(), makePlan(), makeValidatorResult(true), dummyLogger);
    expect(result.opened).toBe(false);
    expect(result.reason).toContain("GITHUB_TOKEN");

    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
  });

  test("retorna opened=false quando GITHUB_REPO_OWNER nao configurado", async () => {
    const originalToken = process.env.GITHUB_TOKEN;
    const originalOwner = process.env.GITHUB_REPO_OWNER;
    const originalName = process.env.GITHUB_REPO_NAME;
    process.env.GITHUB_TOKEN = "test-token";
    delete process.env.GITHUB_REPO_OWNER;
    delete process.env.GITHUB_REPO_NAME;

    const result = await openPullRequest(makeConfig(), makePlan(), makeValidatorResult(true), dummyLogger);
    expect(result.opened).toBe(false);
    expect(result.reason).toContain("GITHUB_REPO_OWNER");

    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
    else delete process.env.GITHUB_TOKEN;
    if (originalOwner !== undefined) process.env.GITHUB_REPO_OWNER = originalOwner;
    if (originalName !== undefined) process.env.GITHUB_REPO_NAME = originalName;
  });
});
