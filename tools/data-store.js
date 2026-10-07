const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

class PersistentDatabase {
  constructor(SQL, filePath) {
    this.filePath = filePath;
    this.inTransaction = false;
    this.db = fs.existsSync(filePath) && fs.statSync(filePath).size > 0
      ? new SQL.Database(fs.readFileSync(filePath))
      : new SQL.Database();
  }

  persist() {
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, Buffer.from(this.db.export()));
    fs.renameSync(temporaryPath, this.filePath);
  }

  exec(sql) {
    const command = String(sql).trim().toUpperCase();
    this.db.run(sql);
    if (command.startsWith("BEGIN")) {
      this.inTransaction = true;
    } else if (command.startsWith("COMMIT")) {
      this.inTransaction = false;
      this.persist();
    } else if (command.startsWith("ROLLBACK")) {
      this.inTransaction = false;
    } else if (!this.inTransaction) {
      this.persist();
    }
  }

  prepare(sql) {
    const query = String(sql);
    const mutation = /^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(query);
    return {
      run: (...parameters) => {
        this.db.run(query, parameters);
        if (mutation && !this.inTransaction) this.persist();
      },
      get: (...parameters) => {
        const statement = this.db.prepare(query);
        try {
          statement.bind(parameters);
          return statement.step() ? statement.getAsObject() : undefined;
        } finally {
          statement.free();
        }
      },
      all: (...parameters) => {
        const statement = this.db.prepare(query);
        const rows = [];
        try {
          statement.bind(parameters);
          while (statement.step()) rows.push(statement.getAsObject());
          return rows;
        } finally {
          statement.free();
        }
      }
    };
  }

  close() {
    this.persist();
    this.db.close();
  }
}

class DataStore {
  static async open(dataDir) {
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`)
    });
    return new DataStore(dataDir, SQL);
  }

  constructor(dataDir, SQL) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, "legendz.sqlite");
    this.db = new PersistentDatabase(SQL, this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.migrateLegacyRooms(path.join(dataDir, "rooms.json"));
  }

  createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        active INTEGER NOT NULL DEFAULT 1,
        creator_database_id INTEGER NOT NULL,
        creator_nickname TEXT NOT NULL,
        title TEXT NOT NULL,
        top_line_cid INTEGER NOT NULL,
        parent_cid INTEGER NOT NULL,
        bottom_line_cid INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS rooms_one_active_per_creator
      ON rooms(creator_database_id) WHERE active = 1;

      CREATE TABLE IF NOT EXISTS room_channels (
        room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        cid INTEGER NOT NULL,
        name TEXT NOT NULL,
        password_protected INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (room_id, position)
      );

      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        database_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        unique_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        user_agent_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        database_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        unique_id TEXT NOT NULL,
        ip TEXT NOT NULL,
        user_agent_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (bucket, window_start)
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        database_id INTEGER,
        nickname TEXT,
        ip TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        success INTEGER NOT NULL,
        details TEXT
      );
    `);
  }

  migrateLegacyRooms(filePath) {
    const count = Number(this.db.prepare("SELECT COUNT(*) AS count FROM rooms").get().count);
    if (count || !fs.existsSync(filePath)) return;

    let records;
    try {
      records = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(records)) return;

    for (const record of records) {
      if (!record?.id || !record?.creatorDatabaseId || !record?.teamspeak?.parentCid) continue;
      try {
        this.insertRoom({
          id: String(record.id),
          active: record.active !== false,
          creatorDatabaseId: Number(record.creatorDatabaseId),
          creatorNickname: String(record.creatorNickname || "Utilizador"),
          title: String(record.title || record.creatorNickname || "Sala permanente"),
          teamspeak: {
            topLineCid: Number(record.teamspeak.topLineCid),
            parentCid: Number(record.teamspeak.parentCid),
            bottomLineCid: Number(record.teamspeak.bottomLineCid)
          },
          channels: (record.channels || []).map((channel, index) => ({
            cid: Number(channel.cid),
            name: String(channel.name || `Convivio ${index + 1}`),
            passwordProtected: Boolean(channel.passwordProtected)
          }))
        });
      } catch {
        // A malformed legacy row must not prevent the application from starting.
      }
    }
    fs.renameSync(filePath, `${filePath}.migrated`);
  }

  roomFromRow(row) {
    if (!row) return null;
    const channels = this.db.prepare(`
      SELECT cid, name, password_protected
      FROM room_channels WHERE room_id = ? ORDER BY position
    `).all(row.id).map((channel) => ({
      cid: Number(channel.cid),
      name: channel.name,
      passwordProtected: Boolean(channel.password_protected)
    }));
    return {
      id: row.id,
      active: Boolean(row.active),
      creatorDatabaseId: Number(row.creator_database_id),
      creatorNickname: row.creator_nickname,
      title: row.title,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
      teamspeak: {
        topLineCid: Number(row.top_line_cid),
        parentCid: Number(row.parent_cid),
        bottomLineCid: Number(row.bottom_line_cid)
      },
      channels
    };
  }

  getRooms() {
    return this.db.prepare("SELECT * FROM rooms ORDER BY created_at").all().map((row) => this.roomFromRow(row));
  }

  getActiveRoomByCreator(databaseId) {
    const row = this.db.prepare(`
      SELECT * FROM rooms WHERE creator_database_id = ? AND active = 1 LIMIT 1
    `).get(Number(databaseId));
    return this.roomFromRow(row);
  }

  getActiveRoomById(id) {
    return this.roomFromRow(this.db.prepare("SELECT * FROM rooms WHERE id = ? AND active = 1").get(String(id)));
  }

  insertRoom(room) {
    const now = Date.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare(`
        INSERT INTO rooms (
          id, active, creator_database_id, creator_nickname, title,
          top_line_cid, parent_cid, bottom_line_cid, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        room.id,
        room.active === false ? 0 : 1,
        Number(room.creatorDatabaseId),
        room.creatorNickname,
        room.title,
        Number(room.teamspeak.topLineCid),
        Number(room.teamspeak.parentCid),
        Number(room.teamspeak.bottomLineCid),
        now,
        now
      );
      const insertChannel = this.db.prepare(`
        INSERT INTO room_channels (room_id, position, cid, name, password_protected)
        VALUES (?, ?, ?, ?, ?)
      `);
      room.channels.forEach((channel, index) => {
        insertChannel.run(room.id, index, Number(channel.cid), channel.name, channel.passwordProtected ? 1 : 0);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getActiveRoomById(room.id);
  }

  updateRoom(id, title, channels) {
    const roomId = String(id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE rooms SET title = ?, updated_at = ? WHERE id = ? AND active = 1")
        .run(title, Date.now(), roomId);
      const updateChannel = this.db.prepare(`
        UPDATE room_channels SET name = ?, password_protected = ?
        WHERE room_id = ? AND position = ?
      `);
      channels.forEach((channel, index) => {
        updateChannel.run(channel.name, channel.passwordProtected ? 1 : 0, roomId, index);
      });
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.getActiveRoomById(roomId);
  }

  markRoomInactive(id) {
    this.db.prepare("UPDATE rooms SET active = 0, updated_at = ? WHERE id = ?").run(Date.now(), String(id));
  }

  markMissingRoomsInactive(existingParentCids) {
    const existing = new Set(existingParentCids.map(Number));
    const active = this.db.prepare("SELECT id, parent_cid FROM rooms WHERE active = 1").all();
    const update = this.db.prepare("UPDATE rooms SET active = 0, updated_at = ? WHERE id = ?");
    for (const room of active) {
      if (!existing.has(Number(room.parent_cid))) update.run(Date.now(), room.id);
    }
  }

  createChallenge(challenge) {
    this.db.prepare(`
      INSERT INTO auth_challenges (
        id, code_hash, database_id, nickname, unique_id, ip, user_agent_hash,
        attempts, used, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
    `).run(
      challenge.id, challenge.codeHash, challenge.databaseId, challenge.nickname,
      challenge.uniqueId, challenge.ip, challenge.userAgentHash,
      challenge.createdAt, challenge.expiresAt
    );
  }

  getChallenge(id) {
    return this.db.prepare("SELECT * FROM auth_challenges WHERE id = ?").get(String(id));
  }

  recordChallengeFailure(id) {
    this.db.prepare("UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?").run(String(id));
  }

  consumeChallenge(id) {
    this.db.prepare("UPDATE auth_challenges SET used = 1 WHERE id = ?").run(String(id));
  }

  createSession(session) {
    this.db.prepare(`
      INSERT INTO sessions (
        token_hash, database_id, nickname, unique_id, ip, user_agent_hash,
        created_at, expires_at, last_seen_at, revoked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      session.tokenHash, session.databaseId, session.nickname, session.uniqueId,
      session.ip, session.userAgentHash, session.createdAt, session.expiresAt,
      session.createdAt
    );
  }

  getSession(tokenHash) {
    return this.db.prepare(`
      SELECT * FROM sessions
      WHERE token_hash = ? AND revoked = 0 AND expires_at > ?
    `).get(tokenHash, Date.now());
  }

  touchSession(tokenHash) {
    this.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash);
  }

  revokeSession(tokenHash) {
    this.db.prepare("UPDATE sessions SET revoked = 1 WHERE token_hash = ?").run(tokenHash);
  }

  incrementRateLimit(bucket, windowMs) {
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    this.db.prepare(`
      INSERT INTO rate_limits (bucket, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(bucket, window_start) DO UPDATE SET count = count + 1
    `).run(bucket, windowStart);
    return Number(this.db.prepare(`
      SELECT count FROM rate_limits WHERE bucket = ? AND window_start = ?
    `).get(bucket, windowStart).count);
  }

  audit(entry) {
    this.db.prepare(`
      INSERT INTO audit_log (
        created_at, database_id, nickname, ip, action, target, success, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      Date.now(), entry.databaseId || null, entry.nickname || null, entry.ip,
      entry.action, entry.target || null, entry.success ? 1 : 0,
      entry.details ? JSON.stringify(entry.details).slice(0, 2000) : null
    );
  }

  getAdminSnapshot(now = Date.now()) {
    const activeSessions = this.db.prepare(`
      SELECT database_id, nickname, ip, created_at, expires_at, last_seen_at
      FROM sessions WHERE revoked = 0 AND expires_at > ?
      ORDER BY last_seen_at DESC
    `).all(now).map((row) => ({
      databaseId: Number(row.database_id),
      nickname: row.nickname,
      ip: row.ip,
      createdAt: Number(row.created_at),
      expiresAt: Number(row.expires_at),
      lastSeenAt: Number(row.last_seen_at)
    }));
    const audit = this.db.prepare(`
      SELECT id, created_at, database_id, nickname, ip, action, target, success, details
      FROM audit_log ORDER BY id DESC LIMIT 60
    `).all().map((row) => {
      let details = null;
      try { details = row.details ? JSON.parse(row.details) : null; } catch { details = null; }
      return {
        id: Number(row.id),
        createdAt: Number(row.created_at),
        databaseId: row.database_id == null ? null : Number(row.database_id),
        nickname: row.nickname || null,
        ip: row.ip,
        action: row.action,
        target: row.target || null,
        success: Boolean(row.success),
        details
      };
    });
    const failures = this.db.prepare(`
      SELECT
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS total_failures,
        SUM(CASE WHEN success = 0 AND action LIKE 'auth.%' THEN 1 ELSE 0 END) AS auth_failures
      FROM audit_log WHERE created_at >= ?
    `).get(now - 86_400_000) || {};
    const busiestBuckets = this.db.prepare(`
      SELECT bucket, SUM(count) AS count
      FROM rate_limits WHERE window_start >= ?
      GROUP BY bucket ORDER BY count DESC LIMIT 8
    `).all(now - 3_600_000).map((row) => ({ bucket: row.bucket, count: Number(row.count) }));

    return {
      rooms: this.getRooms().filter((room) => room.active),
      activeSessions,
      audit,
      security: {
        failures24h: Number(failures.total_failures || 0),
        authFailures24h: Number(failures.auth_failures || 0),
        busiestBuckets
      }
    };
  }

  cleanup() {
    const now = Date.now();
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM auth_challenges WHERE expires_at < ? OR used = 1").run(now - 60_000);
      this.db.prepare("DELETE FROM sessions WHERE expires_at < ? OR (revoked = 1 AND last_seen_at < ?)").run(now, now - 86_400_000);
      this.db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - 86_400_000);
      this.db.prepare("DELETE FROM audit_log WHERE created_at < ?").run(now - 180 * 86_400_000);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { DataStore };
