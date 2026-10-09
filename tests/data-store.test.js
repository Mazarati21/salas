const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const initSqlJs = require("sql.js");
const { DataStore } = require("../tools/data-store");

async function withStore(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendz-store-"));
  const store = await DataStore.open(directory);
  try { return await work(store); }
  finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

function sampleRoom(overrides = {}) {
  const channelCount = overrides.channelCount || 4;
  return {
    id: overrides.id || "room-1",
    active: true,
    creatorDatabaseId: overrides.creatorDatabaseId || 42,
    creatorNickname: "Tester",
    title: "Sala segura",
    autoExpire: overrides.autoExpire === true,
    teamspeak: { topLineCid: 100, parentCid: 101, bottomLineCid: 902 },
    channels: Array.from({ length: channelCount }, (_, index) => ({
      position: index + 1,
      cid: 102 + index,
      name: `Convivio ${index + 1}`,
      passwordProtected: index === 0
    }))
  };
}

test("persists room state and password metadata", () => withStore((store) => {
  store.insertRoom(sampleRoom());
  const room = store.getActiveRoomByCreator(42);
  assert.equal(room.title, "Sala segura");
  assert.deepEqual(room.channels.map((channel) => channel.passwordProtected), [true, false, false, false]);

  const updated = store.updateRoom(room.id, "Sala editada", room.channels.map((channel, index) => ({ ...channel, name: `Jogo ${index + 1}`, passwordProtected: false })));
  assert.equal(updated.title, "Sala editada");
  assert.deepEqual(updated.channels.map((channel) => channel.name), ["Jogo 1", "Jogo 2", "Jogo 3", "Jogo 4"]);
  assert.equal(updated.channels.some((channel) => channel.passwordProtected), false);
}));

test("enforces one active room per TeamSpeak database user", () => withStore((store) => {
  store.insertRoom(sampleRoom());
  assert.throws(() => store.insertRoom(sampleRoom({ id: "room-2" })), /UNIQUE constraint failed/);
  store.markRoomInactive("room-1");
  assert.doesNotThrow(() => store.insertRoom(sampleRoom({ id: "room-2" })));
}));

test("replaces a room channel list when its size changes", () => withStore((store) => {
  const room = store.insertRoom(sampleRoom());
  const reduced = store.updateRoom(room.id, room.title, room.channels.slice(0, 2));
  assert.deepEqual(reduced.channels.map((channel) => channel.name), ["Convivio 1", "Convivio 2"]);

  const expanded = store.updateRoom(room.id, room.title, [
    ...reduced.channels,
    { cid: 201, name: "Convivio 3", passwordProtected: false },
    { cid: 202, name: "Convivio 4", passwordProtected: true }
  ]);
  assert.equal(expanded.channels.length, 4);
  assert.deepEqual(expanded.channels.map((channel) => channel.cid), [102, 103, 201, 202]);
}));

test("only tracks inactivity for newly opted-in rooms", () => withStore((store) => {
  const legacy = store.insertRoom(sampleRoom());
  assert.equal(legacy.autoExpire, false);
  assert.equal(legacy.lastActivityAt, legacy.createdAt);

  store.markRoomInactive(legacy.id);
  const created = store.insertRoom(sampleRoom({ id: "managed-room", creatorDatabaseId: 77, autoExpire: true }));
  assert.equal(created.autoExpire, true);
  assert.equal(created.lastActivityAt, created.createdAt);

  const activityAt = created.lastActivityAt + 60_000;
  const touched = store.touchRoomActivity(created.id, activityAt);
  assert.equal(touched.lastActivityAt, activityAt);
  store.touchRoomActivity(created.id, activityAt - 30_000);
  assert.equal(store.getActiveRoomById(created.id).lastActivityAt, activityAt);
}));

test("migrates existing rooms without enabling automatic expiry", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendz-legacy-store-"));
  try {
    const SQL = await initSqlJs({ locateFile: (file) => require.resolve(`sql.js/dist/${file}`) });
    const database = new SQL.Database();
    database.run(`
      CREATE TABLE rooms (
        id TEXT PRIMARY KEY, active INTEGER NOT NULL, creator_database_id INTEGER NOT NULL,
        creator_nickname TEXT NOT NULL, title TEXT NOT NULL, top_line_cid INTEGER NOT NULL,
        parent_cid INTEGER NOT NULL, bottom_line_cid INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      INSERT INTO rooms VALUES ('legacy-room', 1, 42, 'Tester', 'Sala antiga', 100, 101, 902, 1000, 1000);
    `);
    fs.writeFileSync(path.join(directory, "legendz.sqlite"), Buffer.from(database.export()));
    database.close();

    const store = await DataStore.open(directory);
    try {
      const room = store.getActiveRoomById("legacy-room");
      assert.equal(room.autoExpire, false);
      assert.equal(room.lastActivityAt, 1000);
      assert.equal(store.getAutoExpiringRooms().length, 0);
    } finally { store.close(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("stores, resolves and revokes sessions", () => withStore((store) => {
  const now = Date.now();
  store.createSession({ tokenHash: "hash", databaseId: 42, nickname: "Tester", uniqueId: "uid", ip: "127.0.0.1", userAgentHash: "ua", createdAt: now, expiresAt: now + 60_000 });
  store.createSession({ tokenHash: "other-hash", databaseId: 77, nickname: "Other", uniqueId: "other-uid", ip: "127.0.0.2", userAgentHash: "other-ua", createdAt: now, expiresAt: now + 60_000 });
  assert.equal(store.getSession("hash").database_id, 42);
  store.revokeSession("hash");
  assert.equal(store.getSession("hash"), undefined);
  assert.equal(store.revokeSessionsByDatabaseId(77), 1);
  assert.equal(store.getSession("other-hash"), undefined);
  assert.equal(store.revokeSessionsByDatabaseId(77), 0);
}));

test("rate limits survive individual requests", () => withStore((store) => {
  assert.equal(store.incrementRateLimit("test:ip", 60_000), 1);
  assert.equal(store.incrementRateLimit("test:ip", 60_000), 2);
}));

test("builds an administrative snapshot without session secrets", () => withStore((store) => {
  const now = Date.now();
  store.insertRoom(sampleRoom());
  store.createSession({ tokenHash: "private-hash", databaseId: 42, nickname: "Tester", uniqueId: "private-uid", ip: "127.0.0.1", userAgentHash: "private-ua", createdAt: now, expiresAt: now + 60_000 });
  store.audit({ databaseId: 42, nickname: "Tester", ip: "127.0.0.1", action: "room.create", success: true });
  store.audit({ ip: "127.0.0.1", action: "auth.verify", success: false, details: { status: 403, message: "Código inválido" } });
  store.incrementRateLimit("verify:127.0.0.1", 60_000);

  const snapshot = store.getAdminSnapshot(now);
  assert.equal(snapshot.rooms.length, 1);
  assert.equal(snapshot.activeSessions.length, 1);
  assert.equal(snapshot.activeSessions[0].nickname, "Tester");
  assert.equal("tokenHash" in snapshot.activeSessions[0], false);
  assert.equal("uniqueId" in snapshot.activeSessions[0], false);
  assert.equal(snapshot.security.failures24h, 1);
  assert.equal(snapshot.security.authFailures24h, 1);
  assert.equal(snapshot.audit[0].details.message, "Código inválido");
}));
