import type { MerlinConfig } from "../lib/types";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type DiffAudit = {
  coherent: boolean;
  changedFiles: string[];
  failures: string[];
};

export function evaluateDiffCoherence(changedFiles: string[], maxFiles = 200): DiffAudit {
  const failures: string[] = [];

  if (changedFiles.length === 0) {
    failures.push("diff fork->original vazio");
  }

  if (changedFiles.length > maxFiles) {
    failures.push(`diff muito amplo: ${changedFiles.length} arquivos (limite ${maxFiles})`);
  }

  return {
    coherent: failures.length === 0,
    changedFiles,
    failures,
  };
}

function runGit(command: string[], cwd: string): CommandResult {
  try {
    const proc = Bun.spawnSync(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } catch (err) {
    return {
      exitCode: 127,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolveOriginalRef(forkPath: string): string {
  const remoteHead = runGit(["git", "symbolic-ref", "refs/remotes/merlin-original/HEAD"], forkPath);
  if (remoteHead.exitCode === 0) {
    return remoteHead.stdout.trim().replace("refs/remotes/", "");
  }
  return "merlin-original/main";
}

function ensureOriginalRemote(forkPath: string, originalPath: string): string | null {
  const addRemote = runGit(["git", "remote", "add", "merlin-original", originalPath], forkPath);
  if (addRemote.exitCode !== 0) {
    const setRemote = runGit(["git", "remote", "set-url", "merlin-original", originalPath], forkPath);
    if (setRemote.exitCode !== 0) {
      return `falha ao configurar remote do original: ${setRemote.stderr || setRemote.stdout}`;
    }
  }

  const fetch = runGit(["git", "fetch", "merlin-original"], forkPath);
  if (fetch.exitCode !== 0) {
    return `falha ao sincronizar refs do original: ${fetch.stderr || fetch.stdout}`;
  }

  return null;
}

export function buildChangelog(stageId: string, entries: string[]): string {
  return [
    `# Changelog ${stageId}`,
    "",
    ...(entries.length === 0 ? ["- Nenhum commit encontrado no range informado."] : entries),
  ].join("\n");
}

export function readChangelogEntries(forkPath: string, fromRef: string, toRef: string): string[] {
  const log = runGit(["git", "log", "--pretty=format:- %h %s (%an)", `${fromRef}..${toRef}`], forkPath);
  if (log.exitCode !== 0) {
    return [];
  }

  return log.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function auditDiffAgainstOriginal(config: MerlinConfig): DiffAudit {
  const forkPath = config.target.fork;
  const originalPath = config.target.original;

  const remoteError = ensureOriginalRemote(forkPath, originalPath);
  if (remoteError !== null) {
    return {
      coherent: false,
      changedFiles: [],
      failures: [remoteError],
    };
  }

  const originalRef = resolveOriginalRef(forkPath);
  const diff = runGit(["git", "diff", "--name-only", `${originalRef}...HEAD`], forkPath);
  if (diff.exitCode !== 0) {
    return {
      coherent: false,
      changedFiles: [],
      failures: [`falha ao gerar diff fork->original: ${diff.stderr || diff.stdout}`],
    };
  }

  const changedFiles = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return evaluateDiffCoherence(changedFiles);
}
