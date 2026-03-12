import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type BaselineFile = {
  created_at: string;
  source: "bootstrap-from-observer" | "manual";
  benchmark_duration_ms: number;
  snapshot_timestamp?: string;
};

export type BenchBaselineState = {
  baselineMs: number;
  source: "existing" | "bootstrapped";
  filePath: string;
};

export type BenchRegressionCheck = {
  baselineMs: number;
  currentMs: number;
  regressionPct: number;
  thresholdPct: number;
  withinThreshold: boolean;
};

const BASELINE_FILE_NAME = "original-benchmark-baseline.json";

function asFinitePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} deve ser numero finito > 0`);
  }
  return value;
}

function parseBaseline(raw: string): BaselineFile {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return {
    created_at: String(parsed.created_at ?? ""),
    source: parsed.source === "manual" ? "manual" : "bootstrap-from-observer",
    benchmark_duration_ms: asFinitePositiveNumber(parsed.benchmark_duration_ms, "benchmark_duration_ms"),
    snapshot_timestamp: parsed.snapshot_timestamp === undefined ? undefined : String(parsed.snapshot_timestamp),
  };
}

export function calculateRegressionPct(currentMs: number, baselineMs: number): number {
  if (baselineMs <= 0) {
    return 0;
  }
  return ((currentMs - baselineMs) / baselineMs) * 100;
}

export async function loadOrBootstrapBenchBaseline(
  snapshotBenchMs: number,
  snapshotTimestamp: string,
  rootDir = "/workspace",
): Promise<BenchBaselineState> {
  const baselinesDir = join(rootDir, "baselines");
  const filePath = join(baselinesDir, BASELINE_FILE_NAME);

  if (existsSync(filePath)) {
    const raw = await readFile(filePath, "utf8");
    const data = parseBaseline(raw);
    return {
      baselineMs: data.benchmark_duration_ms,
      source: "existing",
      filePath,
    };
  }

  await mkdir(baselinesDir, { recursive: true });
  const initial = {
    created_at: new Date().toISOString(),
    source: "bootstrap-from-observer",
    benchmark_duration_ms: asFinitePositiveNumber(snapshotBenchMs, "snapshotBenchMs"),
    snapshot_timestamp: snapshotTimestamp,
  } satisfies BaselineFile;

  await writeFile(filePath, JSON.stringify(initial, null, 2), "utf8");
  return {
    baselineMs: initial.benchmark_duration_ms,
    source: "bootstrapped",
    filePath,
  };
}

export function evaluateBenchRegression(
  currentMs: number,
  baselineMs: number,
  thresholdPct: number,
): BenchRegressionCheck {
  const regressionPct = calculateRegressionPct(currentMs, baselineMs);
  return {
    baselineMs,
    currentMs,
    regressionPct,
    thresholdPct,
    withinThreshold: regressionPct <= thresholdPct,
  };
}
