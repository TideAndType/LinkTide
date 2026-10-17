import assert from "node:assert/strict";
import test from "node:test";
import { createLmStudioClient, lmStudioEndpoint, openAiBaseUrl } from "./index";
import { listLoadedLmStudioModels, testLmStudioConnection } from "../../control-plane/src/index";

function mockFetch(implementation: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  return () => { globalThis.fetch = original; };
}

test("normalizes LM Studio origins, /v1 and copied endpoints", () => {
  assert.equal(openAiBaseUrl("http://localhost:1234"), "http://localhost:1234/v1");
  assert.equal(openAiBaseUrl("http://127.0.0.1:1234/v1/"), "http://127.0.0.1:1234/v1");
  assert.equal(openAiBaseUrl("https://test.example.com/v1/models"),
    "https://test.example.com/v1");
  assert.equal(openAiBaseUrl("https://test.example.com/proxy/v1/chat/completions?x=1"),
    "https://test.example.com/proxy/v1");
  assert.equal(lmStudioEndpoint("https://test.example.com", "models"),
    "https://test.example.com/v1/models");
  assert.throws(() => openAiBaseUrl("localhost:1234"), /complete LM Studio URL|HTTP/);
  assert.throws(() => openAiBaseUrl("file:///etc/passwd"), /HTTP/);
});

test("Chat uses compatible endpoint, model ID and bearer token", async () => {
  let calledUrl = "";
  let calledModel = "";
  let calledAuth = "";
  const restore = mockFetch(async (url, init) => {
    calledUrl = String(url);
    calledModel = JSON.parse(String(init?.body)).model;
    calledAuth = new Headers(init?.headers).get("authorization") ?? "";
    return Response.json({ choices: [{ message: { content: "CONNECTED" } }] });
  });
  try {
    const client = createLmStudioClient({
      baseUrl: "http://127.0.0.1:1234",
      model: "qwen/test",
      apiKey: "secret"
    });
    assert.equal(await client.chat([{ role: "user", content: "ping" }]), "CONNECTED");
    assert.equal(calledUrl, "http://127.0.0.1:1234/v1/chat/completions");
    assert.equal(calledModel, "qwen/test");
    assert.equal(calledAuth, "Bearer secret");
  } finally { restore(); }
});

test("Model discovery uses /v1/models over a tunneled URL", async () => {
  const urls: string[] = [];
  const restore = mockFetch(async (url) => {
    urls.push(String(url));
    return Response.json({ data: [
      { id: "qwen/qwen3.6-35b-a3b", object: "model" },
      { id: "text-embedding-local", type: "embedding" }
    ] });
  });
  try {
    const result = await listLoadedLmStudioModels({
      baseUrl: "https://tunnel.example.com/v1"
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.models.length, 1);
    assert.equal(result.body.models[0].id, "qwen/qwen3.6-35b-a3b");
    assert.deepEqual(urls, ["https://tunnel.example.com/v1/models"]);
  } finally { restore(); }
});

test("Falls back to native model discovery only after compatible 404", async () => {
  const urls: string[] = [];
  const restore = mockFetch(async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return new Response("Not Found", { status: 404 });
    return Response.json({ models: [{
      key: "qwen/example",
      display_name: "Example Qwen",
      type: "llm",
      loaded_instances: [{}]
    }] });
  });
  try {
    const result = await listLoadedLmStudioModels({
      baseUrl: "http://localhost:1234/v1"
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.models[0].id, "qwen/example");
    assert.deepEqual(urls, [
      "http://localhost:1234/v1/models",
      "http://localhost:1234/api/v1/models"
    ]);
  } finally { restore(); }
});

test("A valid model response passes connection test without exact sentinel", async () => {
  let selectedModel = "";
  const restore = mockFetch(async (_url, init) => {
    selectedModel = JSON.parse(String(init?.body)).model;
    return Response.json({ choices: [{ message: { content: "I am connected." } }] });
  });
  try {
    const result = await testLmStudioConnection({
      baseUrl: "http://127.0.0.1:1234",
      model: "unsaved-model"
    });
    assert.equal(result.status, 200);
    assert.equal(selectedModel, "unsaved-model");
    assert.ok(result.body.warning);
  } finally { restore(); }
});

test("Auth failures report an actionable error instead of treating them as connection success", async () => {
  const restore = mockFetch(async () =>
    new Response("Unauthorized", { status: 401 }));
  try {
    const result = await testLmStudioConnection({
      baseUrl: "https://tunnel.example.com/v1",
      model: "qwen/example"
    });
    assert.equal(result.status, 502);
    assert.match(result.body.error ?? "", /401.*token/i);
  } finally { restore(); }
});
