import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class DefinitionCache {
  constructor(filename = ":memory:") {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS definitions (
        cache_key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        refresh_after TEXT NOT NULL,
        last_accessed TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        month TEXT PRIMARY KEY,
        count INTEGER NOT NULL CHECK (count >= 0)
      );
    `);
  }

  get(key, now = new Date()) {
    const row = this.db.prepare("SELECT payload, refresh_after FROM definitions WHERE cache_key = ?").get(key);
    if (!row || Date.parse(row.refresh_after) <= now.getTime()) return null;
    this.db.prepare("UPDATE definitions SET last_accessed = ? WHERE cache_key = ?").run(now.toISOString(), key);
    return JSON.parse(row.payload);
  }

  set(key, payload, refreshAfter, now = new Date()) {
    this.db.prepare(`
      INSERT INTO definitions(cache_key, payload, refresh_after, last_accessed)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload, refresh_after=excluded.refresh_after, last_accessed=excluded.last_accessed
    `).run(key, JSON.stringify(payload), refreshAfter, now.toISOString());
    this.prune();
  }

  reserveAttempt(limit, now = new Date()) {
    const month = now.toISOString().slice(0, 7);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT count FROM attempts WHERE month = ?").get(month);
      const count = Number(row?.count || 0);
      if (count >= limit) { this.db.exec("ROLLBACK"); return false; }
      this.db.prepare(`INSERT INTO attempts(month, count) VALUES (?, 1) ON CONFLICT(month) DO UPDATE SET count = count + 1`).run(month);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  attempts(now = new Date()) {
    return Number(this.db.prepare("SELECT count FROM attempts WHERE month = ?").get(now.toISOString().slice(0, 7))?.count || 0);
  }

  prune(max = 10000) {
    const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM definitions").get().count);
    if (count <= max) return;
    this.db.prepare("DELETE FROM definitions WHERE cache_key IN (SELECT cache_key FROM definitions ORDER BY last_accessed ASC LIMIT ?)").run(count - max);
  }

  close() { this.db.close(); }
}
