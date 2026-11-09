const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizePublicBans } = require("../tools/public-bans");

test("collapses only publicly identical active bans", () => {
  const items = [
    { banid: "10", lastnickname: "Player", invokername: "Admin", reason: "Spam", created: "1000", duration: "0" },
    { banid: "11", lastnickname: " Player ", invokername: "Admin", reason: "Spam", created: "1000", duration: "0" },
    { banid: "12", lastnickname: "Player", invokername: "Admin", reason: "Outro motivo", created: "1000", duration: "0" }
  ];

  const bans = normalizePublicBans(items, 2000);
  assert.equal(bans.length, 2);
  assert.equal(bans.find((ban) => ban.reason === "Spam").technicalRecords, 2);
  assert.equal(bans.find((ban) => ban.reason === "Spam").id, 11);
});

test("removes expired bans and keeps separate dates", () => {
  const items = [
    { banid: "1", lastnickname: "A", created: "100", duration: "10" },
    { banid: "2", lastnickname: "A", created: "1000", duration: "0" },
    { banid: "3", lastnickname: "A", created: "1100", duration: "0" }
  ];

  const bans = normalizePublicBans(items, 500);
  assert.deepEqual(bans.map((ban) => ban.id), [3, 2]);
});
