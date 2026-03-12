import { parse } from "@iarna/toml";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../lib/logger";
import type { MerlinConfig } from "../lib/types";

type InvariantProgram = {
  id: string;
  file: string;
  expected_output: string;
};

type InvariantCheckResult = {
  pass: boolean;
  failures: string[];
  checkedPrograms: number;
};

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("invariants.toml invalido: raiz nao e objeto");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`invariants.toml invalido: ${field} deve ser string nao vazia`);
  }
  return value;
}

function parsePrograms(raw: string): InvariantProgram[] {
  const root = asObject(parse(raw) as unknown);
  const programs = root.programs;
  if (!Array.isArray(programs)) {
    throw new Error("invariants.toml invalido: [[programs]] ausente");
  }

  return programs.map((entry, index) => {
    const obj = asObject(entry);
    return {
      id: asString(obj.id, `programs[${index}].id`),
      file: asString(obj.file, `programs[${index}].file`),
      expected_output: asString(obj.expected_output, `programs[${index}].expected_output`),
    };
  });
}

function checkDuplicates(programs: InvariantProgram[]): string[] {
  const failures: string[] = [];
  const ids = new Set<string>();

  for (const item of programs) {
    if (ids.has(item.id)) {
      failures.push(`id duplicado em invariantes: ${item.id}`);
      continue;
    }
    ids.add(item.id);
  }

  return failures;
}

async function runOptionalCheckerCommand(command: string, logger: Logger, rootDir: string): Promise<string[]> {
  const proc = Bun.spawnSync(["sh", "-lc", command], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode === 0) {
    logger.info("contracts checker command executado", {
      command,
      stdout: proc.stdout.toString().trim(),
    });
    return [];
  }

  const stderr = proc.stderr.toString().trim();
  const stdout = proc.stdout.toString().trim();
  const detail = stderr.length > 0 ? stderr : stdout;
  return [`contracts checker command falhou: ${detail}`];
}

export async function runInvariantChecks(
  config: MerlinConfig,
  logger: Logger,
  rootDir = "/workspace",
): Promise<InvariantCheckResult> {
  const failures: string[] = [];
  const invariantsPath = join(rootDir, "contracts", "invariants.toml");

  if (!existsSync(invariantsPath)) {
    return {
      pass: false,
      failures: ["arquivo contracts/invariants.toml ausente"],
      checkedPrograms: 0,
    };
  }

  const raw = await readFile(invariantsPath, "utf8");
  const programs = parsePrograms(raw);
  if (programs.length === 0) {
    failures.push("nenhum programa configurado em invariants.toml");
  }

  failures.push(...checkDuplicates(programs));

  for (const program of programs) {
    const fullPath = join(rootDir, program.file);
    if (!existsSync(fullPath)) {
      failures.push(`arquivo do invariante nao encontrado: ${program.file}`);
    }
  }

  const checkerCommand = config.contracts?.checker_command;
  if (checkerCommand !== undefined && checkerCommand.trim().length > 0) {
    failures.push(...(await runOptionalCheckerCommand(checkerCommand, logger, rootDir)));
  }

  return {
    pass: failures.length === 0,
    failures,
    checkedPrograms: programs.length,
  };
}
