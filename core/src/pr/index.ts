import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Logger } from "../lib/logger";
import type { MerlinConfig, Plan, ValidatorResult } from "../lib/types";

export type PrResult = {
  opened: boolean;
  reason: string;
  pr_url?: string;
};

type GitHubPrResponse = {
  html_url?: string;
  message?: string;
};

function resolveGitHubRepo(): { owner: string; repo: string } | null {
  const owner = process.env.GITHUB_REPO_OWNER;
  const repo = process.env.GITHUB_REPO_NAME;
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function loadReportBody(stageId: string): Promise<string> {
  const reportPath = join("/workspace/stages/validated", stageId, "REPORT.md");
  try {
    return await readFile(reportPath, "utf8");
  } catch {
    return `Stage ${stageId} validated — REPORT.md not found.`;
  }
}

export async function openPullRequest(
  _config: MerlinConfig,
  plan: Plan,
  validator: ValidatorResult,
  logger: Logger,
): Promise<PrResult> {
  if (!validator.stable) {
    return { opened: false, reason: "stage nao esta estavel; pr nao sera aberto" };
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    return { opened: false, reason: "GITHUB_TOKEN nao configurado; pr nao pode ser aberto" };
  }

  const repo = resolveGitHubRepo();
  if (!repo) {
    return { opened: false, reason: "GITHUB_REPO_OWNER ou GITHUB_REPO_NAME nao configurado" };
  }

  const baseBranch = process.env.GITHUB_BASE_BRANCH ?? "main";
  const headBranch = process.env.GITHUB_HEAD_BRANCH ?? `merlin/${plan.stage_id}`;

  const body = await loadReportBody(plan.stage_id);
  const title = `[Merlin] ${plan.stage_id}: ${plan.change_type}`;

  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls`;

  logger.info("abrindo pr", { title, base: baseBranch, head: headBranch });

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      title,
      body,
      head: headBranch,
      base: baseBranch,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.warn("falha ao abrir pr no github", { status: response.status, error: errorText });
    return { opened: false, reason: `github api retornou ${response.status}: ${errorText}` };
  }

  const data = (await response.json()) as GitHubPrResponse;
  const prUrl = data.html_url ?? "url desconhecida";

  logger.info("pr aberto com sucesso", { pr_url: prUrl });
  return { opened: true, reason: "pr aberto com sucesso", pr_url: prUrl };
}
