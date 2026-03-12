import { parse } from "@iarna/toml";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { MerlinConfig } from "./types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null, `${name} deve ser um objeto`);
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  assert(typeof value === "string" && value.length > 0, `${name} deve ser string nao vazia`);
  return value;
}

function asNumber(value: unknown, name: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `${name} deve ser numero finito`);
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  assert(typeof value === "boolean", `${name} deve ser boolean`);
  return value;
}

export async function loadConfig(configPath: string): Promise<MerlinConfig> {
  assert(existsSync(configPath), `arquivo de config nao encontrado: ${configPath}`);

  const raw = await readFile(configPath, "utf8");
  const parsed = parse(raw) as unknown;
  const root = asObject(parsed, "root");

  const target = asObject(root.target, "target");
  const llm = asObject(root.llm, "llm");
  const thresholds = asObject(root.thresholds, "thresholds");
  const cycle = asObject(root.cycle, "cycle");
  const stages = asObject(root.stages, "stages");
  const contracts = root.contracts === undefined ? undefined : asObject(root.contracts, "contracts");

  return {
    target: {
      original: asString(target.original, "target.original"),
      fork: asString(target.fork, "target.fork"),
      branch_prefix: asString(target.branch_prefix, "target.branch_prefix"),
    },
    llm: {
      provider: asString(llm.provider, "llm.provider"),
      model: asString(llm.model, "llm.model"),
      base_url: asString(llm.base_url, "llm.base_url"),
    },
    thresholds: {
      max_bench_regression_pct: asNumber(
        thresholds.max_bench_regression_pct,
        "thresholds.max_bench_regression_pct",
      ),
      max_coverage_drop_pct: asNumber(thresholds.max_coverage_drop_pct, "thresholds.max_coverage_drop_pct"),
      clippy_zero_warnings: asBoolean(thresholds.clippy_zero_warnings, "thresholds.clippy_zero_warnings"),
    },
    cycle: {
      auto_plan: asBoolean(cycle.auto_plan, "cycle.auto_plan"),
      auto_build: asBoolean(cycle.auto_build, "cycle.auto_build"),
      auto_pr: asBoolean(cycle.auto_pr, "cycle.auto_pr"),
      require_human_merge: asBoolean(cycle.require_human_merge, "cycle.require_human_merge"),
      interval_seconds: cycle.interval_seconds !== undefined ? asNumber(cycle.interval_seconds, "cycle.interval_seconds") : 300,
      max_iterations: cycle.max_iterations !== undefined ? asNumber(cycle.max_iterations, "cycle.max_iterations") : 0,
    },
    stages: {
      max_concurrent: asNumber(stages.max_concurrent, "stages.max_concurrent"),
      stability_min_commits: asNumber(stages.stability_min_commits, "stages.stability_min_commits"),
    },
    contracts:
      contracts === undefined
        ? undefined
        : {
            checker_command:
              contracts.checker_command === undefined
                ? undefined
                : asString(contracts.checker_command, "contracts.checker_command"),
          },
  };
}
