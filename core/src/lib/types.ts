export type MerlinConfig = {
  target: {
    original: string;
    fork: string;
    branch_prefix: string;
    fork_remote?: string;
  };
  llm: {
    provider: string;
    model: string;
    base_url: string;
  };
  thresholds: {
    max_bench_regression_pct: number;
    max_coverage_drop_pct: number;
    clippy_zero_warnings: boolean;
  };
  cycle: {
    auto_plan: boolean;
    auto_build: boolean;
    auto_pr: boolean;
    require_human_merge: boolean;
    interval_seconds: number;
    max_iterations: number;
  };
  stages: {
    max_concurrent: number;
    stability_min_commits: number;
  };
  contracts?: {
    checker_command?: string;
  };
};

export type CommandResult = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type Snapshot = {
  timestamp: string;
  forkPath: string;
  originalPath: string;
  commitDistanceAhead: number;
  test: CommandResult;
  clippy: CommandResult;
  bench: CommandResult;
};

export type Plan = {
  stage_id: string;
  target_crate: string;
  change_type: "optimization" | "refactor" | "fix";
  metric_target: string;
  expected_delta: string;
  rationale: string;
  risk: "low" | "medium" | "high";
};

export type GateReport = {
  test: CommandResult;
  clippy: CommandResult;
  bench: CommandResult;
};

export type BuilderResult = {
  status: "failed" | "committed";
  stage_id: string;
  stage_branch: string;
  reason: string;
  commit?: string;
  baseBranch: string;
  gates: GateReport;
};

export type ValidatorResult = {
  stage_id: string;
  stable: boolean;
  reason: string;
  checks: {
    tests_pass: boolean;
    clippy_pass: boolean;
    bench_pass: boolean;
    bench_regression_within_threshold: boolean;
    invariants_pass: boolean;
    diff_scope_coherent: boolean;
    changelog_generated: boolean;
    stability_met: boolean;
  };
  stability: {
    consecutive_clean: number;
    required_clean: number;
  };
  benchmark: {
    baseline_ms: number | null;
    current_ms: number;
    regression_pct: number | null;
    threshold_pct: number;
    baseline_source: "existing" | "bootstrapped" | "unavailable";
  };
  benchmark_failures: string[];
  invariant_failures: string[];
  diff_failures: string[];
};
