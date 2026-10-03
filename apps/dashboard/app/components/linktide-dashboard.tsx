"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type BusinessProfile = {
  name: string;
  website: string;
  phone: string;
  email: string;
  contactName: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primaryCategory: string;
  niches: string;
  services: string;
  locations: string;
  descriptionShort: string;
  descriptionLong: string;
  facebook: string;
  linkedin: string;
  instagram: string;
  logoPath: string;
};

type DiscoveryPlan = {
  aiUsed: boolean;
  additionalNiches: string[];
  directoryTypes: string[];
  queries: string[];
};

type QualifiedOpportunity = {
  id: string;
  title: string;
  url: string;
  domain: string;
  description: string;
  query: string;
  opportunityType:
    | "local_citation"
    | "industry_directory"
    | "association"
    | "partner_directory"
    | "resource_page"
    | "sponsorship"
    | "other";
  relevanceScore: number;
  spamRisk: "low" | "medium" | "high";
  submissionLikely: boolean;
  action: "queue" | "review" | "skip";
  reason: string;
};

type SearchRun = {
  provider: string;
  aiUsed: boolean;
  searchesRun: number;
  rawResults: number;
  uniqueDomains: number;
  queued: number;
  review: number;
  skipped: number;
  opportunities: QualifiedOpportunity[];
};

type WorkerState = "checking" | "online" | "offline";

type AutomationResult = {
  status?: string;
  submitted?: boolean;
  browserLeftOpen?: boolean;
  reasons?: string[];
  title?: string;
  submissionPageUrl?: string;
  checkpoints?: string[];
  selectedFormIndex?: number;
  aiUsed?: boolean;
  mappingQuality?: {
    averageConfidence: number;
    mappedCount: number;
    requiredUnmapped: Array<{ key: string; label: string }>;
  };
  fillResult?: {
    filled: string[];
    skipped: Array<{ key: string; reason: string }>;
  };
  decision?: {
    canAutoSubmit: boolean;
    reasons: string[];
  };
  recipeUsed?: boolean;
  recipeSaved?: boolean;
  recipeCoverage?: number;
  account?: {
    status?: string;
    accountCreated?: boolean;
    existingCredential?: boolean;
    verificationPending?: boolean;
  };
  inspection?: {
    title?: string;
    submissionPageUrl?: string;
    checkpoints?: string[];
    forms?: Array<{ formIndex: number; fields: unknown[] }>;
  };
};

const workerUrl =
  process.env.NEXT_PUBLIC_LINKTIDE_WORKER_URL ?? "http://127.0.0.1:4317";

const emptyProfile: BusinessProfile = {
  name: "",
  website: "",
  phone: "",
  email: "",
  contactName: "",
  address1: "",
  address2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "United States",
  primaryCategory: "",
  niches: "",
  services: "",
  locations: "",
  descriptionShort: "",
  descriptionLong: "",
  facebook: "",
  linkedin: "",
  instagram: "",
  logoPath: ""
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function percent(value?: number) {
  if (typeof value !== "number") return "—";
  return `${Math.round(value * 100)}%`;
}

export function LinkTideDashboard() {
  const [profile, setProfile] = useState<BusinessProfile>(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [lmStatus, setLmStatus] = useState<
    "unknown" | "testing" | "connected" | "missing" | "error"
  >("unknown");
  const [lmMessage, setLmMessage] = useState("Not tested yet");
  const [workerState, setWorkerState] = useState<WorkerState>("checking");
  const [workerMessage, setWorkerMessage] = useState("Checking local worker...");
  const [discovering, setDiscovering] = useState(false);
  const [plan, setPlan] = useState<DiscoveryPlan | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchRun, setSearchRun] = useState<SearchRun | null>(null);
  const [activeAutomationId, setActiveAutomationId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchMessage, setBatchMessage] = useState("");
  const [automationResults, setAutomationResults] = useState<
    Record<string, AutomationResult>
  >({});
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem("linktide.businessProfile");
    if (raw) {
      try {
        setProfile({ ...emptyProfile, ...JSON.parse(raw) });
        setSaved(true);
      } catch {
        window.localStorage.removeItem("linktide.businessProfile");
      }
    }

    const queue = window.localStorage.getItem("linktide.opportunityQueue");
    if (queue) {
      try {
        setSearchRun(JSON.parse(queue));
      } catch {
        window.localStorage.removeItem("linktide.opportunityQueue");
      }
    }

    void testWorker();
  }, []);

  const isReady = useMemo(
    () =>
      Boolean(
        profile.name.trim() &&
          profile.website.trim() &&
          (profile.niches.trim() || profile.services.trim())
      ),
    [profile]
  );

  function update<K extends keyof BusinessProfile>(
    field: K,
    value: BusinessProfile[K]
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function saveProfile(event?: FormEvent) {
    event?.preventDefault();
    window.localStorage.setItem(
      "linktide.businessProfile",
      JSON.stringify(profile)
    );
    setSaved(true);
  }

  function workerBusiness() {
    return {
      name: profile.name,
      website: profile.website,
      phone: profile.phone || undefined,
      email: profile.email || undefined,
      contactName: profile.contactName || undefined,
      address1: profile.address1 || undefined,
      address2: profile.address2 || undefined,
      city: profile.city || undefined,
      state: profile.state || undefined,
      postalCode: profile.postalCode || undefined,
      country: profile.country || undefined,
      primaryCategory: profile.primaryCategory || undefined,
      descriptionShort: profile.descriptionShort || undefined,
      descriptionLong: profile.descriptionLong || undefined,
      serviceAreas: splitCsv(profile.locations),
      services: splitCsv(profile.services),
      facebook: profile.facebook || undefined,
      linkedin: profile.linkedin || undefined,
      instagram: profile.instagram || undefined,
      logoPath: profile.logoPath || undefined
    };
  }

  async function testWorker() {
    setWorkerState("checking");
    setWorkerMessage("Checking local worker...");

    try {
      const response = await fetch(`${workerUrl}/health`);
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Worker did not respond.");
      }

      setWorkerState("online");
      setWorkerMessage(
        [
          "Browser worker online",
          result.vaultConfigured ? `${result.credentials ?? 0} encrypted account(s)` : "vault key missing",
          `${result.recipes ?? 0} learned recipe(s)`,
          result.lmStudioConfigured ? "LM Studio ready" : "LM Studio not configured"
        ].join(" · ")
      );
    } catch {
      setWorkerState("offline");
      setWorkerMessage("Worker offline. Run pnpm worker on this computer.");
    }
  }

  async function testLmStudio() {
    setLmStatus("testing");
    setLmMessage("Testing your configured LM Studio endpoint...");
    setError("");

    try {
      const response = await fetch("/api/lm-studio/test", { method: "POST" });
      const result = await response.json();

      if (!response.ok) {
        setLmStatus(result.configured === false ? "missing" : "error");
        setLmMessage(result.error ?? "LM Studio connection failed.");
        return;
      }

      setLmStatus("connected");
      setLmMessage(
        `Connected to ${result.model} via ${result.endpoint ?? "configured endpoint"}`
      );
    } catch (caught) {
      setLmStatus("error");
      setLmMessage(
        caught instanceof Error ? caught.message : "LM Studio connection failed."
      );
    }
  }

  async function discover() {
    if (!isReady) {
      setError("Add a business name, website, and at least one niche or service first.");
      return;
    }

    saveProfile();
    setDiscovering(true);
    setError("");

    try {
      const response = await fetch("/api/discovery/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: profile.name,
          website: profile.website,
          primaryCategory: profile.primaryCategory,
          niches: splitCsv(profile.niches),
          services: splitCsv(profile.services),
          locations: splitCsv(profile.locations),
          description: profile.descriptionLong || profile.descriptionShort
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Could not create discovery plan.");
      }

      setPlan(result);
      setSearchRun(null);
      setAutomationResults({});
      window.localStorage.removeItem("linktide.opportunityQueue");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create discovery plan."
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function searchAndQualify() {
    if (!plan?.queries.length) {
      setError("Build a discovery plan before running live search.");
      return;
    }

    setSearching(true);
    setError("");

    try {
      const response = await fetch("/api/discovery/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          business: {
            name: profile.name,
            website: profile.website,
            primaryCategory: profile.primaryCategory,
            niches: splitCsv(profile.niches),
            services: splitCsv(profile.services),
            locations: splitCsv(profile.locations)
          },
          queries: plan.queries
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Live discovery failed.");
      }

      setSearchRun(result);
      setAutomationResults({});
      window.localStorage.setItem(
        "linktide.opportunityQueue",
        JSON.stringify(result)
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Live discovery failed.");
    } finally {
      setSearching(false);
    }
  }

  async function runAutomation(
    item: QualifiedOpportunity,
    mode: "inspect" | "submit"
  ) {
    saveProfile();
    setActiveAutomationId(item.id);
    setError("");

    try {
      const response = await fetch(
        `${workerUrl}/${mode === "inspect" ? "inspect" : "submit"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: item.url,
            business: workerBusiness(),
            autoSubmit: mode === "submit",
            autoCreateAccount: mode === "submit"
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error ?? "Automation job failed.");
      }

      setAutomationResults((current) => ({
        ...current,
        [item.id]: result
      }));

      setWorkerState("online");
      setWorkerMessage("Browser worker online");
    } catch (caught) {
      setWorkerState("offline");
      const message =
        caught instanceof Error ? caught.message : "Automation job failed.";
      setWorkerMessage("Worker unavailable or job failed.");
      setError(message);
    } finally {
      setActiveAutomationId(null);
    }
  }

  async function processQueue() {
    const queued =
      searchRun?.opportunities.filter((item) => item.action === "queue") ?? [];

    if (!queued.length) {
      setError("There are no queued opportunities to process.");
      return;
    }

    setBatchRunning(true);
    setBatchMessage(`Starting 0 / ${queued.length}`);
    setError("");

    try {
      for (let index = 0; index < queued.length; index += 1) {
        const item = queued[index];
        setActiveAutomationId(item.id);
        setBatchMessage(`Processing ${index + 1} / ${queued.length}: ${item.domain}`);

        const response = await fetch(`${workerUrl}/submit`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: item.url,
            business: workerBusiness(),
            autoSubmit: true,
            autoCreateAccount: true
          })
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? `Automation failed for ${item.domain}.`);
        }

        setAutomationResults((current) => ({
          ...current,
          [item.id]: result
        }));

        if (!result.submitted || result.browserLeftOpen) {
          setBatchMessage(
            `Paused at ${item.domain}. Complete the human step in the open browser, then run the queue again.`
          );
          return;
        }
      }

      setBatchMessage(`Finished all ${queued.length} queued opportunities.`);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Queue automation failed.";
      setError(message);
      setBatchMessage("Queue stopped because of an error.");
    } finally {
      setActiveAutomationId(null);
      setBatchRunning(false);
    }
  }

  const statusClass =
    lmStatus === "connected"
      ? "status good"
      : lmStatus === "error" || lmStatus === "missing"
        ? "status bad"
        : "status";

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LINKTIDE</p>
          <h1>Backlink Command Center</h1>
          <p className="muted lead">
            Discover relevant directories, qualify them with your local AI, and
            hand safe submissions to a real browser running on your computer.
          </p>
        </div>
        <div className="topActions">
          <button className="secondary" onClick={testWorker} type="button">
            Check Worker
          </button>
          <button className="secondary" onClick={testLmStudio} type="button">
            {lmStatus === "testing" ? "Testing..." : "Test LM Studio"}
          </button>
          <button className="primary" onClick={discover} type="button">
            {discovering ? "Building plan..." : "Discover Opportunities"}
          </button>
        </div>
      </header>

      <section className="stats">
        <article className="card">
          <span>Business profile</span>
          <strong>{saved ? "Saved" : "Draft"}</strong>
        </article>
        <article className="card">
          <span>Browser worker</span>
          <strong>{workerState === "online" ? "Online" : workerState === "checking" ? "…" : "Offline"}</strong>
        </article>
        <article className="card">
          <span>Search queries</span>
          <strong>{plan?.queries.length ?? 0}</strong>
        </article>
        <article className="card">
          <span>Qualified opportunities</span>
          <strong>{searchRun?.opportunities.length ?? 0}</strong>
        </article>
      </section>

      <section className="workspace">
        <form className="panel profilePanel" onSubmit={saveProfile}>
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">BUSINESS PROFILE</p>
              <h2>Reusable directory submission data</h2>
            </div>
            <span className={saved ? "status good" : "status"}>
              {saved ? "Saved locally" : "Unsaved changes"}
            </span>
          </div>

          <div className="formGrid">
            <label>
              Business name
              <input value={profile.name} onChange={(e) => update("name", e.target.value)} placeholder="Tide & Type Co." />
            </label>

            <label>
              Website
              <input value={profile.website} onChange={(e) => update("website", e.target.value)} placeholder="https://example.com" inputMode="url" />
            </label>

            <label>
              Contact name
              <input value={profile.contactName} onChange={(e) => update("contactName", e.target.value)} placeholder="Primary contact" />
            </label>

            <label>
              Primary category
              <input value={profile.primaryCategory} onChange={(e) => update("primaryCategory", e.target.value)} placeholder="Digital Marketing Agency" />
            </label>

            <label>
              Phone
              <input value={profile.phone} onChange={(e) => update("phone", e.target.value)} placeholder="Business phone" />
            </label>

            <label>
              Email
              <input value={profile.email} onChange={(e) => update("email", e.target.value)} placeholder="Business email" inputMode="email" />
            </label>

            <label className="wide">
              Address
              <input value={profile.address1} onChange={(e) => update("address1", e.target.value)} placeholder="Street address" />
            </label>

            <label>
              Address line 2
              <input value={profile.address2} onChange={(e) => update("address2", e.target.value)} placeholder="Suite / unit" />
            </label>

            <label>
              City
              <input value={profile.city} onChange={(e) => update("city", e.target.value)} />
            </label>

            <label>
              State / Province
              <input value={profile.state} onChange={(e) => update("state", e.target.value)} />
            </label>

            <label>
              Postal code
              <input value={profile.postalCode} onChange={(e) => update("postalCode", e.target.value)} />
            </label>

            <label>
              Country
              <input value={profile.country} onChange={(e) => update("country", e.target.value)} />
            </label>

            <label>
              Niches
              <input value={profile.niches} onChange={(e) => update("niches", e.target.value)} placeholder="SEO, web design, digital marketing" />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Services
              <input value={profile.services} onChange={(e) => update("services", e.target.value)} placeholder="Local SEO, WordPress, PPC, CRM" />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Target / service locations
              <input value={profile.locations} onChange={(e) => update("locations", e.target.value)} placeholder="Florida, Volusia County, Ormond Beach" />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Short description
              <textarea rows={3} value={profile.descriptionShort} onChange={(e) => update("descriptionShort", e.target.value)} placeholder="Short reusable directory description" />
            </label>

            <label className="wide">
              Long description
              <textarea rows={5} value={profile.descriptionLong} onChange={(e) => update("descriptionLong", e.target.value)} placeholder="Longer company description for richer listing forms" />
            </label>

            <label>
              Facebook URL
              <input value={profile.facebook} onChange={(e) => update("facebook", e.target.value)} />
            </label>

            <label>
              LinkedIn URL
              <input value={profile.linkedin} onChange={(e) => update("linkedin", e.target.value)} />
            </label>

            <label>
              Instagram URL
              <input value={profile.instagram} onChange={(e) => update("instagram", e.target.value)} />
            </label>

            <label>
              Local logo file path
              <input value={profile.logoPath} onChange={(e) => update("logoPath", e.target.value)} placeholder="/Users/you/logo.png" />
              <small>Used by the local Playwright worker for file uploads.</small>
            </label>
          </div>

          <div className="formActions">
            <button className="secondary" type="submit">Save Profile</button>
            <span className="muted tiny">
              Business data stays in this browser for V1. Secrets stay in your local .env.
            </span>
          </div>
        </form>

        <aside className="sideStack">
          <section className="panel compact">
            <p className="eyebrow">LOCAL BROWSER</p>
            <h2>Playwright worker</h2>
            <p className="muted">
              LinkTide opens and fills third-party directory forms in a persistent
              Chromium profile on your machine.
            </p>
            <div className={workerState === "online" ? "status good" : workerState === "offline" ? "status bad" : "status"}>
              {workerMessage}
            </div>
            <button className="secondary full" onClick={testWorker} type="button">
              Test Worker
            </button>
          </section>

          <section className="panel compact">
            <p className="eyebrow">LOCAL AI</p>
            <h2>LM Studio</h2>
            <p className="muted">
              LM Studio expands discovery searches and maps unfamiliar form fields
              without sending your business profile to a hosted LLM.
            </p>
            <div className={statusClass}>{lmMessage}</div>
            <button className="secondary full" onClick={testLmStudio} type="button">
              Test Connection
            </button>
          </section>

          <section className="panel compact">
            <p className="eyebrow">GUARDRAILS</p>
            <h2>Human handoff</h2>
            <p className="muted">
              CAPTCHA, passwords, verification, required agreements, payment, or
              low-confidence mappings stop auto-submit and leave the browser tab open.
            </p>
          </section>
        </aside>
      </section>

      {error ? <div className="errorBanner">{error}</div> : null}

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">DISCOVERY PLAN</p>
            <h2>Niche and local search strategy</h2>
          </div>
          {plan ? (
            <span className={plan.aiUsed ? "status good" : "status"}>
              {plan.aiUsed ? "LM Studio enhanced" : "Rule-based fallback"}
            </span>
          ) : null}
        </div>

        {!plan ? (
          <div className="emptyState">
            <strong>No discovery plan yet.</strong>
            <p>Complete your profile and click <b>Discover Opportunities</b>.</p>
          </div>
        ) : (
          <>
            <div className="tagSections">
              <div>
                <h3>AI niche expansion</h3>
                <div className="tags">
                  {plan.additionalNiches.length ? (
                    plan.additionalNiches.map((item) => <span className="tag" key={item}>{item}</span>)
                  ) : (
                    <span className="muted">No additional niches returned.</span>
                  )}
                </div>
              </div>

              <div>
                <h3>Directory types to hunt</h3>
                <div className="tags">
                  {plan.directoryTypes.map((item) => <span className="tag" key={item}>{item}</span>)}
                </div>
              </div>
            </div>

            <div className="queryHeader">
              <div>
                <h3>{plan.queries.length} search queries ready</h3>
                <span className="muted tiny">
                  LinkTide runs a limited batch, dedupes domains, then asks LM Studio to qualify candidates.
                </span>
              </div>
              <button className="primary" onClick={searchAndQualify} type="button" disabled={searching}>
                {searching ? "Searching & qualifying..." : "Search & Qualify"}
              </button>
            </div>

            <div className="queryList">
              {plan.queries.map((query, index) => (
                <div className="query" key={`${query}-${index}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <code>{query}</code>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">OPPORTUNITY QUEUE</p>
            <h2>Inspect, fill, and submit</h2>
          </div>
          {searchRun ? (
            <div className="queueHeaderActions">
              <span className={searchRun.aiUsed ? "status good" : "status"}>
                {searchRun.aiUsed ? "LM Studio qualified" : "Fallback review"}
              </span>
              <button
                className="primary smallButton"
                type="button"
                onClick={processQueue}
                disabled={batchRunning || activeAutomationId !== null || searchRun.queued === 0}
              >
                {batchRunning ? "Running Queue..." : "Run Queue"}
              </button>
            </div>
          ) : null}
        </div>

        {!searchRun ? (
          <div className="emptyState">
            <strong>No live search has run yet.</strong>
            <p>Build the discovery plan, then click <b>Search &amp; Qualify</b>.</p>
          </div>
        ) : (
          <>
            {batchMessage ? (
              <div className={batchRunning ? "batchBanner active" : "batchBanner"}>
                {batchMessage}
              </div>
            ) : null}

            <div className="runStats">
              <div><span>Searches</span><strong>{searchRun.searchesRun}</strong></div>
              <div><span>Raw results</span><strong>{searchRun.rawResults}</strong></div>
              <div><span>Unique domains</span><strong>{searchRun.uniqueDomains}</strong></div>
              <div><span>Queue</span><strong>{searchRun.queued}</strong></div>
              <div><span>Review</span><strong>{searchRun.review}</strong></div>
              <div><span>Skipped</span><strong>{searchRun.skipped}</strong></div>
            </div>

            <div className="opportunityList">
              {searchRun.opportunities.map((item) => {
                const automation = automationResults[item.id];
                const inspection = automation?.inspection ?? automation;
                const busy = activeAutomationId === item.id;

                return (
                  <article className="opportunity" key={item.id}>
                    <div className="opportunityMain">
                      <div className="opportunityTitleRow">
                        <a href={item.url} target="_blank" rel="noreferrer">{item.title}</a>
                        <span className={`actionPill ${item.action}`}>{item.action}</span>
                      </div>

                      <p className="domain">{item.domain}</p>
                      <p className="muted opportunityDescription">
                        {item.description || "No search snippet available."}
                      </p>
                      <p className="reason">{item.reason}</p>

                      <div className="opportunityActions">
                        <button
                          className="secondary smallButton"
                          type="button"
                          disabled={busy || activeAutomationId !== null}
                          onClick={() => runAutomation(item, "inspect")}
                        >
                          {busy ? "Working..." : "Inspect"}
                        </button>
                        <button
                          className="primary smallButton"
                          type="button"
                          disabled={busy || activeAutomationId !== null || item.action === "skip"}
                          onClick={() => runAutomation(item, "submit")}
                        >
                          {busy ? "Working..." : "Fill & Submit"}
                        </button>
                      </div>

                      {automation ? (
                        <div className="automationResult">
                          <div className="automationResultHeader">
                            <strong>
                              {automation.status
                                ? automation.status.replaceAll("_", " ")
                                : "Inspection complete"}
                            </strong>
                            {automation.browserLeftOpen ? (
                              <span className="status warn">Browser left open for you</span>
                            ) : null}
                          </div>

                          <div className="automationFacts">
                            <span>
                              Form mapping: <b>{percent(automation.mappingQuality?.averageConfidence)}</b>
                            </span>
                            <span>
                              Fields mapped: <b>{automation.mappingQuality?.mappedCount ?? 0}</b>
                            </span>
                            <span>
                              Required unmapped: <b>{automation.mappingQuality?.requiredUnmapped?.length ?? 0}</b>
                            </span>
                            <span>
                              AI mapper: <b>{automation.aiUsed ? "yes" : "fallback"}</b>
                            </span>
                            <span>
                              Recipe: <b>{automation.recipeUsed ? "reused" : automation.recipeSaved ? "learned" : "new"}</b>
                            </span>
                            {automation.account ? (
                              <span>
                                Account: <b>{automation.account.verificationPending ? "verify email" : automation.account.accountCreated ? "created" : automation.account.existingCredential ? "stored login" : automation.account.status ?? "n/a"}</b>
                              </span>
                            ) : null}
                          </div>

                          {inspection?.submissionPageUrl ? (
                            <p className="tiny muted automationUrl">
                              Submission page: {inspection.submissionPageUrl}
                            </p>
                          ) : null}

                          {inspection?.checkpoints?.length ? (
                            <p className="automationWarning">
                              Human checkpoint: {inspection.checkpoints.join(", ")}
                            </p>
                          ) : null}

                          {automation.reasons?.length ? (
                            <p className="automationWarning">{automation.reasons.join(" ")}</p>
                          ) : null}

                          {automation.fillResult ? (
                            <p className="tiny muted">
                              Filled {automation.fillResult.filled.length} fields
                              {automation.fillResult.skipped.length
                                ? ` · ${automation.fillResult.skipped.length} skipped`
                                : ""}.
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="opportunityMeta">
                      <div className="scoreBox">
                        <span>Relevance</span>
                        <strong>{item.relevanceScore}</strong>
                      </div>
                      <span className={`riskPill ${item.spamRisk}`}>
                        {item.spamRisk} spam risk
                      </span>
                      <span className="typePill">
                        {item.opportunityType.replaceAll("_", " ")}
                      </span>
                      {item.submissionLikely ? (
                        <span className="status good">Submission path likely</span>
                      ) : (
                        <span className="status">Needs inspection</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
