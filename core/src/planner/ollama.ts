import type { MerlinConfig, Plan, Snapshot } from "../lib/types";

type OllamaGenerateResponse = {
  response?: string;
};

function isChangeType(value: unknown): value is Plan["change_type"] {
  return value === "optimization" || value === "refactor" || value === "fix";
}

function isRisk(value: unknown): value is Plan["risk"] {
  return value === "low" || value === "medium" || value === "high";
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parsePlanCandidate(candidateRaw: string, fallback: Plan): Plan {
  try {
    const parsed = JSON.parse(candidateRaw) as Record<string, unknown>;

    const targetCrate = asNonEmptyString(parsed.target_crate);
    const changeType = parsed.change_type;
    const metricTarget = asNonEmptyString(parsed.metric_target);
    const expectedDelta = asNonEmptyString(parsed.expected_delta);
    const rationale = asNonEmptyString(parsed.rationale);
    const risk = parsed.risk;

    if (
      targetCrate === null ||
      metricTarget === null ||
      expectedDelta === null ||
      rationale === null ||
      !isChangeType(changeType) ||
      !isRisk(risk)
    ) {
      return fallback;
    }

    return {
      ...fallback,
      target_crate: targetCrate,
      change_type: changeType,
      metric_target: metricTarget,
      expected_delta: expectedDelta,
      rationale,
      risk,
    };
  } catch {
    return fallback;
  }
}

function buildPrompt(snapshot: Snapshot, historyContext?: string): string {
  const lines = [
    "Voce e o planner do Merlin.",
    "Responda EXCLUSIVAMENTE em JSON com chaves:",
    "target_crate, change_type, metric_target, expected_delta, rationale, risk.",
    "",
    "Contexto do snapshot:",
    `- commit_distance_ahead: ${snapshot.commitDistanceAhead}`,
    `- test_exit: ${snapshot.test.exitCode}`,
    `- clippy_exit: ${snapshot.clippy.exitCode}`,
    `- bench_exit: ${snapshot.bench.exitCode}`,
    `- test_duration_ms: ${snapshot.test.durationMs}`,
    `- clippy_duration_ms: ${snapshot.clippy.durationMs}`,
    `- bench_duration_ms: ${snapshot.bench.durationMs}`,
  ];

  if (historyContext) {
    lines.push("", historyContext);
  }

  lines.push("", "Evite repetir estrategias que falharam. Escolha baixo risco e escopo pequeno.");
  return lines.join("\n");
}

export async function proposePlanFromOllama(config: MerlinConfig, snapshot: Snapshot, fallback: Plan, historyContext?: string): Promise<Plan> {
  const response = await fetch(`${config.llm.base_url}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: config.llm.model,
      prompt: buildPrompt(snapshot, historyContext),
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) {
    throw new Error(`falha no ollama: status ${response.status}`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  if (typeof data.response !== "string") {
    throw new Error("resposta do ollama sem campo response");
  }

  return parsePlanCandidate(data.response, fallback);
}
