const assert = require("node:assert/strict");
const test = require("node:test");
const { evaluateTeamSpeakStructure, summarizeDiagnostics } = require("../tools/diagnostics");

const config = {
  tempSpacerCid: 902,
  protectedThinSeparatorCid: 33738,
  protectedThinSeparatorName: "[*spacer252f6c22]━",
  channelAdminGroupId: 49,
  adminGroupIds: [114, 232],
  founderGroupIds: [114]
};

test("reports a healthy TeamSpeak structure", () => {
  const checks = evaluateTeamSpeakStructure({
    channels: [{ cid: "902", channel_order: "33738" }, { cid: "33738", channel_name: config.protectedThinSeparatorName }, { cid: "4500" }],
    groups: [{ sgid: "114" }, { sgid: "232" }],
    channelGroups: [{ cgid: "49" }],
    roomChannelIds: [4500],
    config
  });
  assert.equal(summarizeDiagnostics(checks).overall, "pass");
});

test("distinguishes blocking failures from warnings", () => {
  const checks = evaluateTeamSpeakStructure({
    channels: [{ cid: "33738", channel_name: "nome errado" }],
    groups: [{ sgid: "232" }],
    channelGroups: [],
    roomChannelIds: [4500],
    config
  });
  const summary = summarizeDiagnostics(checks);
  assert.equal(summary.overall, "fail");
  assert.ok(summary.fail >= 2);
  assert.ok(summary.warn >= 1);
});
