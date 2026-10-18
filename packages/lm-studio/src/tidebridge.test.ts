import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TIDEBRIDGE_LM_STUDIO,
  normalizeTideBridgeServer,
  readTideBridgeConnection
} from "./tidebridge";

test("only accepts LM Studio on the local Mac, never a public tunnel", () => {
  assert.equal(normalizeTideBridgeServer("http://127.0.0.1:1234/v1"),
    "http://127.0.0.1:1234/v1");
  assert.equal(normalizeTideBridgeServer("http://localhost:3412"),
    "http://localhost:3412/v1");
  for (const invalid of [
    "https://example.trycloudflare.com/v1",
    "http://192.168.1.50:1234/v1",
    "http://localhost:1234/api/v1/models",
    "file:///tmp/private",
    "http://user:pass@localhost:1234/v1",
    "http://127.0.0.1:1234/v1?token=secret",
    "http://localhost:1234/v1/chat/completions",
    "not a url"
  ]) {
    assert.equal(normalizeTideBridgeServer(invalid), undefined, invalid);
  }
});

test("imports TideBridge macOS preference without pairing or API tokens", () => {
  const read = readTideBridgeConnection({
    platform: "darwin",
    readPreference: () => "http://127.0.0.1:3412/v1\n"
  });
  assert.equal(read.source, "tidebridge");
  assert.equal(read.baseUrl, "http://127.0.0.1:3412/v1");
});

test("falls back to local only when TideBridge is not installed", () => {
  const read = readTideBridgeConnection({
    platform: "darwin",
    readPreference: () => { throw new Error("Preferences not found"); }
  });
  assert.equal(read.source, "localhost-default");
  assert.equal(read.baseUrl, DEFAULT_TIDEBRIDGE_LM_STUDIO);
});

test("rejects an external address stored in TideBridge preferences", () => {
  const read = readTideBridgeConnection({
    platform: "darwin",
    readPreference: () => "https://example.org/v1"
  });
  assert.equal(read.source, "localhost-default");
  assert.equal(read.baseUrl, DEFAULT_TIDEBRIDGE_LM_STUDIO);
});
