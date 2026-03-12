import { existsSync } from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { Logger } from "../lib/logger";
import type { MerlinConfig } from "../lib/types";

function runGit(command: string[], cwd: string): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

export type IntegrationResult = {
  stage_id: string;
  integrated: boolean;
  synced: boolean;
  reason: string;
};

export async function integrateStage(stageId: string, logger: Logger): Promise<boolean> {
  const validatedDir = join("/workspace/stages/validated", stageId);
  const integratedDir = join("/workspace/stages/integrated", stageId);

  if (!existsSync(validatedDir)) {
    logger.warn("stage validado nao encontrado para integracao", { stageId, validatedDir });
    return false;
  }

  await mkdir(integratedDir, { recursive: true });
  await cp(validatedDir, integratedDir, { recursive: true });

  const marker = {
    integrated_at: new Date().toISOString(),
    stage_id: stageId,
  };
  await writeFile(join(integratedDir, "integration.json"), JSON.stringify(marker, null, 2), "utf8");

  await rm(validatedDir, { recursive: true });
  logger.info("stage movido para integrated", { stageId });
  return true;
}

export function syncForkWithOriginal(config: MerlinConfig, logger: Logger): { synced: boolean; reason: string } {
  const forkPath = config.target.fork;
  const originalPath = config.target.original;

  const addRemote = runGit(["git", "remote", "add", "merlin-original", originalPath], forkPath);
  if (addRemote.exitCode !== 0) {
    runGit(["git", "remote", "set-url", "merlin-original", originalPath], forkPath);
  }

  const fetch = runGit(["git", "fetch", "merlin-original"], forkPath);
  if (fetch.exitCode !== 0) {
    return { synced: false, reason: `falha ao fetch do original: ${fetch.stderr}` };
  }

  const remoteHead = runGit(["git", "symbolic-ref", "refs/remotes/merlin-original/HEAD"], forkPath);
  let baseRef = "merlin-original/main";
  if (remoteHead.exitCode === 0) {
    baseRef = remoteHead.stdout.trim().replace("refs/remotes/", "");
  }

  const merge = runGit(["git", "merge", baseRef, "--no-edit", "--strategy-option=theirs"], forkPath);
  if (merge.exitCode !== 0) {
    const abortMerge = runGit(["git", "merge", "--abort"], forkPath);
    logger.warn("merge com original falhou; abortado", {
      mergeStderr: merge.stderr,
      abortResult: abortMerge.exitCode,
    });
    return { synced: false, reason: `merge falhou: ${merge.stderr}` };
  }

  logger.info("fork sincronizado com original");
  return { synced: true, reason: "fork sincronizado via merge" };
}

export function recordFeedback(db: Database, stageId: string, source: string, feedback: string): void {
  db.run(
    "INSERT INTO planner_feedback (created_at, stage_id, source, feedback_json) VALUES (?, ?, ?, ?)",
    [new Date().toISOString(), stageId, source, feedback],
  );
}

export async function processIntegration(
  config: MerlinConfig,
  db: Database,
  stageId: string,
  accepted: boolean,
  feedback: string,
  logger: Logger,
): Promise<IntegrationResult> {
  if (!accepted) {
    recordFeedback(db, stageId, "pr_rejected", feedback);
    logger.info("pr rejeitado; feedback registrado", { stageId, feedback });
    return { stage_id: stageId, integrated: false, synced: false, reason: `pr rejeitado: ${feedback}` };
  }

  const moved = await integrateStage(stageId, logger);
  if (!moved) {
    return { stage_id: stageId, integrated: false, synced: false, reason: "falha ao mover stage para integrated" };
  }

  const sync = syncForkWithOriginal(config, logger);
  recordFeedback(db, stageId, "pr_accepted", feedback || "pr aceito e integrado");

  return {
    stage_id: stageId,
    integrated: true,
    synced: sync.synced,
    reason: sync.synced
      ? "stage integrado e fork sincronizado"
      : `stage integrado mas sync falhou: ${sync.reason}`,
  };
}

export async function listValidatedStages(): Promise<string[]> {
  const validatedDir = "/workspace/stages/validated";
  if (!existsSync(validatedDir)) return [];

  const entries = await readdir(validatedDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}
