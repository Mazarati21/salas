const test = require("node:test");
const assert = require("node:assert/strict");
const { discoverLegacyRooms } = require("../tools/legacy-rooms");

function channel(cid, pid, order, name, extra = {}) {
  return { cid: String(cid), pid: String(pid), channel_order: String(order), channel_name: name, ...extra };
}

test("discovers contiguous legacy rooms above the protected separator", () => {
  const channels = [
    channel(10, 0, 0, "Lobby"),
    channel(20, 0, 10, "[*spacerA]▂▂▂▂"),
    channel(21, 0, 20, "[cspacerA]Sala Alpha"),
    channel(30, 0, 21, "[*spacerB]━"),
    channel(31, 0, 30, "[cspacerB]Sala Beta"),
    channel(99, 0, 31, "[*spacer252f6c22]━"),
    channel(100, 0, 99, "[cspacer212]═════════════════════"),
    channel(22, 21, 0, "● Convivio 1", { channel_flag_password: "1" }),
    channel(23, 21, 22, "● Convivio 2"),
    channel(32, 31, 0, "• Jogos")
  ];
  const assignments = [
    { cgid: "49", cid: "21", cldbid: "501", client_nickname: "Alpha" },
    { cgid: "49", cid: "31", cldbid: "502", client_nickname: "Beta" }
  ];
  const result = discoverLegacyRooms({ channels, assignments, protectedSeparatorCid: 99, channelAdminGroupId: 49 });
  assert.deepEqual(result.candidates.map((room) => room.title), ["Sala Beta", "Sala Alpha"]);
  assert.equal(result.candidates[1].ownerDatabaseId, 501);
  assert.deepEqual(result.candidates[1].channels.map((item) => item.name), ["Convivio 1", "Convivio 2"]);
  assert.equal(result.candidates[1].channels[0].passwordProtected, true);
});

test("skips tracked rooms and refuses ambiguous ownership", () => {
  const channels = [
    channel(20, 0, 0, "[*spacerA]▂▂▂▂"), channel(21, 0, 20, "[cspacerA]Tracked"),
    channel(30, 0, 21, "[*spacerB]▂▂▂▂"), channel(31, 0, 30, "[cspacerB]Ambiguous"),
    channel(99, 0, 31, "[*spacer252f6c22]━"),
    channel(22, 21, 0, "● Um"), channel(32, 31, 0, "● Dois")
  ];
  const assignments = [
    { cgid: "49", cid: "21", cldbid: "501" },
    { cgid: "49", cid: "31", cldbid: "502" },
    { cgid: "49", cid: "31", cldbid: "503" }
  ];
  const result = discoverLegacyRooms({ channels, assignments, trackedParentCids: [21], protectedSeparatorCid: 99, channelAdminGroupId: 49 });
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.skipped.map((item) => item.reason), ["owner-not-unique", "already-tracked"]);
});

test("does not scan unrelated channels beyond the contiguous room block", () => {
  const channels = [
    channel(5, 0, 0, "[*spacerX]▂▂▂▂"), channel(6, 0, 5, "[cspacerX]Unrelated"),
    channel(7, 0, 6, "Regular channel"),
    channel(20, 0, 7, "[*spacerA]▂▂▂▂"), channel(21, 0, 20, "[cspacerA]Valid"),
    channel(99, 0, 21, "[*spacer252f6c22]━"), channel(22, 21, 0, "● Um")
  ];
  const assignments = [
    { cgid: "49", cid: "6", cldbid: "400" }, { cgid: "49", cid: "21", cldbid: "501" }
  ];
  const result = discoverLegacyRooms({ channels, assignments, protectedSeparatorCid: 99, channelAdminGroupId: 49 });
  assert.deepEqual(result.candidates.map((room) => room.title), ["Valid"]);
});
