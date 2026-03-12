import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, writeFile, readdir, readFile as readFileFs } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordFeedback, integrateStage, listValidatedStages } from "../integrator";
import { initDatabase } from "../../db/schema";
import { Logger } from "../../lib/logger";

function createTestDb(): Database {
  return initDatabase(":memory:");
}

describe("recordFeedback", () => {
  test("insere feedback no planner_feedback", () => {
    const db = createTestDb();

    recordFeedback(db, "stage-001", "pr_rejected", "escopo muito amplo");

    const rows = db.query("SELECT stage_id, source, feedback_json FROM planner_feedback").all() as Array<{
      stage_id: string;
      source: string;
      feedback_json: string;
    }>;

    expect(rows.length).toBe(1);
    expect(rows[0].stage_id).toBe("stage-001");
    expect(rows[0].source).toBe("pr_rejected");
    expect(rows[0].feedback_json).toBe("escopo muito amplo");
    db.close();
  });

  test("permite multiplos feedbacks para o mesmo stage", () => {
    const db = createTestDb();

    recordFeedback(db, "stage-001", "pr_rejected", "primeiro feedback");
    recordFeedback(db, "stage-001", "pr_review", "segundo feedback");

    const rows = db.query("SELECT * FROM planner_feedback WHERE stage_id = ?").all("stage-001");
    expect(rows.length).toBe(2);
    db.close();
  });
});

describe("integrateStage", () => {
  // Note: integrateStage uses hardcoded /workspace/stages/ paths.
  // We can only test the "not found" branch without mocking the filesystem.
  test("returns false when validated stage dir does not exist", async () => {
    const logger = new Logger("error");
    const result = await integrateStage("nonexistent-stage-xyz", logger);
    expect(result).toBe(false);
  });
});

describe("listValidatedStages", () => {
  // listValidatedStages uses hardcoded /workspace/stages/validated path.
  // In test environment this path doesn't exist, so it should return empty.
  test("returns empty array when validated dir does not exist", async () => {
    const stages = await listValidatedStages();
    expect(stages).toEqual([]);
  });
});
