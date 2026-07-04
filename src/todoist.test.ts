import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenFromEnvFileText } from "./todoist.js";

test("tokenFromEnvFileText: plain unquoted line", () => {
  assert.equal(tokenFromEnvFileText("TODOIST_API_TOKEN=abc123"), "abc123");
});

test("tokenFromEnvFileText: double-quoted value has quotes stripped", () => {
  assert.equal(tokenFromEnvFileText('TODOIST_API_TOKEN="abc123"'), "abc123");
});

test("tokenFromEnvFileText: single-quoted value has quotes stripped", () => {
  assert.equal(tokenFromEnvFileText("TODOIST_API_TOKEN='abc123'"), "abc123");
});

test("tokenFromEnvFileText: ignores comments and blank lines, finds the token", () => {
  const text = [
    "# this is my todoist token file",
    "",
    "  # another comment",
    "TODOIST_API_TOKEN=abc123",
    "",
  ].join("\n");
  assert.equal(tokenFromEnvFileText(text), "abc123");
});

test("tokenFromEnvFileText: whitespace around key/value is trimmed", () => {
  assert.equal(tokenFromEnvFileText("  TODOIST_API_TOKEN =  abc123  "), "abc123");
});

test("tokenFromEnvFileText: missing key returns undefined", () => {
  assert.equal(tokenFromEnvFileText("SOME_OTHER_VAR=xyz\n"), undefined);
});

test("tokenFromEnvFileText: empty file returns undefined", () => {
  assert.equal(tokenFromEnvFileText(""), undefined);
});

test("tokenFromEnvFileText: key present but value empty returns undefined", () => {
  assert.equal(tokenFromEnvFileText("TODOIST_API_TOKEN="), undefined);
});
