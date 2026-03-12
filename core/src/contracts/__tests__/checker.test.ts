import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "../../lib/logger";
import type { MerlinConfig } from "../../lib/types";
import { runInvariantChecks } from "../checker";

const logger = new Logger("error");
const minimalConfig = {} as MerlinConfig;

describe("runInvariantChecks", () => {
  test("passes when invariants and files are valid", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts", "programs"), { recursive: true });
    await writeFile(join(root, "contracts", "programs", "ok.art"), "print(\"ok\")\n", "utf8");
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `[[programs]]\nid = "ok"\nfile = "contracts/programs/ok.art"\nexpected_output = "ok\\n"\n`,
      "utf8",
    );

    const result = await runInvariantChecks(minimalConfig, logger, root);
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checkedPrograms).toBe(1);
  });

  test("fails when duplicate ids exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts", "programs"), { recursive: true });
    await writeFile(join(root, "contracts", "programs", "a.art"), "x\n", "utf8");
    await writeFile(join(root, "contracts", "programs", "b.art"), "y\n", "utf8");
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `[[programs]]\nid = "dup"\nfile = "contracts/programs/a.art"\nexpected_output = "x\\n"\n\n[[programs]]\nid = "dup"\nfile = "contracts/programs/b.art"\nexpected_output = "y\\n"\n`,
      "utf8",
    );

    const result = await runInvariantChecks(minimalConfig, logger, root);
    expect(result.pass).toBe(false);
    expect(result.failures.some((x) => x.includes("id duplicado"))).toBe(true);
  });

  test("fails when invariants.toml is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    const result = await runInvariantChecks(minimalConfig, logger, root);
    expect(result.pass).toBe(false);
    expect(result.failures.some((x) => x.includes("ausente"))).toBe(true);
    expect(result.checkedPrograms).toBe(0);
  });

  test("fails when program file does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts"), { recursive: true });
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `[[programs]]\nid = "missing"\nfile = "contracts/programs/missing.art"\nexpected_output = "x\\n"\n`,
      "utf8",
    );

    const result = await runInvariantChecks(minimalConfig, logger, root);
    expect(result.pass).toBe(false);
    expect(result.failures.some((x) => x.includes("nao encontrado"))).toBe(true);
  });

  test("fails when programs array is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts"), { recursive: true });
    // TOML with empty programs table (not [[programs]] array)
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `programs = []\n`,
      "utf8",
    );

    const result = await runInvariantChecks(minimalConfig, logger, root);
    expect(result.pass).toBe(false);
    expect(result.failures.some((x) => x.includes("nenhum programa"))).toBe(true);
    expect(result.checkedPrograms).toBe(0);
  });

  test("passes with checker_command that succeeds", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts", "programs"), { recursive: true });
    await writeFile(join(root, "contracts", "programs", "ok.art"), "print(\"ok\")\n", "utf8");
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `[[programs]]\nid = "ok"\nfile = "contracts/programs/ok.art"\nexpected_output = "ok\\n"\n`,
      "utf8",
    );

    const configWithCmd: MerlinConfig = {
      ...minimalConfig,
      contracts: { checker_command: "true" },
    } as MerlinConfig;

    const result = await runInvariantChecks(configWithCmd, logger, root);
    expect(result.pass).toBe(true);
  });

  test("fails with checker_command that fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "merlin-inv-"));
    await mkdir(join(root, "contracts", "programs"), { recursive: true });
    await writeFile(join(root, "contracts", "programs", "ok.art"), "print(\"ok\")\n", "utf8");
    await writeFile(
      join(root, "contracts", "invariants.toml"),
      `[[programs]]\nid = "ok"\nfile = "contracts/programs/ok.art"\nexpected_output = "ok\\n"\n`,
      "utf8",
    );

    const configWithCmd: MerlinConfig = {
      ...minimalConfig,
      contracts: { checker_command: "false" },
    } as MerlinConfig;

    const result = await runInvariantChecks(configWithCmd, logger, root);
    expect(result.pass).toBe(false);
    expect(result.failures.some((x) => x.includes("contracts checker command falhou"))).toBe(true);
  });
});
