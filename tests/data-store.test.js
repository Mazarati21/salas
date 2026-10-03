const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DataStore } = require("../tools/data-store");

function withStore(work) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "legendz-store-"));
  const store = new DataStore(directory);
  try { return work(store); }
  finally { store.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

function sampleRoom(overrides = {}) {
  return {
    id: overrides.id || "room-1",
    active: true,
    creatorDatabaseId: overrides.creatorDatabaseId || 42,
    creatorNickname: "Tester",
    title: "Sala segura",
    teamspeak: { topLineCid: 100, parentCid: 101, bottomLineCid: 902 },
    channels: [1, 2, 3, 4].map((position) => ({
      cid: 101 + position,
      name: `Convivio ${position}`,
      passwordProtected: position === 1
    }))
  };
}

test("persists room state and password metadata", () => withStore((store) => {
  store.insertRoom(sampleRoom());
  const room = store.getActiveRoomByCreator(42);
  assert.equal(room.title, "Sala segura");
  assert.deepEqual(room.channels.map((channel) => channel.passwordProtected), [true, false, false, false]);

  const updated = store.updateRoom(room.id, "Sala editada", room.channels.map((channel) => ({ ...channel, passwordProtected: false })));
  assert.equal(updated.title, "Sala editada");
  assert.equal(updated.channels.some((channel) => channel.passwordProtected), false);
}));

test("enforces one active room per TeamSpeak database user", () => withStore((store) => {
  store.insertRoom(sampleRoom());
  assert.throws(() => store.insertRoom(sampleRoom({ id: "room-2" })), /UNIQUE constraint failed/);
  store.markRoomInactive("room-1");
  assert.doesNotThrow(() => store.insertRoom(sampleRoom({ id: "room-2" })));
}));

test("stores, resolves and revokes sessions", () => withStore((store) => {
  const now = Date.now();
  store.createSession({ tokenHash: "hash", databaseId: 42, nickname: "Tester", uniqueId: "uid", ip: "127.0.0.1", userAgentHash: "ua", createdAt: now, expiresAt: now + 60_000 });
  assert.equal(store.getSession("hash").database_id, 42);
  store.revokeSession("hash");
  assert.equal(store.getSession("hash"), undefined);
}));

test("rate limits survive individual requests", () => withStore((store) => {
  assert.equal(store.incrementRateLimit("test:ip", 60_000), 1);
  assert.equal(store.incrementRateLimit("test:ip", 60_000), 2);
}));
