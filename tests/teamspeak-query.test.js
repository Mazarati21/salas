const assert = require("node:assert/strict");
const test = require("node:test");
const { fallbackQueryNickname, normalizeQueryNickname, parseItems, tsEscape } = require("../tools/teamspeak-query");

test("escapes values for the TeamSpeak query protocol", () => {
  assert.equal(tsEscape("Sala / A|B\\C"), "Sala\\s\\/\\sA\\pB\\\\C");
});

test("parses and unescapes TeamSpeak query records", () => {
  assert.deepEqual(parseItems("clid=1 client_nickname=Nome\\sUm|clid=2 client_nickname=Outro"), [
    { clid: "1", client_nickname: "Nome Um" },
    { clid: "2", client_nickname: "Outro" }
  ]);
});

test("keeps configured and fallback Query nicknames within TeamSpeak limits", () => {
  assert.equal(normalizeQueryNickname("  LegendZ Salas  "), "LegendZ Salas");
  assert.equal(Array.from(normalizeQueryNickname("x".repeat(50))).length, 30);
  const fallback = fallbackQueryNickname("Nome muito longo para a ligação ServerQuery", 12345, 1_700_000_000_000);
  assert.ok(Array.from(fallback).length <= 30);
  assert.match(fallback, /-12345-/);
});
