import { mkdir, writeFile } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { Logger } from "../lib/logger";
import type { MerlinConfig, Plan, Snapshot } from "../lib/types";
import { buildHistoryContext, queryFeedback, queryRecentExperiments } from "./history";
import { proposePlanFromOllama } from "./ollama";

export async function runPlanner(config: MerlinConfig, snapshot: Snapshot, logger: Logger, db?: Database): Promise<Plan> {
  const now = new Date();
  const stageId = `stage-${now.toISOString().slice(0, 10).replace(/-/g, "")}-${now.getTime()}`;

  const fallbackPlan: Plan = {
    stage_id: stageId,
    target_crate: "interpreter",
    change_type: "optimization",
    metric_target: "bench_eval_loop",
    expected_delta: "-1%",
    rationale: `Bootstrap automatico: snapshot com distancia de ${snapshot.commitDistanceAhead} commits a frente do original`,
    risk: "low",
  };

  let plan = fallbackPlan;
  try {
    let historyContext: string | undefined;
    if (db) {
      const experiments = queryRecentExperiments(db);
      const feedback = queryFeedback(db);
      historyContext = buildHistoryContext(experiments, feedback);
      logger.debug("historico carregado para o planner", { experiments: experiments.length, feedback: feedback.length });
    }

    plan = await proposePlanFromOllama(config, snapshot, fallbackPlan, historyContext);
    logger.info("plano sugerido pelo ollama", {
      stageId: plan.stage_id,
      target: plan.target_crate,
      changeType: plan.change_type,
      risk: plan.risk,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("falha ao gerar plano com ollama; usando fallback", { message, stageId });
  }

  await mkdir("/workspace/stages/active", { recursive: true });
  await writeFile("/workspace/stages/active/plan.json", JSON.stringify(plan, null, 2), "utf8");
  logger.info("plano estruturado emitido", { stageId: plan.stage_id });

  return plan;
}
