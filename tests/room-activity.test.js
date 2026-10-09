const assert = require("node:assert/strict");
const test = require("node:test");
const { isRoomExpired, observedRoomActivityAt } = require("../tools/room-activity");

const day = 86_400_000;
const now = 50 * day;
const room = {
  createdAt: 10 * day,
  lastActivityAt: 20 * day,
  channels: [{ cid: 101 }, { cid: 102 }, { cid: 103 }, { cid: 104 }]
};

test("uses the most recently occupied subchannel", () => {
  const states = new Map([
    [101, { seconds_empty: String(5 * 86400) }],
    [102, { seconds_empty: String(2 * 86400) }],
    [103, { seconds_empty: String(9 * 86400) }],
    [104, { seconds_empty: String(7 * 86400) }]
  ]);
  assert.equal(observedRoomActivityAt(room, states, now), 48 * day);
});

test("treats an occupied channel as activity now", () => {
  const states = new Map([[101, { seconds_empty: "-1" }]]);
  assert.equal(observedRoomActivityAt(room, states, now), now);
});

test("expires a room only at the configured inactivity boundary", () => {
  assert.equal(isRoomExpired(20 * day, now - 1, 30 * day), false);
  assert.equal(isRoomExpired(20 * day, now, 30 * day), true);
});
