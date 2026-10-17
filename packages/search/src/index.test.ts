import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSearchResultUrl,
  normalizeSearchResults
} from "./index";

test("unwraps DuckDuckGo redirect without contacting a tracking URL", () => {
  const wrapped = "//duckduckgo.com/l/?uddg=" +
    encodeURIComponent("https://example.org/directory?source=search") +
    "&rut=ignored";
  assert.equal(
    normalizeSearchResultUrl(wrapped),
    "https://example.org/directory?source=search"
  );
});

test("rejects unsafe and search-engine destinations", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<h1>test</h1>",
    "http://localhost:4317/settings",
    "https://duckduckgo.com/",
    "//duckduckgo.com/l/?rut=missing",
    "https://user:password@example.com/"
  ]) {
    assert.equal(normalizeSearchResultUrl(url), undefined);
  }
});

test("normalizes deduplicated, capped, clean search results", () => {
  const results = normalizeSearchResults("web design directory", [
    { title: " Business Directory ", url: "https://example.org/list/#top",
      description: "  List  your   business " },
    { title: " Duplicate ", url: "https://example.org/list/",
      description: "Not the same URL because query/hash handling is intentional." },
    { title: " Business Directory ", url: "https://example.org/list/#other",
      description: "Repeat" },
    { title: " Member Directory ", url: "https://chamber.example.com/",
      description: "Local directory" },
    { title: "", url: "https://empty.example.com/", description: "" }
  ], 10);

  assert.equal(results.length, 2);
  assert.equal(results[0].title, "Business Directory");
  assert.equal(results[0].domain, "example.org");
  assert.equal(results[0].description, "List  your   business");
  assert.equal(results[0].url, "https://example.org/list/");
  assert.equal(results[1].domain, "chamber.example.com");
  assert.equal(normalizeSearchResults("q", [
    { title: "A", url: "https://a.example.com/", description: "" },
    { title: "B", url: "https://b.example.com/", description: "" }
  ], 1).length, 1);
});

test("keeps direct HTTPS URLs and strips fragments", () => {
  assert.equal(
    normalizeSearchResultUrl("https://agency.example.com/join?ref=directory#steps"),
    "https://agency.example.com/join?ref=directory"
  );
});
