import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config";

const validToml = `
[target]
original = "/workspace/original"
fork = "/workspace/fork"
branch_prefix = "stage"

[llm]
provider = "ollama"
model = "qwen2.5-coder:7b"
base_url = "http://ollama:11434"

[thresholds]
max_bench_regression_pct = 3.0
max_coverage_drop_pct = 1.0
clippy_zero_warnings = true

[cycle]
auto_plan = true
auto_build = true
auto_pr = false
require_human_merge = true

[stages]
max_concurrent = 1
stability_min_commits = 3
`;

describe("loadConfig", () => {
  test("parses valid TOML and returns MerlinConfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    await writeFile(path, validToml, "utf8");

    const config = await loadConfig(path);
    expect(config.target.original).toBe("/workspace/original");
    expect(config.target.fork).toBe("/workspace/fork");
    expect(config.llm.model).toBe("qwen2.5-coder:7b");
    expect(config.thresholds.max_bench_regression_pct).toBe(3.0);
    expect(config.cycle.auto_plan).toBe(true);
    expect(config.cycle.require_human_merge).toBe(true);
    expect(config.stages.stability_min_commits).toBe(3);
  });

  test("applies default values for interval_seconds and max_iterations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    await writeFile(path, validToml, "utf8");

    const config = await loadConfig(path);
    expect(config.cycle.interval_seconds).toBe(300);
    expect(config.cycle.max_iterations).toBe(0);
  });

  test("uses explicit interval_seconds and max_iterations when provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    const toml = validToml + "\n" + `
[cycle]
auto_plan = true
auto_build = true
auto_pr = false
require_human_merge = true
interval_seconds = 60
max_iterations = 10
`.trimStart();
    // TOML duplicate section — last one wins for @iarna/toml? 
    // Let's use a clean approach instead.
    const cleanToml = `
[target]
original = "/workspace/original"
fork = "/workspace/fork"
branch_prefix = "stage"

[llm]
provider = "ollama"
model = "qwen2.5-coder:7b"
base_url = "http://ollama:11434"

[thresholds]
max_bench_regression_pct = 3.0
max_coverage_drop_pct = 1.0
clippy_zero_warnings = true

[cycle]
auto_plan = true
auto_build = true
auto_pr = false
require_human_merge = true
interval_seconds = 60
max_iterations = 10

[stages]
max_concurrent = 1
stability_min_commits = 3
`;
    await writeFile(path, cleanToml, "utf8");
    const config = await loadConfig(path);
    expect(config.cycle.interval_seconds).toBe(60);
    expect(config.cycle.max_iterations).toBe(10);
  });

  test("throws on missing config file", async () => {
    await expect(loadConfig("/nonexistent/path/merlin.toml")).rejects.toThrow("arquivo de config nao encontrado");
  });

  test("throws on missing required section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    await writeFile(path, "[target]\noriginal = '/x'\nfork = '/y'\nbranch_prefix = 's'\n", "utf8");

    await expect(loadConfig(path)).rejects.toThrow();
  });

  test("throws on invalid field type", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    const badToml = validToml.replace('max_bench_regression_pct = 3.0', 'max_bench_regression_pct = "not_a_number"');
    await writeFile(path, badToml, "utf8");

    await expect(loadConfig(path)).rejects.toThrow("deve ser numero finito");
  });

  test("parses optional contracts section", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    const withContracts = validToml + '\n[contracts]\nchecker_command = "bash check.sh"\n';
    await writeFile(path, withContracts, "utf8");

    const config = await loadConfig(path);
    expect(config.contracts?.checker_command).toBe("bash check.sh");
  });

  test("contracts is undefined when section absent", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-cfg-"));
    const path = join(dir, "merlin.toml");
    await writeFile(path, validToml, "utf8");

    const config = await loadConfig(path);
    expect(config.contracts).toBeUndefined();
  });
});
