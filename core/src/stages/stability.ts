import type { Database } from "bun:sqlite";

type ExperimentStatusRow = {
  status: string;
  stage_id: string;
};

export type StabilityCheck = {
  stable: boolean;
  consecutiveClean: number;
  requiredClean: number;
};

export function evaluateStability(db: Database, requiredClean: number): StabilityCheck {
  if (requiredClean <= 0) {
    return { stable: true, consecutiveClean: 0, requiredClean };
  }

  const rows = db
    .query("SELECT status, stage_id FROM experiments ORDER BY id DESC LIMIT ?")
    .all(requiredClean) as ExperimentStatusRow[];

  let consecutiveClean = 0;
  for (const row of rows) {
    if (row.status === "committed") {
      consecutiveClean++;
    } else {
      break;
    }
  }

  return {
    stable: consecutiveClean >= requiredClean,
    consecutiveClean,
    requiredClean,
  };
}
