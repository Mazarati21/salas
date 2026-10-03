const assert = require("node:assert/strict");
const test = require("node:test");
const { parseItems, tsEscape } = require("../tools/teamspeak-query");

test("escapes values for the TeamSpeak query protocol", () => {
  assert.equal(tsEscape("Sala / A|B\\C"), "Sala\\s\\/\\sA\\pB\\\\C");
});

test("parses and unescapes TeamSpeak query records", () => {
  assert.deepEqual(parseItems("clid=1 client_nickname=Nome\\sUm|clid=2 client_nickname=Outro"), [
    { clid: "1", client_nickname: "Nome Um" },
    { clid: "2", client_nickname: "Outro" }
  ]);
});
