import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateRegressionPct, evaluateBenchRegression, loadOrBootstrapBenchBaseline } from "../benchBaseline";

describe("loadOrBootstrapBenchBaseline", () => {
  test("bootstraps baseline when file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-baseline-"));
    await mkdir(join(root, "baselines"), { recursive: true });

    const baseline = await loadOrBootstrapBenchBaseline(120, "2026-03-12T00:00:00.000Z", root);
    expect(baseline.source).toBe("bootstrapped");
    expect(baseline.baselineMs).toBe(120);
  });

  test("loads existing baseline file", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-baseline-"));
    const baselinesDir = join(root, "baselines");
    await mkdir(baselinesDir, { recursive: true });
    await writeFile(
      join(baselinesDir, "original-benchmark-baseline.json"),
      JSON.stringify(
        {
          created_at: "2026-03-12T00:00:00.000Z",
          source: "manual",
          benchmark_duration_ms: 95,
        },
        null,
        2,
      ),
      "utf8",
    );

    const baseline = await loadOrBootstrapBenchBaseline(120, "2026-03-12T00:00:00.000Z", root);
    expect(baseline.source).toBe("existing");
    expect(baseline.baselineMs).toBe(95);
  });
});

describe("evaluateBenchRegression", () => {
  test("passes when regression is within threshold", () => {
    const result = evaluateBenchRegression(102, 100, 3);
    expect(result.regressionPct).toBeCloseTo(2, 6);
    expect(result.withinThreshold).toBe(true);
  });

  test("fails when regression exceeds threshold", () => {
    const result = evaluateBenchRegression(110, 100, 3);
    expect(result.regressionPct).toBeCloseTo(10, 6);
    expect(result.withinThreshold).toBe(false);
  });

  test("passes when performance improves (negative regression)", () => {
    const result = evaluateBenchRegression(90, 100, 3);
    expect(result.regressionPct).toBeCloseTo(-10, 6);
    expect(result.withinThreshold).toBe(true);
  });

  test("passes at exact threshold boundary", () => {
    const result = evaluateBenchRegression(103, 100, 3);
    expect(result.regressionPct).toBeCloseTo(3, 6);
    expect(result.withinThreshold).toBe(true);
  });
});

describe("calculateRegressionPct", () => {
  test("returns 0 when baseline is zero", () => {
    expect(calculateRegressionPct(100, 0)).toBe(0);
  });

  test("returns 0 when baseline is negative", () => {
    expect(calculateRegressionPct(100, -5)).toBe(0);
  });

  test("calculates positive regression correctly", () => {
    expect(calculateRegressionPct(150, 100)).toBeCloseTo(50, 2);
  });

  test("calculates negative regression (improvement)", () => {
    expect(calculateRegressionPct(80, 100)).toBeCloseTo(-20, 2);
  });

  test("returns 0 when current equals baseline", () => {
    expect(calculateRegressionPct(100, 100)).toBe(0);
  });
});

describe("loadOrBootstrapBenchBaseline edge cases", () => {
  test("rejects non-positive snapshotBenchMs on bootstrap", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-baseline-"));
    await mkdir(join(root, "baselines"), { recursive: true });

    await expect(loadOrBootstrapBenchBaseline(0, "2026-01-01T00:00:00Z", root)).rejects.toThrow();
    await expect(loadOrBootstrapBenchBaseline(-10, "2026-01-01T00:00:00Z", root)).rejects.toThrow();
  });

  test("rejects invalid JSON in existing baseline file", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-baseline-"));
    const baselinesDir = join(root, "baselines");
    await mkdir(baselinesDir, { recursive: true });
    await writeFile(join(baselinesDir, "original-benchmark-baseline.json"), "not json", "utf8");

    await expect(loadOrBootstrapBenchBaseline(100, "2026-01-01T00:00:00Z", root)).rejects.toThrow();
  });

  test("rejects baseline with non-positive benchmark_duration_ms", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-baseline-"));
    const baselinesDir = join(root, "baselines");
    await mkdir(baselinesDir, { recursive: true });
    await writeFile(
      join(baselinesDir, "original-benchmark-baseline.json"),
      JSON.stringify({ created_at: "x", source: "manual", benchmark_duration_ms: -5 }),
      "utf8",
    );

    await expect(loadOrBootstrapBenchBaseline(100, "2026-01-01T00:00:00Z", root)).rejects.toThrow();
  });
});
