import Database from 'better-sqlite3';
import { Config } from '../config/schema.js';
import { Logger } from '../utils/logger.js';
import { join } from 'path';
import { SOLAIRE_HOME } from '../config/loader.js';

export interface MessageRecord {
  id: number;
  userId: string;
  role: string;
  content: string;
  timestamp: number;
  metadata?: string;
}

export interface CompactionResult {
  summary: string;
  preservedMessages: number;
  removedMessages: number;
}

export class MemoryManager {
  private db: Database.Database;
  private logger: Logger;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.logger = new Logger('MemoryManager');

    const dbPath = config.memory.databaseUrl.replace('file:', '');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  async initialize(): Promise<void> {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        metadata TEXT,
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        start_time INTEGER,
        end_time INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_summaries_user ON summaries(user_id);

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        fact TEXT NOT NULL,
        category TEXT,
        confidence REAL DEFAULT 1.0,
        created_at INTEGER DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_facts_user ON facts(user_id);

      -- Virtual table for full-text search
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        user_id UNINDEXED,
        content_rowid=rowid
      );

      -- Triggers to keep FTS index in sync
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content, user_id)
        VALUES (new.id, new.content, new.user_id);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content, user_id)
        VALUES ('delete', old.id, old.content, old.user_id);
      END;
    `);

    this.logger.info('Memory database initialized');
  }

  async addMessage(
    userId: string,
    role: string,
    content: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO messages (user_id, role, content, timestamp, metadata, session_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      userId,
      role,
      content,
      Date.now(),
      metadata ? JSON.stringify(metadata) : null,
      this.getCurrentSessionId()
    );
  }

  async getConversationHistory(
    userId: string,
    limit: number = 20
  ): Promise<Array<{ role: string; content: string }>> {
    const stmt = this.db.prepare(`
      SELECT role, content FROM messages
      WHERE user_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);

    const rows = stmt.all(userId, limit) as MessageRecord[];
    return rows.reverse().map(r => ({ role: r.role, content: r.content }));
  }

  async searchMemory(
    userId: string,
    query: string,
    limit: number = 5
  ): Promise<Array<{ content: string; relevance: number }>> {
    // Full-text search using FTS5
    const stmt = this.db.prepare(`
      SELECT m.content, rank as relevance
      FROM messages_fts fts
      JOIN messages m ON fts.rowid = m.id
      WHERE messages_fts MATCH ? AND m.user_id = ?
      ORDER BY rank
      LIMIT ?
    `);

    const rows = stmt.all(query, userId, limit) as any[];
    return rows.map(r => ({ content: r.content, relevance: r.relevance }));
  }

  async storeFact(
    userId: string,
    fact: string,
    category?: string,
    confidence: number = 1.0
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO facts (user_id, fact, category, confidence)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(userId, fact, category, confidence);
  }

  async getFacts(userId: string, category?: string): Promise<string[]> {
    let stmt;
    if (category) {
      stmt = this.db.prepare(`
        SELECT fact FROM facts
        WHERE user_id = ? AND category = ?
        ORDER BY created_at DESC
      `);
      return (stmt.all(userId, category) as any[]).map(r => r.fact);
    } else {
      stmt = this.db.prepare(`
        SELECT fact FROM facts
        WHERE user_id = ?
        ORDER BY created_at DESC
      `);
      return (stmt.all(userId) as any[]).map(r => r.fact);
    }
  }

  async checkCompaction(userId: string): Promise<void> {
    // Count messages in current session
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages
      WHERE user_id = ? AND session_id = ?
    `);

    const result = stmt.get(userId, this.getCurrentSessionId()) as { count: number };

    // If too many messages, compact
    if (result.count > 50) {
      await this.compactSession(userId);
    }
  }

  async compactSession(userId: string): Promise<CompactionResult> {
    this.logger.info(`Compacting session for user ${userId}`);

    // Get old messages
    const stmt = this.db.prepare(`
      SELECT * FROM messages
      WHERE user_id = ? AND session_id = ?
      ORDER BY timestamp ASC
      LIMIT 30
    `);

    const messages = stmt.all(userId, this.getCurrentSessionId()) as MessageRecord[];

    // In production, use LLM to summarize
    // For now, simple truncation
    const summary = `Session summary: ${messages.length} messages exchanged`;

    // Store summary
    const summaryStmt = this.db.prepare(`
      INSERT INTO summaries (user_id, summary, start_time, end_time)
      VALUES (?, ?, ?, ?)
    `);

    summaryStmt.run(
      userId,
      summary,
      messages[0]?.timestamp,
      messages[messages.length - 1]?.timestamp
    );

    // Remove old messages
    const ids = messages.map(m => m.id).join(',');
    this.db.exec(`DELETE FROM messages WHERE id IN (${ids})`);

    return {
      summary,
      preservedMessages: messages.length,
      removedMessages: messages.length
    };
  }

  private getCurrentSessionId(): string {
    // Simple session ID based on date
    return new Date().toISOString().split('T')[0];
  }

  async getStats(userId?: string): Promise<any> {
    if (userId) {
      const msgStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?');
      const factStmt = this.db.prepare('SELECT COUNT(*) as count FROM facts WHERE user_id = ?');

      return {
        messages: (msgStmt.get(userId) as any).count,
        facts: (factStmt.get(userId) as any).count
      };
    } else {
      const msgStmt = this.db.prepare('SELECT COUNT(*) as count FROM messages');
      const factStmt = this.db.prepare('SELECT COUNT(*) as count FROM facts');

      return {
        totalMessages: (msgStmt.get() as any).count,
        totalFacts: (factStmt.get() as any).count
      };
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
