import { describe, expect, test } from "bun:test";
import type { Plan } from "../../lib/types";
import { parsePlanCandidate } from "../ollama";

const fallback: Plan = {
  stage_id: "stage-001",
  target_crate: "interpreter",
  change_type: "optimization",
  metric_target: "bench_eval_loop",
  expected_delta: "-1%",
  rationale: "fallback",
  risk: "low",
};

describe("parsePlanCandidate", () => {
  test("accepts valid JSON plan from llm", () => {
    const raw = JSON.stringify({
      target_crate: "parser",
      change_type: "refactor",
      metric_target: "bench_parse",
      expected_delta: "-3%",
      rationale: "reduce allocations",
      risk: "medium",
    });

    const plan = parsePlanCandidate(raw, fallback);
    expect(plan.stage_id).toBe("stage-001");
    expect(plan.target_crate).toBe("parser");
    expect(plan.change_type).toBe("refactor");
    expect(plan.metric_target).toBe("bench_parse");
    expect(plan.expected_delta).toBe("-3%");
    expect(plan.risk).toBe("medium");
  });

  test("falls back when llm output is invalid", () => {
    const raw = JSON.stringify({
      target_crate: "parser",
      change_type: "invalid",
      metric_target: "bench_parse",
      expected_delta: "-3%",
      rationale: "reduce allocations",
      risk: "medium",
    });

    const plan = parsePlanCandidate(raw, fallback);
    expect(plan).toEqual(fallback);
  });
});
