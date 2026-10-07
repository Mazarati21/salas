const assert = require("node:assert/strict");
const test = require("node:test");
const { hasAdminGroup, maskIp, sanitizeRateBucket } = require("../tools/admin-utils");

test("recognizes configured TeamSpeak administrator groups", () => {
  assert.equal(hasAdminGroup([7, 6, 12], new Set([6])), true);
  assert.equal(hasAdminGroup([7, 12], new Set([6])), false);
});

test("masks network addresses in administrative responses", () => {
  assert.equal(maskIp("185.113.141.10"), "185.113.141.*");
  assert.equal(maskIp("::ffff:185.113.141.10"), "185.113.141.*");
  assert.equal(maskIp("2001:db8:1::20"), "2001:db8:*");
  assert.deepEqual(sanitizeRateBucket("verify:185.113.141.10"), { kind: "verify", address: "185.113.141.*" });
});
