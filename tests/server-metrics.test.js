const assert = require("node:assert/strict");
const test = require("node:test");
const { publicServerMetrics } = require("../tools/server-metrics");

test("exposes aggregate TeamSpeak metrics without counting Query clients", () => {
  assert.deepEqual(publicServerMetrics({
    virtualserver_clientsonline: "15",
    virtualserver_queryclientsonline: "2",
    virtualserver_maxclients: "50",
    virtualserver_uptime: "3196800",
    virtualserver_total_bytes_downloaded: "32824328192",
    virtualserver_total_bytes_uploaded: "59088089907"
  }), {
    slotsUsed: 13,
    slotsTotal: 50,
    uptimeSeconds: 3196800,
    bytesDownloaded: 32824328192,
    bytesUploaded: 59088089907
  });
});

test("normalizes missing and invalid TeamSpeak metrics", () => {
  assert.deepEqual(publicServerMetrics({
    virtualserver_clientsonline: "1",
    virtualserver_queryclientsonline: "3",
    virtualserver_maxclients: "invalid",
    virtualserver_uptime: "-1"
  }), {
    slotsUsed: 0,
    slotsTotal: 0,
    uptimeSeconds: 0,
    bytesDownloaded: 0,
    bytesUploaded: 0
  });
});
