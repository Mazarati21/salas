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
    this.dataDir = dataDir;
    this.backupsDir = path.join(dataDir, "backups");
    this.dbPath = path.join(dataDir, "legendz.sqlite");
    this.db = new PersistentDatabase(SQL, this.dbPath);
    this.db.exec("PRAGMA foreign_keys = ON");
    this.createSchema();
    this.migrateRoomActivitySchema();
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
        auto_expire INTEGER NOT NULL DEFAULT 0,
        last_activity_at INTEGER,
        warning_mask INTEGER NOT NULL DEFAULT 0,
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

      CREATE TABLE IF NOT EXISTS status_samples (
        bucket_at INTEGER PRIMARY KEY,
        online INTEGER NOT NULL,
        slots_used INTEGER NOT NULL DEFAULT 0,
        slots_total INTEGER NOT NULL DEFAULT 0,
        query_latency_ms INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS service_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_key TEXT NOT NULL,
        type TEXT NOT NULL,
        summary TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        resolved_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS incidents_one_open
      ON service_incidents(incident_key) WHERE resolved_at IS NULL;

      CREATE TABLE IF NOT EXISTS admin_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_key TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resolved_at INTEGER,
        notified_at INTEGER
      );

      CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_active
      ON admin_alerts(alert_key) WHERE active = 1;
    `);
  }

  migrateRoomActivitySchema() {
    const columns = new Set(this.db.prepare("PRAGMA table_info(rooms)").all().map((column) => column.name));
    if (!columns.has("auto_expire")) this.db.exec("ALTER TABLE rooms ADD COLUMN auto_expire INTEGER NOT NULL DEFAULT 0");
    if (!columns.has("last_activity_at")) this.db.exec("ALTER TABLE rooms ADD COLUMN last_activity_at INTEGER");
    if (!columns.has("warning_mask")) this.db.exec("ALTER TABLE rooms ADD COLUMN warning_mask INTEGER NOT NULL DEFAULT 0");
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
      autoExpire: Boolean(row.auto_expire),
      lastActivityAt: Number(row.last_activity_at || row.created_at || 0),
      warningMask: Number(row.warning_mask || 0),
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
          top_line_cid, parent_cid, bottom_line_cid, auto_expire,
          last_activity_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        room.id,
        room.active === false ? 0 : 1,
        Number(room.creatorDatabaseId),
        room.creatorNickname,
        room.title,
        Number(room.teamspeak.topLineCid),
        Number(room.teamspeak.parentCid),
        Number(room.teamspeak.bottomLineCid),
        room.autoExpire === true ? 1 : 0,
        room.autoExpire === true ? Number(room.lastActivityAt || now) : null,
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
      this.db.prepare("DELETE FROM room_channels WHERE room_id = ?").run(roomId);
      const insertChannel = this.db.prepare(`
        INSERT INTO room_channels (room_id, position, cid, name, password_protected)
        VALUES (?, ?, ?, ?, ?)
      `);
      channels.forEach((channel, index) => {
        insertChannel.run(roomId, index, Number(channel.cid), channel.name, channel.passwordProtected ? 1 : 0);
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

  getAutoExpiringRooms() {
    return this.db.prepare("SELECT * FROM rooms WHERE active = 1 AND auto_expire = 1 ORDER BY last_activity_at").all()
      .map((row) => this.roomFromRow(row));
  }

  touchRoomActivity(id, activityAt = Date.now()) {
    const timestamp = Number(activityAt);
    this.db.prepare(`
      UPDATE rooms SET last_activity_at = ?, warning_mask = 0
      WHERE id = ? AND active = 1 AND auto_expire = 1
        AND (last_activity_at IS NULL OR last_activity_at <= ?)
    `).run(timestamp, String(id), timestamp - 300_000);
    return this.getActiveRoomById(id);
  }

  markRoomWarningSent(id, warningMask) {
    this.db.prepare(`
      UPDATE rooms SET warning_mask = warning_mask | ?
      WHERE id = ? AND active = 1 AND auto_expire = 1
    `).run(Number(warningMask), String(id));
    return this.getActiveRoomById(id);
  }

  recordStatusSample(sample, now = Date.now(), bucketMs = 300_000) {
    const bucketAt = Math.floor(Number(now) / bucketMs) * bucketMs;
    this.db.prepare(`
      INSERT INTO status_samples (
        bucket_at, online, slots_used, slots_total, query_latency_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_at) DO UPDATE SET
        online = excluded.online,
        slots_used = excluded.slots_used,
        slots_total = excluded.slots_total,
        query_latency_ms = excluded.query_latency_ms,
        created_at = excluded.created_at
    `).run(
      bucketAt, sample.online ? 1 : 0, Number(sample.slotsUsed || 0), Number(sample.slotsTotal || 0),
      sample.queryLatencyMs == null ? null : Number(sample.queryLatencyMs), Number(now)
    );
  }

  openIncident(incidentKey, type, summary, now = Date.now()) {
    const existing = this.db.prepare(`
      SELECT * FROM service_incidents WHERE incident_key = ? AND resolved_at IS NULL
    `).get(String(incidentKey));
    if (existing) return { ...existing, created: false };
    this.db.prepare(`
      INSERT INTO service_incidents (incident_key, type, summary, started_at)
      VALUES (?, ?, ?, ?)
    `).run(String(incidentKey), String(type), String(summary).slice(0, 300), Number(now));
    const created = this.db.prepare("SELECT * FROM service_incidents WHERE id = last_insert_rowid()").get();
    return { ...created, created: true };
  }

  resolveIncident(incidentKey, now = Date.now()) {
    this.db.prepare(`
      UPDATE service_incidents SET resolved_at = ?
      WHERE incident_key = ? AND resolved_at IS NULL
    `).run(Number(now), String(incidentKey));
  }

  getStatusHistory(now = Date.now()) {
    const since = Number(now) - (30 * 86_400_000);
    const samples = this.db.prepare(`
      SELECT bucket_at, online, slots_used, slots_total, query_latency_ms
      FROM status_samples WHERE bucket_at >= ? ORDER BY bucket_at
    `).all(since);
    const onlineSamples = samples.filter((sample) => Boolean(sample.online)).length;
    const periodStartedAt = samples.length ? Math.max(since, Number(samples[0].bucket_at)) : null;
    const expectedSamples = periodStartedAt == null ? 0 : Math.max(1, Math.floor((Number(now) - periodStartedAt) / 300_000) + 1);
    const startHour = Math.floor((Number(now) - (23 * 3_600_000)) / 3_600_000) * 3_600_000;
    const hourly = Array.from({ length: 24 }, (_, index) => {
      const at = startHour + (index * 3_600_000);
      const rows = samples.filter((sample) => Number(sample.bucket_at) >= at && Number(sample.bucket_at) < at + 3_600_000);
      return {
        at,
        onlinePercent: rows.length ? Math.round((rows.filter((row) => Boolean(row.online)).length / rows.length) * 100) : null,
        peakSlots: rows.length ? Math.max(...rows.map((row) => Number(row.slots_used || 0))) : null
      };
    });
    const incidents = this.db.prepare(`
      SELECT id, type, summary, started_at, resolved_at
      FROM service_incidents
      WHERE started_at >= ? OR resolved_at IS NULL
      ORDER BY started_at DESC LIMIT 10
    `).all(since).map((incident) => ({
      id: Number(incident.id),
      type: incident.type,
      summary: incident.summary,
      startedAt: Number(incident.started_at),
      resolvedAt: incident.resolved_at == null ? null : Number(incident.resolved_at)
    }));
    return {
      availability30d: samples.length ? Number(((onlineSamples / samples.length) * 100).toFixed(2)) : null,
      coverage30d: expectedSamples ? Number((Math.min(1, samples.length / expectedSamples) * 100).toFixed(2)) : null,
      periodStartedAt,
      peakSlots30d: samples.length ? Math.max(...samples.map((sample) => Number(sample.slots_used || 0))) : 0,
      sampleCount: samples.length,
      hourly,
      incidents
    };
  }

  openAdminAlert(alertKey, type, severity, message, now = Date.now()) {
    const existing = this.db.prepare(`
      SELECT * FROM admin_alerts WHERE alert_key = ? AND active = 1
    `).get(String(alertKey));
    if (existing) {
      this.db.prepare("UPDATE admin_alerts SET message = ?, updated_at = ? WHERE id = ?")
        .run(String(message).slice(0, 500), Number(now), Number(existing.id));
      return { ...existing, message: String(message).slice(0, 500), updated_at: Number(now), created: false };
    }
    this.db.prepare(`
      INSERT INTO admin_alerts (alert_key, type, severity, message, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(alertKey), String(type), String(severity), String(message).slice(0, 500), Number(now), Number(now));
    const created = this.db.prepare("SELECT * FROM admin_alerts WHERE id = last_insert_rowid()").get();
    return { ...created, created: true };
  }

  resolveAdminAlert(alertKey, message, now = Date.now()) {
    this.db.prepare(`
      UPDATE admin_alerts SET active = 0, message = ?, updated_at = ?, resolved_at = ?, notified_at = NULL
      WHERE alert_key = ? AND active = 1
    `).run(String(message).slice(0, 500), Number(now), Number(now), String(alertKey));
  }

  getPendingAdminAlerts() {
    return this.db.prepare(`
      SELECT * FROM admin_alerts WHERE notified_at IS NULL ORDER BY active DESC, created_at
    `).all();
  }

  markAdminAlertNotified(id, now = Date.now()) {
    this.db.prepare("UPDATE admin_alerts SET notified_at = ? WHERE id = ?").run(Number(now), Number(id));
  }

  getAdminAlerts(limit = 20) {
    return this.db.prepare(`
      SELECT id, type, severity, message, active, created_at, updated_at, resolved_at
      FROM admin_alerts ORDER BY active DESC, updated_at DESC LIMIT ?
    `).all(Number(limit)).map((alert) => ({
      id: Number(alert.id), type: alert.type, severity: alert.severity, message: alert.message,
      active: Boolean(alert.active), createdAt: Number(alert.created_at), updatedAt: Number(alert.updated_at),
      resolvedAt: alert.resolved_at == null ? null : Number(alert.resolved_at)
    }));
  }

  countAuthFailuresSince(since) {
    return Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM audit_log
      WHERE created_at >= ? AND success = 0 AND action LIKE 'auth.%'
    `).get(Number(since)).count || 0);
  }

  createBackup(now = Date.now(), retentionDays = 14) {
    fs.mkdirSync(this.backupsDir, { recursive: true });
    this.db.persist();
    const date = new Date(Number(now)).toISOString().slice(0, 10);
    const destination = path.join(this.backupsDir, `legendz-${date}.sqlite`);
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.copyFileSync(this.dbPath, temporary);
    fs.renameSync(temporary, destination);

    const cutoff = Number(now) - (Math.max(1, Number(retentionDays) || 14) * 86_400_000);
    for (const file of fs.readdirSync(this.backupsDir)) {
      if (!/^legendz-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file)) continue;
      const filePath = path.join(this.backupsDir, file);
      if (fs.statSync(filePath).mtimeMs < cutoff) fs.rmSync(filePath);
    }
    return this.getBackupStatus();
  }

  getBackupStatus() {
    if (!fs.existsSync(this.backupsDir)) return { count: 0, latestAt: null, latestBytes: 0 };
    const backups = fs.readdirSync(this.backupsDir)
      .filter((file) => /^legendz-\d{4}-\d{2}-\d{2}\.sqlite$/.test(file))
      .map((file) => {
        const stats = fs.statSync(path.join(this.backupsDir, file));
        return { file, modifiedAt: stats.mtimeMs, bytes: stats.size };
      })
      .sort((left, right) => right.modifiedAt - left.modifiedAt);
    return {
      count: backups.length,
      latestAt: backups[0]?.modifiedAt || null,
      latestBytes: backups[0]?.bytes || 0
    };
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

  revokeSessionsByDatabaseId(databaseId) {
    const now = Date.now();
    const active = Number(this.db.prepare(`
      SELECT COUNT(*) AS count FROM sessions
      WHERE database_id = ? AND revoked = 0 AND expires_at > ?
    `).get(Number(databaseId), now).count || 0);
    if (active) this.db.prepare("UPDATE sessions SET revoked = 1 WHERE database_id = ? AND revoked = 0 AND expires_at > ?").run(Number(databaseId), now);
    return active;
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
      },
      alerts: this.getAdminAlerts()
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
      this.db.prepare("DELETE FROM status_samples WHERE bucket_at < ?").run(now - 90 * 86_400_000);
      this.db.prepare("DELETE FROM service_incidents WHERE resolved_at IS NOT NULL AND resolved_at < ?").run(now - 180 * 86_400_000);
      this.db.prepare("DELETE FROM admin_alerts WHERE active = 0 AND resolved_at < ?").run(now - 180 * 86_400_000);
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
