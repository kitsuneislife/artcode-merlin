import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { evaluateStability } from "../stability";
import { initDatabase } from "../../db/schema";

function createTestDb(): Database {
  return initDatabase(":memory:");
}

describe("evaluateStability", () => {
  test("retorna estavel quando requiredClean e zero", () => {
    const db = createTestDb();
    const result = evaluateStability(db, 0);
    expect(result.stable).toBe(true);
    expect(result.consecutiveClean).toBe(0);
    db.close();
  });

  test("retorna nao estavel quando nao ha experimentos suficientes", () => {
    const db = createTestDb();
    db.run(
      "INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)",
      ["2026-01-01T00:00:00Z", "stage-001", "committed", "ok"],
    );

    const result = evaluateStability(db, 3);
    expect(result.stable).toBe(false);
    expect(result.consecutiveClean).toBe(1);
    expect(result.requiredClean).toBe(3);
    db.close();
  });

  test("retorna estavel quando ha commits limpos consecutivos suficientes", () => {
    const db = createTestDb();
    for (let i = 1; i <= 3; i++) {
      db.run(
        "INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)",
        [`2026-01-0${i}T00:00:00Z`, `stage-00${i}`, "committed", "ok"],
      );
    }

    const result = evaluateStability(db, 3);
    expect(result.stable).toBe(true);
    expect(result.consecutiveClean).toBe(3);
    db.close();
  });

  test("interrompe contagem ao encontrar commit falho", () => {
    const db = createTestDb();
    db.run("INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)", ["2026-01-01T00:00:00Z", "stage-001", "committed", "ok"]);
    db.run("INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)", ["2026-01-02T00:00:00Z", "stage-002", "failed", "test falhou"]);
    db.run("INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)", ["2026-01-03T00:00:00Z", "stage-003", "committed", "ok"]);
    db.run("INSERT INTO experiments (created_at, stage_id, status, reason) VALUES (?, ?, ?, ?)", ["2026-01-04T00:00:00Z", "stage-004", "committed", "ok"]);

    const result = evaluateStability(db, 3);
    expect(result.stable).toBe(false);
    expect(result.consecutiveClean).toBe(2);
    db.close();
  });
});
