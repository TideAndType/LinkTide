import assert from "node:assert/strict";
import test from "node:test";
import {
  rankSubmissionLinks,
  pickSubmissionForm,
  scoreSubmissionForm,
  DirectoryAccessError,
  retryAfterSeconds,
  type FormDescriptor,
  type OpportunityInspection
} from "./index";

function form(names: string[], page = "https://directory.example.com/") : {
  form: FormDescriptor; page: string;
} {
  return {
    page,
    form: {
      formIndex: 0, action: page, method: "POST",
      fields: names.map((name, i) => ({
        key: "0:" + i, formIndex: 0, fieldIndex: i,
        tag: "input" as const,
        type: name === "password" ? "password" : "text",
        name, id: name, label: name, placeholder: "",
        required: false, maxLength: null, options: []
      }))
    }
  };
}

test("navigates to add listing or claim listing, not unrelated site links", () => {
  const links = rankSubmissionLinks("https://directory.example.com/", [
    { text: "Privacy policy", href: "/privacy" },
    { text: "Claim Listing", href: "/claim-listing" },
    { text: "Add Your Business", href: "/add-business" },
    { text: "Subscribe to our newsletter", href: "/subscribe" },
    { text: "Submit Listing", href: "https://malicious.example.net/submit-listing" }
  ]);
  assert.equal(links.length, 2);
  assert.ok(links.some((link) => link.url.endsWith("/add-business")));
  assert.ok(links.some((link) => link.url.endsWith("/claim-listing")));
  assert.ok(links.every((link) => new URL(link.url).hostname === "directory.example.com"));
});

test("ignores site search form even if it has two fields", () => {
  const search = form(["search", "email"]);
  assert.ok(scoreSubmissionForm(search.form, search.page) < 7);
});

test("ignores login forms while preferring a directory's business listing form", () => {
  const login = form(["email", "password"], "https://directory.example.com/login");
  const listing = form(["businessName", "website", "phone", "address", "category"],
    "https://directory.example.com/add-business");
  listing.form.formIndex = 1;
  const inspection: OpportunityInspection = {
    requestedUrl: "https://directory.example.com/",
    finalUrl: listing.page,
    submissionPageUrl: listing.page,
    title: "Add your business", forms: [login.form, listing.form],
    checkpoints: ["account_auth"]
  };
  assert.equal(pickSubmissionForm(inspection)?.formIndex, 1);
  assert.ok(scoreSubmissionForm(listing.form, listing.page) >= 7);
  assert.ok(scoreSubmissionForm(login.form, login.page) < 7);
});

test("does not interpret a generic contact form as a listing submission", () => {
  const contact = form(["name", "email", "message"], "https://directory.example.com/contact");
  const inspection: OpportunityInspection = {
    requestedUrl: contact.page, finalUrl: contact.page,
    submissionPageUrl: contact.page, title: "Contact",
    forms: [contact.form], checkpoints: []
  };
  assert.equal(pickSubmissionForm(inspection), undefined);
});

test("uses same-site navigation but avoids external login and payments", () => {
  const links = rankSubmissionLinks("https://example.com/", [
    { text: "Submit Listing", href: "https://outside.net/add-business" },
    { text: "Business listings", href: "https://app.example.com/add-listing" },
    { text: "Buy Business Listing", href: "/checkout/add-listing" },
    { text: "Log In", href: "/login" }
  ]);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://app.example.com/add-listing");
});


test("understands Retry-After delta seconds and HTTP dates without retrying", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  assert.equal(retryAfterSeconds("120", now), 120);
  assert.equal(retryAfterSeconds("Sun, 18 Oct 2026 12:05:00 GMT", now), 300);
  assert.equal(retryAfterSeconds("invalid", now), undefined);
  assert.equal(retryAfterSeconds(null, now), undefined);
  assert.equal(retryAfterSeconds("Sun, 18 Oct 2026 11:59:00 GMT", now), 0);
});

test("distinguishes rate-limited directories from explicit 403 blocks", () => {
  const rateLimited = new DirectoryAccessError(429, "https://directory.example.com/add-listing", 3600);
  assert.equal(rateLimited.statusCode, 429);
  assert.equal(rateLimited.retryAfterSeconds, 3600);
  assert.match(rateLimited.message, /rate-limiting.*429/i);
  const denied = new DirectoryAccessError(403, "https://directory.example.com/claim");
  assert.equal(denied.statusCode, 403);
  assert.match(denied.message, /denied.*403/i);
});
