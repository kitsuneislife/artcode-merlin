import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildChangelog, evaluateDiffCoherence, readChangelogEntries } from "../audit";

describe("evaluateDiffCoherence", () => {
  test("fails on empty diff", () => {
    const result = evaluateDiffCoherence([]);
    expect(result.coherent).toBe(false);
    expect(result.failures.some((x) => x.includes("vazio"))).toBe(true);
  });

  test("fails when changed files exceed limit", () => {
    const files = Array.from({ length: 3 }, (_, i) => `src/file-${i}.ts`);
    const result = evaluateDiffCoherence(files, 2);
    expect(result.coherent).toBe(false);
    expect(result.failures.some((x) => x.includes("muito amplo"))).toBe(true);
  });

  test("passes with bounded non-empty diff", () => {
    const result = evaluateDiffCoherence(["src/main.ts", "src/lib.ts"], 10);
    expect(result.coherent).toBe(true);
    expect(result.failures).toEqual([]);
  });
});

describe("buildChangelog", () => {
  test("renders fallback when no entries exist", () => {
    const content = buildChangelog("stage-001", []);
    expect(content.includes("Changelog stage-001")).toBe(true);
    expect(content.includes("Nenhum commit encontrado")).toBe(true);
  });

  test("renders entries list", () => {
    const content = buildChangelog("stage-002", ["- abc feat: x", "- def fix: y"]);
    expect(content.includes("- abc feat: x")).toBe(true);
    expect(content.includes("- def fix: y")).toBe(true);
  });
});

describe("evaluateDiffCoherence edge cases", () => {
  test("passes at exact limit boundary", () => {
    const files = Array.from({ length: 5 }, (_, i) => `src/file-${i}.ts`);
    const result = evaluateDiffCoherence(files, 5);
    expect(result.coherent).toBe(true);
  });

  test("uses default maxFiles=200", () => {
    const files = Array.from({ length: 199 }, (_, i) => `f${i}`);
    const result = evaluateDiffCoherence(files);
    expect(result.coherent).toBe(true);
  });

  test("returns changedFiles in output regardless of coherence", () => {
    const result = evaluateDiffCoherence([]);
    expect(result.changedFiles).toEqual([]);
    expect(result.coherent).toBe(false);
  });
});

describe("readChangelogEntries", () => {
  test("returns empty array for invalid git repo path", () => {
    const entries = readChangelogEntries("/nonexistent-path", "abc", "def");
    expect(entries).toEqual([]);
  });

  test("returns empty array for invalid refs in valid git repo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-audit-"));
    const proc = Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(proc.exitCode).toBe(0);

    const entries = readChangelogEntries(dir, "nonexistent-ref-1", "nonexistent-ref-2");
    expect(entries).toEqual([]);
  });

  test("returns formatted entries from real git commits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "merlin-audit-"));
    Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "config", "user.name", "Test"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "config", "user.email", "t@t.com"], { cwd: dir, stdout: "pipe", stderr: "pipe" });

    await Bun.write(join(dir, "a.txt"), "a");
    Bun.spawnSync(["git", "add", "."], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "first"], { cwd: dir, stdout: "pipe", stderr: "pipe" });

    const rev1 = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: dir, stdout: "pipe" });
    const from = rev1.stdout.toString().trim();

    await Bun.write(join(dir, "b.txt"), "b");
    Bun.spawnSync(["git", "add", "."], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    Bun.spawnSync(["git", "commit", "-m", "second commit"], { cwd: dir, stdout: "pipe", stderr: "pipe" });

    const entries = readChangelogEntries(dir, from, "HEAD");
    expect(entries.length).toBe(1);
    expect(entries[0]).toContain("second commit");
  });
});
