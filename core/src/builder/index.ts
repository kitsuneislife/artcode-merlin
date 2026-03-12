import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../lib/logger";
import type { BuilderResult, CommandResult, MerlinConfig, Plan } from "../lib/types";

function runCommand(command: string[], cwd: string): CommandResult {
  const started = Date.now();
  try {
    const proc = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe" });
    const durationMs = Date.now() - started;
    return {
      command: command.join(" "),
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - started;
    return {
      command: command.join(" "),
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}

function ensureSuccess(result: CommandResult, step: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${step} falhou: ${result.stderr || result.stdout}`);
  }
}

function ensureGitIdentity(cwd: string): void {
  const hasName = runCommand(["git", "config", "user.name"], cwd);
  if (hasName.exitCode !== 0 || hasName.stdout.trim().length === 0) {
    ensureSuccess(runCommand(["git", "config", "user.name", "Merlin Bot"], cwd), "configuracao de user.name");
  }

  const hasEmail = runCommand(["git", "config", "user.email"], cwd);
  if (hasEmail.exitCode !== 0 || hasEmail.stdout.trim().length === 0) {
    ensureSuccess(
      runCommand(["git", "config", "user.email", "merlin-bot@local.invalid"], cwd),
      "configuracao de user.email",
    );
  }
}

function makeFailedResult(
  stageId: string,
  stageBranch: string,
  baseBranch: string,
  reason: string,
  test: CommandResult,
  clippy: CommandResult,
  bench: CommandResult,
): BuilderResult {
  return {
    status: "failed",
    stage_id: stageId,
    stage_branch: stageBranch,
    baseBranch,
    reason,
    gates: { test, clippy, bench },
  };
}

async function persistBuildResult(result: BuilderResult): Promise<void> {
  await mkdir("/workspace/stages/active", { recursive: true });
  await writeFile("/workspace/stages/active/build-result.json", JSON.stringify(result, null, 2), "utf8");
}

export async function runBuilder(config: MerlinConfig, plan: Plan, logger: Logger): Promise<BuilderResult> {
  const forkPath = config.target.fork;
  const stageBranch = `${config.target.branch_prefix}-${plan.stage_id}`;
  const gitCheck = runCommand(["git", "rev-parse", "--is-inside-work-tree"], forkPath);
  ensureSuccess(gitCheck, "validacao do repositorio git do fork");

  const baseBranchProc = runCommand(["git", "rev-parse", "--abbrev-ref", "HEAD"], forkPath);
  ensureSuccess(baseBranchProc, "resolucao da branch base");
  const baseBranch = baseBranchProc.stdout.trim();

  const checkoutStage = runCommand(["git", "checkout", "-b", stageBranch], forkPath);
  ensureSuccess(checkoutStage, "criacao da branch de stage");
  ensureGitIdentity(forkPath);

  const markerDir = join(forkPath, ".merlin", "stages");
  await mkdir(markerDir, { recursive: true });
  const markerRelPath = `.merlin/stages/${plan.stage_id}.json`;
  const markerPath = join(markerDir, `${plan.stage_id}.json`);
  await writeFile(
    markerPath,
    JSON.stringify(
      {
        created_at: new Date().toISOString(),
        stage_id: plan.stage_id,
        target_crate: plan.target_crate,
        change_type: plan.change_type,
        rationale: plan.rationale,
      },
      null,
      2,
    ),
    "utf8",
  );

  const addMarker = runCommand(["git", "add", "-f", markerRelPath], forkPath);
  ensureSuccess(addMarker, "adicao do marker do stage");

  const commitMarker = runCommand(
    ["git", "commit", "-m", `[Merlin][${plan.stage_id}] stage marker`],
    forkPath,
  );
  ensureSuccess(commitMarker, "commit do marker do stage");

  const test = runCommand(["cargo", "test", "--all"], forkPath);
  const clippy = runCommand(["cargo", "clippy", "--all-targets", "--all-features", "--", "-D", "warnings"], forkPath);
  const bench = runCommand(["cargo", "bench"], forkPath);

  const clippyFailed = config.thresholds.clippy_zero_warnings && clippy.exitCode !== 0;
  if (test.exitCode !== 0 || clippyFailed || bench.exitCode !== 0) {
    runCommand(["git", "checkout", baseBranch], forkPath);
    runCommand(["git", "branch", "-D", stageBranch], forkPath);

    const failed = makeFailedResult(
      plan.stage_id,
      stageBranch,
      baseBranch,
      "gates de qualidade falharam; stage descartado",
      test,
      clippy,
      bench,
    );
    await persistBuildResult(failed);
    return failed;
  }

  const backToBase = runCommand(["git", "checkout", baseBranch], forkPath);
  ensureSuccess(backToBase, "retorno para branch base");

  const mergeStage = runCommand(["git", "merge", "--ff-only", stageBranch], forkPath);
  ensureSuccess(mergeStage, "merge da stage na branch base");

  const commitHashProc = runCommand(["git", "rev-parse", "HEAD"], forkPath);
  ensureSuccess(commitHashProc, "resolucao de hash do commit final");
  const commit = commitHashProc.stdout.trim();

  const deleteStage = runCommand(["git", "branch", "-d", stageBranch], forkPath);
  if (deleteStage.exitCode !== 0) {
    logger.warn("nao foi possivel remover branch de stage apos merge", {
      stageBranch,
      stderr: deleteStage.stderr,
    });
  }

  if (config.target.fork_remote) {
    const push = runCommand(["git", "push", config.target.fork_remote, baseBranch], forkPath);
    if (push.exitCode !== 0) {
      logger.warn("push para remote falhou; commit local preservado", {
        remote: config.target.fork_remote,
        stderr: push.stderr,
      });
    } else {
      logger.info("fork sincronizado com remote", { remote: config.target.fork_remote, branch: baseBranch });
    }
  }

  const committed: BuilderResult = {
    status: "committed",
    stage_id: plan.stage_id,
    stage_branch: stageBranch,
    baseBranch,
    reason: "stage aplicado e mergeado no fork",
    commit,
    gates: { test, clippy, bench },
  };
  await persistBuildResult(committed);
  return committed;
}
