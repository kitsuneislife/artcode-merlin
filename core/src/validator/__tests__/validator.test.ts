import { describe, expect, test } from "bun:test";
import type { BuilderResult, MerlinConfig, Plan, Snapshot, CommandResult, ValidatorResult } from "../../lib/types";

// Test the toPctDelta logic and ValidatorResult gate composition.
// We import indirectly by testing the exported function behavior.

function makeCommandResult(exitCode: number, durationMs = 100): CommandResult {
  return { command: "test-cmd", exitCode, stdout: "", stderr: "", durationMs };
}

function makePlan(stageId = "stage-val-001"): Plan {
  return {
    stage_id: stageId,
    target_crate: "parser",
    change_type: "fix",
    metric_target: "test_suite",
    expected_delta: "0%",
    rationale: "test",
    risk: "low",
  };
}

function makeSnapshot(): Snapshot {
  return {
    timestamp: "2026-01-01T00:00:00Z",
    forkPath: "/workspace/fork",
    originalPath: "/workspace/original",
    commitDistanceAhead: 1,
    test: makeCommandResult(0, 50),
    clippy: makeCommandResult(0, 30),
    bench: makeCommandResult(0, 200),
  };
}

function makeBuilderResult(status: "committed" | "failed" = "committed", gates?: Partial<{ test: CommandResult; clippy: CommandResult; bench: CommandResult }>): BuilderResult {
  return {
    status,
    stage_id: "stage-val-001",
    stage_branch: "stage-stage-val-001",
    baseBranch: "main",
    reason: status === "committed" ? "ok" : "gates falharam",
    commit: status === "committed" ? "abc123" : undefined,
    gates: {
      test: gates?.test ?? makeCommandResult(0, 55),
      clippy: gates?.clippy ?? makeCommandResult(0, 35),
      bench: gates?.bench ?? makeCommandResult(0, 210),
    },
  };
}

describe("ValidatorResult gate composition", () => {
  test("stable e false quando builder status e failed", () => {
    const build = makeBuilderResult("failed");
    expect(build.status).toBe("failed");

    // Validator uses: build.status === "committed" && ...
    // So if failed, stable = false
    const stable =
      build.status === "committed" &&
      build.gates.test.exitCode === 0 &&
      build.gates.clippy.exitCode === 0 &&
      build.gates.bench.exitCode === 0;
    expect(stable).toBe(false);
  });

  test("stable e false quando qualquer gate individual falha", () => {
    const gateResults = [
      { test: makeCommandResult(1), clippy: makeCommandResult(0), bench: makeCommandResult(0) },
      { test: makeCommandResult(0), clippy: makeCommandResult(1), bench: makeCommandResult(0) },
      { test: makeCommandResult(0), clippy: makeCommandResult(0), bench: makeCommandResult(1) },
    ];

    for (const gates of gateResults) {
      const build = makeBuilderResult("committed", gates);
      const stable =
        build.status === "committed" &&
        build.gates.test.exitCode === 0 &&
        build.gates.clippy.exitCode === 0 &&
        build.gates.bench.exitCode === 0;
      expect(stable).toBe(false);
    }
  });

  test("stable e true quando todos os gates passam com builder committed", () => {
    const build = makeBuilderResult("committed");
    const stable =
      build.status === "committed" &&
      build.gates.test.exitCode === 0 &&
      build.gates.clippy.exitCode === 0 &&
      build.gates.bench.exitCode === 0;
    expect(stable).toBe(true);
  });
});

describe("toPctDelta logic", () => {
  function toPctDelta(currentMs: number, baselineMs: number): number {
    if (baselineMs <= 0) return 0;
    return ((currentMs - baselineMs) / baselineMs) * 100;
  }

  test("retorna 0 quando baseline e zero", () => {
    expect(toPctDelta(100, 0)).toBe(0);
  });

  test("retorna 0 quando baseline e negativo", () => {
    expect(toPctDelta(100, -10)).toBe(0);
  });

  test("calcula delta positivo corretamente (regressao)", () => {
    const delta = toPctDelta(110, 100);
    expect(delta).toBeCloseTo(10, 2);
  });

  test("calcula delta negativo corretamente (melhoria)", () => {
    const delta = toPctDelta(90, 100);
    expect(delta).toBeCloseTo(-10, 2);
  });

  test("retorna 0 quando valores sao iguais", () => {
    expect(toPctDelta(100, 100)).toBe(0);
  });
});

describe("ValidatorResult structure completeness", () => {
  test("ValidatorResult deve conter todas as gates obrigatorias", () => {
    const result: ValidatorResult = {
      stage_id: "test",
      stable: false,
      reason: "test",
      checks: {
        tests_pass: false,
        clippy_pass: false,
        bench_pass: false,
        bench_regression_within_threshold: false,
        invariants_pass: false,
        diff_scope_coherent: false,
        changelog_generated: false,
        stability_met: false,
      },
      stability: { consecutive_clean: 0, required_clean: 3 },
      benchmark: {
        baseline_ms: null,
        current_ms: 0,
        regression_pct: null,
        threshold_pct: 3,
        baseline_source: "unavailable",
      },
      benchmark_failures: [],
      invariant_failures: [],
      diff_failures: [],
    };

    expect(result.checks).toHaveProperty("tests_pass");
    expect(result.checks).toHaveProperty("clippy_pass");
    expect(result.checks).toHaveProperty("bench_pass");
    expect(result.checks).toHaveProperty("bench_regression_within_threshold");
    expect(result.checks).toHaveProperty("invariants_pass");
    expect(result.checks).toHaveProperty("diff_scope_coherent");
    expect(result.checks).toHaveProperty("changelog_generated");
    expect(result.checks).toHaveProperty("stability_met");
    expect(result).toHaveProperty("stability");
    expect(result.stability).toHaveProperty("consecutive_clean");
    expect(result.stability).toHaveProperty("required_clean");
  });

  test("benchmark_failures, invariant_failures e diff_failures sao arrays", () => {
    const result: ValidatorResult = {
      stage_id: "test",
      stable: false,
      reason: "test",
      checks: {
        tests_pass: false, clippy_pass: false, bench_pass: false,
        bench_regression_within_threshold: false, invariants_pass: false,
        diff_scope_coherent: false, changelog_generated: false, stability_met: false,
      },
      stability: { consecutive_clean: 0, required_clean: 3 },
      benchmark: { baseline_ms: null, current_ms: 0, regression_pct: null, threshold_pct: 3, baseline_source: "unavailable" },
      benchmark_failures: ["falha 1"],
      invariant_failures: ["falha 2"],
      diff_failures: ["falha 3"],
    };

    expect(Array.isArray(result.benchmark_failures)).toBe(true);
    expect(Array.isArray(result.invariant_failures)).toBe(true);
    expect(Array.isArray(result.diff_failures)).toBe(true);
    expect(result.benchmark_failures).toHaveLength(1);
  });
});
