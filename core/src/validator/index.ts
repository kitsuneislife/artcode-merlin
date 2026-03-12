import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { evaluateBenchRegression, loadOrBootstrapBenchBaseline } from "../baselines/benchBaseline";
import { runInvariantChecks } from "../contracts/checker";
import type { Logger } from "../lib/logger";
import type { BuilderResult, MerlinConfig, Plan, Snapshot, ValidatorResult } from "../lib/types";
import { evaluateStability } from "../stages/stability";
import { auditDiffAgainstOriginal, buildChangelog, readChangelogEntries } from "./audit";

function toPctDelta(currentMs: number, baselineMs: number): number {
  if (baselineMs <= 0) {
    return 0;
  }
  return ((currentMs - baselineMs) / baselineMs) * 100;
}

export async function runValidator(
  config: MerlinConfig,
  plan: Plan,
  snapshot: Snapshot,
  build: BuilderResult,
  logger: Logger,
  db?: Database,
): Promise<ValidatorResult> {
  const invariants = await runInvariantChecks(config, logger);
  const diffAudit = auditDiffAgainstOriginal(config);
  const stability = db ? evaluateStability(db, config.stages.stability_min_commits) : { stable: false, consecutiveClean: 0, requiredClean: config.stages.stability_min_commits };
  const testsPass = build.gates.test.exitCode === 0;
  const clippyPass = build.gates.clippy.exitCode === 0;
  const benchPass = build.gates.bench.exitCode === 0;
  const invariantsPass = invariants.pass;
  const diffScopeCoherent = diffAudit.coherent;
  const stabilityMet = stability.stable;

  let benchGatePass = false;
  let changelogGenerated = false;
  let benchBaselineMs: number | null = null;
  let benchRegressionPct: number | null = null;
  let baselineSource: "existing" | "bootstrapped" | "unavailable" = "unavailable";
  const benchmarkFailures: string[] = [];

  if (benchPass) {
    try {
      const baseline = await loadOrBootstrapBenchBaseline(snapshot.bench.durationMs, snapshot.timestamp);
      baselineSource = baseline.source;
      benchBaselineMs = baseline.baselineMs;

      const regression = evaluateBenchRegression(
        build.gates.bench.durationMs,
        baseline.baselineMs,
        config.thresholds.max_bench_regression_pct,
      );
      benchRegressionPct = regression.regressionPct;
      benchGatePass = regression.withinThreshold;

      if (!benchGatePass) {
        benchmarkFailures.push(
          `regressao de benchmark ${regression.regressionPct.toFixed(2)}% acima do limite ${regression.thresholdPct.toFixed(2)}%`,
        );
      }
    } catch (error) {
      benchmarkFailures.push(
        `falha ao avaliar baseline de benchmark: ${error instanceof Error ? error.message : String(error)}`,
      );
      benchGatePass = false;
    }
  } else {
    benchmarkFailures.push("cargo bench falhou; regressao nao pode ser avaliada");
  }

  const result: ValidatorResult = {
    stage_id: plan.stage_id,
    stable:
      build.status === "committed" &&
      testsPass &&
      clippyPass &&
      benchPass &&
      benchGatePass &&
      invariantsPass &&
      diffScopeCoherent &&
      stabilityMet,
    reason: "stage ainda nao atingiu criterio de estabilidade",
    checks: {
      tests_pass: testsPass,
      clippy_pass: clippyPass,
      bench_pass: benchPass,
      bench_regression_within_threshold: benchGatePass,
      invariants_pass: invariantsPass,
      diff_scope_coherent: diffScopeCoherent,
      changelog_generated: false,
      stability_met: stabilityMet,
    },
    stability: {
      consecutive_clean: stability.consecutiveClean,
      required_clean: stability.requiredClean,
    },
    benchmark: {
      baseline_ms: benchBaselineMs,
      current_ms: build.gates.bench.durationMs,
      regression_pct: benchRegressionPct,
      threshold_pct: config.thresholds.max_bench_regression_pct,
      baseline_source: baselineSource,
    },
    benchmark_failures: benchmarkFailures,
    invariant_failures: invariants.failures,
    diff_failures: diffAudit.failures,
  };

  if (!result.stable) {
    await mkdir("/workspace/stages/active", { recursive: true });
    await writeFile("/workspace/stages/active/validation-result.json", JSON.stringify(result, null, 2), "utf8");
    logger.warn("stage nao validado", { stageId: plan.stage_id, checks: result.checks });
    return result;
  }

  const stagesRoot = "/workspace/stages";
  const validatedDir = join(stagesRoot, "validated", plan.stage_id);
  await mkdir(validatedDir, { recursive: true });

  await copyFile(join(stagesRoot, "active", "plan.json"), join(validatedDir, "plan.json"));

  const metrics = {
    generated_at: new Date().toISOString(),
    stage_id: plan.stage_id,
    commit_distance_ahead: snapshot.commitDistanceAhead,
    duration_ms: {
      test: build.gates.test.durationMs,
      clippy: build.gates.clippy.durationMs,
      bench: build.gates.bench.durationMs,
    },
    delta_pct_vs_observer: {
      test: toPctDelta(build.gates.test.durationMs, snapshot.test.durationMs),
      clippy: toPctDelta(build.gates.clippy.durationMs, snapshot.clippy.durationMs),
      bench: toPctDelta(build.gates.bench.durationMs, snapshot.bench.durationMs),
    },
    baseline_bench_gate: result.benchmark,
  };

  const commitRange = {
    stage_id: plan.stage_id,
    branch: build.baseBranch,
    from: "HEAD~1",
    to: build.commit ?? "HEAD",
    stage_branch: build.stage_branch,
  };

  const testResults = {
    test: build.gates.test,
    clippy: build.gates.clippy,
    bench: build.gates.bench,
    benchmark_gate: result.benchmark,
    benchmark_failures: result.benchmark_failures,
    invariants,
    diff_audit: diffAudit,
  };

  const changelogEntries = readChangelogEntries(config.target.fork, commitRange.from, commitRange.to);
  const changelog = buildChangelog(plan.stage_id, changelogEntries);
  changelogGenerated = true;
  result.checks.changelog_generated = changelogGenerated;

  const report = [
    `# Stage ${plan.stage_id}`,
    "",
    "## Resultado",
    "",
    "- Status: VALIDATED",
    `- Branch base: ${build.baseBranch}`,
    `- Commit final: ${build.commit ?? "n/a"}`,
    `- Alvo: ${plan.target_crate}`,
    `- Tipo: ${plan.change_type}`,
    "",
    "## Gates",
    "",
    `- cargo test --all: exit ${build.gates.test.exitCode}`,
    `- cargo clippy: exit ${build.gates.clippy.exitCode}`,
    `- cargo bench: exit ${build.gates.bench.exitCode}`,
    `- benchmark gate: ${benchGatePass ? "pass" : "fail"}`,
    `- invariants: ${invariantsPass ? "pass" : "fail"}`,
    `- diff scope coherent: ${diffScopeCoherent ? "pass" : "fail"}`,
    `- stability met: ${stabilityMet ? "pass" : "fail"} (${stability.consecutiveClean}/${stability.requiredClean} commits limpos)`,
    `- changelog generated: ${changelogGenerated ? "yes" : "no"}`,
    "",
    "## Notas",
    "",
    `- Invariantes verificados: ${invariants.checkedPrograms}`,
    `- Baseline bench source: ${result.benchmark.baseline_source}`,
    ...(result.benchmark.regression_pct === null
      ? []
      : [`- Regressao bench: ${result.benchmark.regression_pct.toFixed(2)}% (limite ${result.benchmark.threshold_pct.toFixed(2)}%)`]),
    ...(result.benchmark_failures.length === 0
      ? []
      : ["", "## Falhas de Benchmark", "", ...result.benchmark_failures.map((x) => `- ${x}`)]),
    ...(result.diff_failures.length === 0 ? [] : ["", "## Falhas de Diff", "", ...result.diff_failures.map((x) => `- ${x}`)]),
    ...(invariants.failures.length === 0 ? [] : ["", "## Falhas de Invariantes", "", ...invariants.failures.map((x) => `- ${x}`)]),
  ].join("\n");

  await writeFile(join(validatedDir, "metrics.json"), JSON.stringify(metrics, null, 2), "utf8");
  await writeFile(join(validatedDir, "commit_range.json"), JSON.stringify(commitRange, null, 2), "utf8");
  await writeFile(join(validatedDir, "test_results.json"), JSON.stringify(testResults, null, 2), "utf8");
  await writeFile(join(validatedDir, "REPORT.md"), report, "utf8");
  await writeFile(join(validatedDir, "CHANGELOG.md"), changelog, "utf8");

  result.reason = "stage validado e artifacts gerados";
  await mkdir("/workspace/stages/active", { recursive: true });
  await writeFile("/workspace/stages/active/validation-result.json", JSON.stringify(result, null, 2), "utf8");
  logger.info("stage validado", { stageId: plan.stage_id, validatedDir });
  return result;
}
