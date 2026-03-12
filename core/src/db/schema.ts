import { Database } from "bun:sqlite";

export function initDatabase(dbPath: string): Database {
  const db = new Database(dbPath, { create: true });

  db.run(`
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      stage_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      metadata_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS planner_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      stage_id TEXT,
      source TEXT NOT NULL,
      feedback_json TEXT NOT NULL
    )
  `);

  return db;
}
