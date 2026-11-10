const assert = require("node:assert/strict");
const test = require("node:test");
const { clientsInChannels, findEvacuationChannel, roomChannelIds } = require("../tools/room-deletion");

test("collects every channel belonging to a room", () => {
  assert.deepEqual(roomChannelIds({
    channels: [{ cid: 103 }, { cid: "104" }],
    teamspeak: { parentCid: 102, topLineCid: 101 }
  }), [103, 104, 102, 101]);
});

test("finds clients inside channels scheduled for deletion", () => {
  const occupants = clientsInChannels([
    { clid: "7", cid: "103" },
    { clid: "8", cid: "200" },
    { clid: "9", cid: "104" }
  ], new Set([103, 104]));
  assert.deepEqual(occupants.map((client) => client.clid), ["7", "9"]);
});

test("uses the default channel as a safe evacuation target", () => {
  const channels = [
    { cid: "103", channel_flag_default: "0" },
    { cid: "1", channel_flag_default: "1" }
  ];
  assert.equal(findEvacuationChannel(channels, new Set([103, 104])), 1);
  assert.equal(findEvacuationChannel(channels, new Set([1, 103])), null);
});
