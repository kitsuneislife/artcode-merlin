import type { Database } from "bun:sqlite";

export type ExperimentSummary = {
  stage_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  change_type: string | null;
  target_crate: string | null;
  risk: string | null;
};

type ExperimentRow = {
  stage_id: string;
  status: string;
  reason: string | null;
  created_at: string;
  metadata_json: string | null;
};

function extractPlanField(metadataJson: string | null, field: string): string | null {
  if (metadataJson === null) return null;
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const plan = metadata.plan as Record<string, unknown> | undefined;
    if (plan === undefined) return null;
    const value = plan[field];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export function queryRecentExperiments(db: Database, limit = 10): ExperimentSummary[] {
  const rows = db
    .query("SELECT stage_id, status, reason, created_at, metadata_json FROM experiments ORDER BY id DESC LIMIT ?")
    .all(limit) as ExperimentRow[];

  return rows.map((row) => ({
    stage_id: row.stage_id,
    status: row.status,
    reason: row.reason,
    created_at: row.created_at,
    change_type: extractPlanField(row.metadata_json, "change_type"),
    target_crate: extractPlanField(row.metadata_json, "target_crate"),
    risk: extractPlanField(row.metadata_json, "risk"),
  }));
}

export function queryFeedback(db: Database, limit = 5): Array<{ stage_id: string; source: string; feedback: string }> {
  const rows = db
    .query("SELECT stage_id, source, feedback_json FROM planner_feedback ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{ stage_id: string; source: string; feedback_json: string }>;

  return rows.map((row) => ({
    stage_id: row.stage_id,
    source: row.source,
    feedback: row.feedback_json,
  }));
}

export function buildHistoryContext(experiments: ExperimentSummary[], feedback: Array<{ stage_id: string; source: string; feedback: string }>): string {
  if (experiments.length === 0 && feedback.length === 0) {
    return "Nenhum historico de experimentos disponivel.";
  }

  const lines: string[] = [];

  if (experiments.length > 0) {
    lines.push("Historico recente de experimentos:");
    for (const exp of experiments) {
      const parts = [`  - ${exp.stage_id}: ${exp.status}`];
      if (exp.change_type) parts.push(`tipo=${exp.change_type}`);
      if (exp.target_crate) parts.push(`crate=${exp.target_crate}`);
      if (exp.risk) parts.push(`risco=${exp.risk}`);
      if (exp.reason) parts.push(`motivo="${exp.reason}"`);
      lines.push(parts.join(", "));
    }
  }

  if (feedback.length > 0) {
    lines.push("Feedback de PRs anteriores:");
    for (const fb of feedback) {
      lines.push(`  - ${fb.stage_id} (${fb.source}): ${fb.feedback}`);
    }
  }

  return lines.join("\n");
}
