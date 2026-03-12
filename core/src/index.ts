import { initDatabase } from "./db/schema";
import { loadConfig } from "./lib/config";
import { Logger } from "./lib/logger";
import type { MerlinConfig } from "./lib/types";
import { runBuilder } from "./builder/index";
import { ensureForkInitialized } from "./fork/init";
import { runObserver } from "./observer/index";
import { runPlanner } from "./planner/index";
import { runValidator } from "./validator/index";
import { openPullRequest } from "./pr/index";
import type { Database } from "bun:sqlite";

let shutdownRequested = false;

function setupGracefulShutdown(logger: Logger): void {
  const handler = () => {
    if (shutdownRequested) return;
    shutdownRequested = true;
    logger.info("sinal de shutdown recebido; finalizando apos ciclo atual");
  };
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCycle(config: MerlinConfig, db: Database, logger: Logger, iteration: number): Promise<void> {
  logger.info(`iniciando ciclo ${iteration}`);

  const snapshot = await runObserver(config, logger);
  const plan = await runPlanner(config, snapshot, logger, db);
  const builderResult = await runBuilder(config, plan, logger);
  const validatorResult = await runValidator(config, plan, snapshot, builderResult, logger, db);

  db.run(
    "INSERT INTO experiments (created_at, stage_id, status, reason, metadata_json) VALUES (?, ?, ?, ?, ?)",
    [
      new Date().toISOString(),
      plan.stage_id,
      builderResult.status,
      builderResult.reason,
      JSON.stringify({
        snapshotTimestamp: snapshot.timestamp,
        plan,
        builder: builderResult,
        validator: validatorResult,
      }),
    ],
  );

  if (validatorResult.stable && config.cycle.auto_pr) {
    try {
      const prResult = await openPullRequest(config, plan, validatorResult, logger);
      logger.info("pr automation resultado", { stageId: plan.stage_id, pr: prResult });
    } catch (error) {
      logger.warn("falha ao abrir pr automatico", {
        stageId: plan.stage_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info(`ciclo ${iteration} concluido`, {
    stageId: plan.stage_id,
    builderStatus: builderResult.status,
    stageStable: validatorResult.stable,
  });
}

async function main(): Promise<void> {
  const logger = new Logger(process.env.MERLIN_LOG_LEVEL);
  const configPath = process.env.MERLIN_CONFIG_PATH ?? "/workspace/config/merlin.toml";
  const dbPath = process.env.MERLIN_DB_PATH ?? "/workspace/db/merlin.sqlite";

  Bun.spawnSync(["git", "config", "--global", "--add", "safe.directory", "*"], { stdout: "pipe", stderr: "pipe" });

  logger.info("iniciando merlin core", { configPath, dbPath });
  setupGracefulShutdown(logger);

  const config = await loadConfig(configPath);
  const db = initDatabase(dbPath);
  const intervalMs = config.cycle.interval_seconds * 1000;
  const maxIterations = process.env.MERLIN_MAX_ITERATIONS !== undefined
    ? Number.parseInt(process.env.MERLIN_MAX_ITERATIONS, 10)
    : config.cycle.max_iterations;

  try {
    await ensureForkInitialized(config, logger);
    let iteration = 1;

    while (!shutdownRequested) {
      try {
        await runCycle(config, db, logger, iteration);
      } catch (error) {
        logger.error(`erro no ciclo ${iteration}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      iteration++;

      if (maxIterations > 0 && iteration > maxIterations) {
        logger.info("limite de iteracoes atingido", { maxIterations });
        break;
      }

      if (!shutdownRequested && intervalMs > 0) {
        logger.info(`aguardando ${config.cycle.interval_seconds}s ate proximo ciclo`);
        await sleep(intervalMs);
      }
    }

    logger.info("merlin finalizado", { totalCycles: iteration - 1 });
  } finally {
    db.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: "error", message }));
  process.exit(1);
});
