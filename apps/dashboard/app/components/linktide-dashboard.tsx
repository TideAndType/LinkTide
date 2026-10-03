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

type AppSettings = {
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  lmStudioApiKey: string;
  braveSearchApiKey: string;
};

type PublicSettings = {
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  hasLmStudioApiKey: boolean;
  hasBraveSearchApiKey: boolean;
  searchMaxQueries: number;
  searchResultsPerQuery: number;
};

type LoadedLmStudioModel = {
  id: string;
  label: string;
  loadedInstances: number;
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

type SubmissionHistoryStatus =
  | "pending"
  | "verification_required"
  | "live"
  | "rejected"
  | "needs_attention"
  | "failed";

type SubmissionHistoryRecord = {
  id: string;
  businessName: string;
  businessWebsite: string;
  domain: string;
  opportunityUrl: string;
  submissionUrl?: string;
  listingUrl?: string;
  status: SubmissionHistoryStatus;
  submissionStatus?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  lastVerifiedAt?: string;
  backlinkFound: boolean;
  backlinkUrl?: string;
  backlinkText?: string;
  backlinkRel?: {
    nofollow: boolean;
    ugc: boolean;
    sponsored: boolean;
  };
  httpStatus?: number;
  verificationNote?: string;
  reasons: string[];
};

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

const emptySettings: AppSettings = {
  lmStudioBaseUrl: "",
  lmStudioModel: "",
  lmStudioApiKey: "",
  braveSearchApiKey: ""
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

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}


export function LinkTideDashboard() {
  const [profile, setProfile] = useState<BusinessProfile>(emptyProfile);
  const [saved, setSaved] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(emptySettings);
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("Loading settings...");
  const [lmStatus, setLmStatus] = useState<
    "unknown" | "testing" | "connected" | "missing" | "error"
  >("unknown");
  const [lmMessage, setLmMessage] = useState("Not tested yet");
  const [loadedModels, setLoadedModels] = useState<LoadedLmStudioModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelMessage, setModelMessage] = useState(
    "Enter your LM Studio tunnel to detect loaded models."
  );
  const [workerState, setWorkerState] = useState<WorkerState>("checking");
  const [workerMessage, setWorkerMessage] = useState("Starting LinkTide service...");
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
  const [history, setHistory] = useState<SubmissionHistoryRecord[]>([]);
  const [verifyingHistoryId, setVerifyingHistoryId] = useState<string | null>(null);
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

    void Promise.all([testWorker(), loadSettings(), loadHistory()]);
  }, []);

  useEffect(() => {
    const baseUrl = settings.lmStudioBaseUrl.trim();

    if (!baseUrl) {
      setLoadedModels([]);
      setModelMessage("Enter your LM Studio tunnel to detect loaded models.");
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshLmStudioModels(baseUrl, settings.lmStudioApiKey);
    }, 700);

    const interval = window.setInterval(() => {
      void refreshLmStudioModels(baseUrl, settings.lmStudioApiKey);
    }, 15_000);

    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [settings.lmStudioBaseUrl, settings.lmStudioApiKey]);

  const isReady = useMemo(
    () =>
      Boolean(
        profile.name.trim() &&
          profile.website.trim() &&
          (profile.niches.trim() || profile.services.trim())
      ),
    [profile]
  );

  const settingsReady = Boolean(
    publicSettings?.lmStudioBaseUrl &&
      publicSettings?.lmStudioModel &&
      publicSettings?.hasBraveSearchApiKey
  );

  function update<K extends keyof BusinessProfile>(
    field: K,
    value: BusinessProfile[K]
  ) {
    setProfile((current) => ({ ...current, [field]: value }));
    setSaved(false);
  }

  function updateSetting<K extends keyof AppSettings>(
    field: K,
    value: AppSettings[K]
  ) {
    setSettings((current) => ({ ...current, [field]: value }));
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

  async function loadHistory() {
    try {
      const response = await fetch(`${workerUrl}/history`);
      const result = (await response.json()) as {
        records?: SubmissionHistoryRecord[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Could not load submission history.");
      }

      setHistory(Array.isArray(result.records) ? result.records : []);
    } catch {
      // History is supplementary; worker status handles the visible service error.
    }
  }

  async function verifyHistoryRecord(id: string) {
    setVerifyingHistoryId(id);
    setError("");

    try {
      const response = await fetch(`${workerUrl}/history/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id })
      });

      const result = (await response.json()) as {
        record?: SubmissionHistoryRecord;
        error?: string;
      };

      if (!response.ok || !result.record) {
        throw new Error(result.error ?? "Backlink verification failed.");
      }

      setHistory((current) =>
        current.map((record) =>
          record.id === result.record?.id ? result.record : record
        )
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Backlink verification failed."
      );
    } finally {
      setVerifyingHistoryId(null);
    }
  }

  async function loadSettings() {
    try {
      const response = await fetch(`${workerUrl}/settings`);
      const result = (await response.json()) as PublicSettings & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Could not load settings.");
      }

      setPublicSettings(result);
      setSettings((current) => ({
        ...current,
        lmStudioBaseUrl: result.lmStudioBaseUrl ?? "",
        lmStudioModel: result.lmStudioModel ?? ""
      }));
      setSettingsMessage(
        result.hasBraveSearchApiKey
          ? "Settings saved on this Mac."
          : "Add your LM Studio and Brave Search settings."
      );
      void refreshLmStudioModels(result.lmStudioBaseUrl ?? "", "");
    } catch (caught) {
      setSettingsMessage(
        caught instanceof Error ? caught.message : "Could not load settings."
      );
    }
  }

  async function saveAppSettings(event?: FormEvent) {
    event?.preventDefault();
    setSavingSettings(true);
    setError("");

    try {
      const response = await fetch(`${workerUrl}/settings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const result = (await response.json()) as PublicSettings & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? "Could not save settings.");
      }

      setPublicSettings(result);
      setSettings((current) => ({
        ...current,
        lmStudioApiKey: "",
        braveSearchApiKey: ""
      }));
      setSettingsMessage("Saved locally. Secret fields were cleared from the screen.");
      await refreshLmStudioModels(result.lmStudioBaseUrl ?? "", "");
      await testWorker();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save settings.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function testWorker() {
    setWorkerState("checking");

    try {
      const response = await fetch(`${workerUrl}/health`);
      const result = await response.json();

      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "LinkTide service did not respond.");
      }

      setWorkerState("online");
      setWorkerMessage(
        [
          "Local service online",
          result.vaultConfigured
            ? `${result.credentials ?? 0} encrypted account(s)`
            : "vault initializing",
          `${result.recipes ?? 0} learned recipe(s)`,
          result.lmStudioConfigured ? "LM Studio ready" : "LM Studio needs setup"
        ].join(" · ")
      );
    } catch {
      setWorkerState("offline");
      setWorkerMessage("Local LinkTide service is unavailable. Restart the app.");
    }
  }

  async function refreshLmStudioModels(
    baseUrl = settings.lmStudioBaseUrl,
    apiKey = settings.lmStudioApiKey
  ) {
    if (!baseUrl.trim()) {
      setLoadedModels([]);
      setModelMessage("Enter your LM Studio tunnel to detect loaded models.");
      return;
    }

    setLoadingModels(true);

    try {
      const response = await fetch(`${workerUrl}/lm-studio/models`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: baseUrl.trim(),
          apiKey: apiKey.trim()
        })
      });

      const result = (await response.json()) as {
        models?: LoadedLmStudioModel[];
        count?: number;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error ?? "Could not detect loaded LM Studio models.");
      }

      const models = Array.isArray(result.models) ? result.models : [];
      setLoadedModels(models);

      if (!models.length) {
        setModelMessage("No loaded LLMs detected. Load a model in LM Studio.");
        return;
      }

      setModelMessage(
        `${models.length} loaded ${models.length === 1 ? "model" : "models"} detected.`
      );

      setSettings((current) => {
        const selected = models.some(
          (model) => model.id === current.lmStudioModel
        )
          ? current.lmStudioModel
          : models[0].id;

        if (selected !== current.lmStudioModel) {
          void fetch(`${workerUrl}/settings`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ lmStudioModel: selected })
          }).then(async (saveResponse) => {
            if (saveResponse.ok) {
              const saved = (await saveResponse.json()) as PublicSettings;
              setPublicSettings(saved);
            }
          });
        }

        return { ...current, lmStudioModel: selected };
      });
    } catch (caught) {
      setLoadedModels([]);
      setModelMessage(
        caught instanceof Error
          ? caught.message
          : "Could not detect loaded LM Studio models."
      );
    } finally {
      setLoadingModels(false);
    }
  }

  async function testLmStudio() {
    setLmStatus("testing");
    setLmMessage("Testing your LM Studio connection...");
    setError("");

    try {
      const response = await fetch(`${workerUrl}/lm-studio/test`, {
        method: "POST"
      });
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
      const response = await fetch(`${workerUrl}/discovery/plan`, {
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
      const response = await fetch(`${workerUrl}/discovery/search`, {
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

      if (mode === "submit") {
        await loadHistory();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Automation job failed.");
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
        setBatchMessage(
          `Processing ${index + 1} / ${queued.length}: ${item.domain}`
        );

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
      setError(
        caught instanceof Error ? caught.message : "Queue automation failed."
      );
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
            hand safe submissions to a real browser on your Mac.
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
          <span>Local service</span>
          <strong>
            {workerState === "online"
              ? "Online"
              : workerState === "checking"
                ? "…"
                : "Offline"}
          </strong>
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

      {!settingsReady ? (
        <div className="setupBanner">
          <strong>Finish LinkTide setup</strong>
          <span>
            Add your LM Studio tunnel and Brave Search API key in Settings.
            Loaded models will appear automatically in the model dropdown.
          </span>
        </div>
      ) : null}

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
            <label className="wide">
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
              Logo file path
              <input value={profile.logoPath} onChange={(e) => update("logoPath", e.target.value)} placeholder="/Users/you/logo.png" />
            </label>
          </div>

          <div className="formActions">
            <button className="secondary" type="submit">Save Profile</button>
            <span className="muted tiny">
              Business data and credentials stay on this Mac.
            </span>
          </div>
        </form>

        <aside className="sideStack">
          <form className="panel compact" onSubmit={saveAppSettings}>
            <p className="eyebrow">SETTINGS</p>
            <h2>Connections</h2>

            <div className="settingsFields">
              <label>
                LM Studio tunnel
                <input
                  value={settings.lmStudioBaseUrl}
                  onChange={(e) => updateSetting("lmStudioBaseUrl", e.target.value)}
                  placeholder="https://your-tunnel.example.com/v1"
                />
              </label>
              <label>
                LM Studio model
                {loadedModels.length ? (
                  <select
                    value={settings.lmStudioModel}
                    onChange={(e) => updateSetting("lmStudioModel", e.target.value)}
                  >
                    {loadedModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                        {model.loadedInstances > 1
                          ? ` (${model.loadedInstances} instances)`
                          : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={settings.lmStudioModel}
                    onChange={(e) => updateSetting("lmStudioModel", e.target.value)}
                    placeholder="No loaded model detected yet"
                  />
                )}
                <span className="modelHelper">
                  <small>{loadingModels ? "Checking LM Studio..." : modelMessage}</small>
                  <button
                    className="modelRefresh"
                    type="button"
                    onClick={() => refreshLmStudioModels()}
                    disabled={loadingModels || !settings.lmStudioBaseUrl.trim()}
                  >
                    {loadingModels ? "Checking..." : "Refresh Models"}
                  </button>
                </span>
              </label>
              <label>
                LM Studio API key
                <input
                  type="password"
                  value={settings.lmStudioApiKey}
                  onChange={(e) => updateSetting("lmStudioApiKey", e.target.value)}
                  placeholder={publicSettings?.hasLmStudioApiKey ? "Saved" : "Optional"}
                />
              </label>
              <label>
                Brave Search API key
                <input
                  type="password"
                  value={settings.braveSearchApiKey}
                  onChange={(e) => updateSetting("braveSearchApiKey", e.target.value)}
                  placeholder={publicSettings?.hasBraveSearchApiKey ? "Saved" : "Required for live search"}
                />
              </label>
            </div>

            <button className="primary full" type="submit" disabled={savingSettings}>
              {savingSettings ? "Saving..." : "Save Settings"}
            </button>
            <p className="tiny muted settingsMessage">{settingsMessage}</p>
          </form>

          <section className="panel compact">
            <p className="eyebrow">LOCAL SERVICE</p>
            <h2>Automation engine</h2>
            <p className="muted">
              Chromium sessions, encrypted directory accounts, learned recipes,
              and submission automation all run locally.
            </p>
            <div className={workerState === "online" ? "status good" : workerState === "offline" ? "status bad" : "status"}>
              {workerMessage}
            </div>
          </section>

          <section className="panel compact">
            <p className="eyebrow">LOCAL AI</p>
            <h2>LM Studio</h2>
            <p className="muted">
              LinkTide uses your LM Studio endpoint for niche expansion and
              unfamiliar form mapping.
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
              CAPTCHA, verification, required agreements, payment, or
              low-confidence mappings pause automation and leave the browser open.
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
                  LinkTide runs a limited batch, dedupes domains, then qualifies candidates.
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
                            <span>Form mapping: <b>{percent(automation.mappingQuality?.averageConfidence)}</b></span>
                            <span>Fields mapped: <b>{automation.mappingQuality?.mappedCount ?? 0}</b></span>
                            <span>Required unmapped: <b>{automation.mappingQuality?.requiredUnmapped?.length ?? 0}</b></span>
                            <span>AI mapper: <b>{automation.aiUsed ? "yes" : "fallback"}</b></span>
                            <span>Recipe: <b>{automation.recipeUsed ? "reused" : automation.recipeSaved ? "learned" : "new"}</b></span>
                            {automation.account ? (
                              <span>
                                Account: <b>
                                  {automation.account.verificationPending
                                    ? "verify email"
                                    : automation.account.accountCreated
                                      ? "created"
                                      : automation.account.existingCredential
                                        ? "stored login"
                                        : automation.account.status ?? "n/a"}
                                </b>
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
                            <p className="automationWarning">
                              {automation.reasons.join(" ")}
                            </p>
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

      <section className="panel">
        <div className="sectionHeading">
          <div>
            <p className="eyebrow">HISTORY & VERIFICATION</p>
            <h2>Submitted listings and live backlinks</h2>
          </div>
          <button
            className="secondary smallButton"
            type="button"
            onClick={loadHistory}
          >
            Refresh History
          </button>
        </div>

        {!history.length ? (
          <div className="emptyState">
            <strong>No submission history yet.</strong>
            <p>Successful and blocked submission attempts will appear here automatically.</p>
          </div>
        ) : (
          <>
            <div className="historyStats">
              <div>
                <span>Total</span>
                <strong>{history.length}</strong>
              </div>
              <div>
                <span>Live</span>
                <strong>{history.filter((item) => item.status === "live").length}</strong>
              </div>
              <div>
                <span>Pending</span>
                <strong>
                  {history.filter((item) =>
                    ["pending", "verification_required"].includes(item.status)
                  ).length}
                </strong>
              </div>
              <div>
                <span>Needs attention</span>
                <strong>
                  {history.filter((item) =>
                    ["needs_attention", "failed", "rejected"].includes(item.status)
                  ).length}
                </strong>
              </div>
            </div>

            <div className="historyList">
              {history.map((record) => {
                const rel = record.backlinkRel;
                const linkType = record.backlinkFound
                  ? rel?.sponsored
                    ? "sponsored"
                    : rel?.ugc
                      ? "ugc"
                      : rel?.nofollow
                        ? "nofollow"
                        : "follow"
                  : "not verified";

                return (
                  <article className="historyItem" key={record.id}>
                    <div className="historyMain">
                      <div className="historyTitleRow">
                        <strong>{record.domain}</strong>
                        <span className={`historyStatus ${record.status}`}>
                          {record.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <p className="tiny muted">
                        {record.businessName} · submitted {formatDate(record.submittedAt ?? record.createdAt)}
                      </p>

                      {record.verificationNote ? (
                        <p className="historyNote">{record.verificationNote}</p>
                      ) : null}

                      {record.reasons.length ? (
                        <p className="tiny automationWarning">
                          {record.reasons.join(" ")}
                        </p>
                      ) : null}

                      <div className="historyLinks">
                        <a href={record.opportunityUrl} target="_blank" rel="noreferrer">
                          Opportunity
                        </a>
                        {record.listingUrl ? (
                          <a href={record.listingUrl} target="_blank" rel="noreferrer">
                            Listing
                          </a>
                        ) : null}
                        {record.backlinkUrl ? (
                          <a href={record.backlinkUrl} target="_blank" rel="noreferrer">
                            Backlink
                          </a>
                        ) : null}
                      </div>
                    </div>

                    <div className="historyMeta">
                      <span className={`linkType ${record.backlinkFound ? "found" : ""}`}>
                        {linkType}
                      </span>
                      <span className="tiny muted">
                        Last checked: {formatDate(record.lastVerifiedAt)}
                      </span>
                      {record.httpStatus ? (
                        <span className="tiny muted">HTTP {record.httpStatus}</span>
                      ) : null}
                      <button
                        className="secondary smallButton"
                        type="button"
                        disabled={verifyingHistoryId !== null}
                        onClick={() => verifyHistoryRecord(record.id)}
                      >
                        {verifyingHistoryId === record.id
                          ? "Verifying..."
                          : "Verify Backlink"}
                      </button>
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
