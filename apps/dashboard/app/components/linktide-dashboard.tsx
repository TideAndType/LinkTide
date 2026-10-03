"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type BusinessProfile = {
  name: string;
  website: string;
  phone: string;
  email: string;
  primaryCategory: string;
  niches: string;
  services: string;
  locations: string;
  descriptionShort: string;
  descriptionLong: string;
};

type DiscoveryPlan = {
  aiUsed: boolean;
  additionalNiches: string[];
  directoryTypes: string[];
  queries: string[];
};

const emptyProfile: BusinessProfile = {
  name: "",
  website: "",
  phone: "",
  email: "",
  primaryCategory: "",
  niches: "",
  services: "",
  locations: "",
  descriptionShort: "",
  descriptionLong: ""
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function LinkTideDashboard() {
  const [profile, setProfile] = useState<BusinessProfile>(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [lmStatus, setLmStatus] = useState<
    "unknown" | "testing" | "connected" | "missing" | "error"
  >("unknown");
  const [lmMessage, setLmMessage] = useState("Not tested yet");
  const [discovering, setDiscovering] = useState(false);
  const [plan, setPlan] = useState<DiscoveryPlan | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const raw = window.localStorage.getItem("linktide.businessProfile");
    if (!raw) return;

    try {
      setProfile({ ...emptyProfile, ...JSON.parse(raw) });
      setSaved(true);
    } catch {
      window.localStorage.removeItem("linktide.businessProfile");
    }
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
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not create discovery plan."
      );
    } finally {
      setDiscovering(false);
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
            Build a reusable business profile, connect your local AI, then
            generate niche and location-specific directory searches for the
            submission engine.
          </p>
        </div>
        <div className="topActions">
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
          <span>LM Studio</span>
          <strong>{lmStatus === "connected" ? "Online" : "Check"}</strong>
        </article>
        <article className="card">
          <span>Search queries</span>
          <strong>{plan?.queries.length ?? 0}</strong>
        </article>
        <article className="card">
          <span>AI expansion</span>
          <strong>{plan?.aiUsed ? "On" : "—"}</strong>
        </article>
      </section>

      <section className="workspace">
        <form className="panel profilePanel" onSubmit={saveProfile}>
          <div className="sectionHeading">
            <div>
              <p className="eyebrow">BUSINESS PROFILE</p>
              <h2>Tell LinkTide what you want backlinks for</h2>
            </div>
            <span className={saved ? "status good" : "status"}>
              {saved ? "Saved locally" : "Unsaved changes"}
            </span>
          </div>

          <div className="formGrid">
            <label>
              Business name
              <input
                value={profile.name}
                onChange={(event) => update("name", event.target.value)}
                placeholder="Tide & Type Co."
              />
            </label>

            <label>
              Website
              <input
                value={profile.website}
                onChange={(event) => update("website", event.target.value)}
                placeholder="https://example.com"
                inputMode="url"
              />
            </label>

            <label>
              Primary category
              <input
                value={profile.primaryCategory}
                onChange={(event) => update("primaryCategory", event.target.value)}
                placeholder="Digital Marketing Agency"
              />
            </label>

            <label>
              Phone
              <input
                value={profile.phone}
                onChange={(event) => update("phone", event.target.value)}
                placeholder="Optional"
              />
            </label>

            <label>
              Email
              <input
                value={profile.email}
                onChange={(event) => update("email", event.target.value)}
                placeholder="Optional"
                inputMode="email"
              />
            </label>

            <label>
              Niches
              <input
                value={profile.niches}
                onChange={(event) => update("niches", event.target.value)}
                placeholder="SEO, web design, digital marketing"
              />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Services
              <input
                value={profile.services}
                onChange={(event) => update("services", event.target.value)}
                placeholder="Local SEO, WordPress, PPC, CRM, email marketing"
              />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Target locations
              <input
                value={profile.locations}
                onChange={(event) => update("locations", event.target.value)}
                placeholder="Florida, Volusia County, Ormond Beach, Daytona Beach"
              />
              <small>Comma separated</small>
            </label>

            <label className="wide">
              Short description
              <textarea
                rows={3}
                value={profile.descriptionShort}
                onChange={(event) => update("descriptionShort", event.target.value)}
                placeholder="Short reusable directory description"
              />
            </label>

            <label className="wide">
              Long description
              <textarea
                rows={5}
                value={profile.descriptionLong}
                onChange={(event) => update("descriptionLong", event.target.value)}
                placeholder="Longer company description for richer listing forms"
              />
            </label>
          </div>

          <div className="formActions">
            <button className="secondary" type="submit">
              Save Profile
            </button>
            <span className="muted tiny">
              V1 stores this profile in your browser. Database persistence comes next.
            </span>
          </div>
        </form>

        <aside className="sideStack">
          <section className="panel compact">
            <p className="eyebrow">LOCAL AI</p>
            <h2>LM Studio</h2>
            <p className="muted">
              The API key and tunnel URL stay server-side. LinkTide uses the
              connection to expand niches and produce smarter discovery queries.
            </p>
            <div className={statusClass}>{lmMessage}</div>
            <button className="secondary full" onClick={testLmStudio} type="button">
              Test Connection
            </button>
          </section>

          <section className="panel compact">
            <p className="eyebrow">SUBMISSION SAFETY</p>
            <h2>Human checkpoints</h2>
            <p className="muted">
              CAPTCHA, payment, verification codes, and unusual agreements will
              pause instead of being auto-approved.
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
            <p>
              Complete your profile and click <b>Discover Opportunities</b>.
            </p>
          </div>
        ) : (
          <>
            <div className="tagSections">
              <div>
                <h3>AI niche expansion</h3>
                <div className="tags">
                  {plan.additionalNiches.length ? (
                    plan.additionalNiches.map((item) => (
                      <span className="tag" key={item}>
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="muted">No additional niches returned.</span>
                  )}
                </div>
              </div>

              <div>
                <h3>Directory types to hunt</h3>
                <div className="tags">
                  {plan.directoryTypes.map((item) => (
                    <span className="tag" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="queryHeader">
              <h3>{plan.queries.length} search queries ready</h3>
              <span className="muted tiny">
                Actual search + qualification is the next engine layer.
              </span>
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
    </main>
  );
}
