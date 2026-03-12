import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildHistoryContext, queryFeedback, queryRecentExperiments } from "../history";
import { initDatabase } from "../../db/schema";

function createTestDb(): Database {
  const db = initDatabase(":memory:");
  return db;
}

describe("queryRecentExperiments", () => {
  test("retorna lista vazia quando nao ha experimentos", () => {
    const db = createTestDb();
    const result = queryRecentExperiments(db);
    expect(result).toEqual([]);
    db.close();
  });

  test("retorna experimentos em ordem decrescente", () => {
    const db = createTestDb();

    db.run(
      "INSERT INTO experiments (created_at, stage_id, status, reason, metadata_json) VALUES (?, ?, ?, ?, ?)",
      ["2026-01-01T00:00:00Z", "stage-001", "committed", "ok", JSON.stringify({ plan: { change_type: "fix", target_crate: "parser", risk: "low" } })],
    );
    db.run(
      "INSERT INTO experiments (created_at, stage_id, status, reason, metadata_json) VALUES (?, ?, ?, ?, ?)",
      ["2026-01-02T00:00:00Z", "stage-002", "failed", "tests falharam", JSON.stringify({ plan: { change_type: "optimization", target_crate: "interpreter", risk: "medium" } })],
    );

    const result = queryRecentExperiments(db);
    expect(result.length).toBe(2);
    expect(result[0].stage_id).toBe("stage-002");
    expect(result[0].status).toBe("failed");
    expect(result[0].change_type).toBe("optimization");
    expect(result[0].target_crate).toBe("interpreter");
    expect(result[0].risk).toBe("medium");
    expect(result[1].stage_id).toBe("stage-001");
    expect(result[1].change_type).toBe("fix");
    db.close();
  });

  test("extrai campos de plan do metadata_json com seguranca", () => {
    const db = createTestDb();

    db.run(
      "INSERT INTO experiments (created_at, stage_id, status, reason, metadata_json) VALUES (?, ?, ?, ?, ?)",
      ["2026-01-01T00:00:00Z", "stage-003", "committed", null, "invalid json"],
    );

    const result = queryRecentExperiments(db);
    expect(result.length).toBe(1);
    expect(result[0].change_type).toBeNull();
    expect(result[0].target_crate).toBeNull();
    db.close();
  });
});

describe("queryFeedback", () => {
  test("retorna lista vazia quando nao ha feedback", () => {
    const db = createTestDb();
    const result = queryFeedback(db);
    expect(result).toEqual([]);
    db.close();
  });

  test("retorna feedback existente", () => {
    const db = createTestDb();
    db.run(
      "INSERT INTO planner_feedback (created_at, stage_id, source, feedback_json) VALUES (?, ?, ?, ?)",
      ["2026-01-01T00:00:00Z", "stage-001", "pr_review", "precisa de mais testes"],
    );

    const result = queryFeedback(db);
    expect(result.length).toBe(1);
    expect(result[0].stage_id).toBe("stage-001");
    expect(result[0].source).toBe("pr_review");
    expect(result[0].feedback).toBe("precisa de mais testes");
    db.close();
  });
});

describe("buildHistoryContext", () => {
  test("retorna mensagem padrao quando nao ha historico", () => {
    const result = buildHistoryContext([], []);
    expect(result).toContain("Nenhum historico");
  });

  test("inclui experimentos e feedback no contexto", () => {
    const context = buildHistoryContext(
      [
        {
          stage_id: "stage-001",
          status: "failed",
          reason: "tests falharam",
          created_at: "2026-01-01T00:00:00Z",
          change_type: "optimization",
          target_crate: "parser",
          risk: "high",
        },
      ],
      [
        { stage_id: "stage-000", source: "pr_review", feedback: "menos escopo" },
      ],
    );

    expect(context).toContain("stage-001");
    expect(context).toContain("failed");
    expect(context).toContain("optimization");
    expect(context).toContain("parser");
    expect(context).toContain("high");
    expect(context).toContain("stage-000");
    expect(context).toContain("menos escopo");
  });
});
