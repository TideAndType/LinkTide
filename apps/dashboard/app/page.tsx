const stats = [
  ["Opportunities", "0"],
  ["Ready to submit", "0"],
  ["Live listings", "0"],
  ["Needs attention", "0"]
];

const pipeline = [
  "Business profile",
  "Niche discovery",
  "AI qualification",
  "Submission queue",
  "Browser automation",
  "Verification"
];

export default function Home() {
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">LINKTIDE</p>
          <h1>Backlink Command Center</h1>
          <p className="muted">
            Discover niche-relevant directories, qualify them with your local AI,
            and automate high-confidence submissions.
          </p>
        </div>
        <button className="primary">Add Business</button>
      </header>

      <section className="stats">
        {stats.map(([label, value]) => (
          <article className="card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="panel">
        <p className="eyebrow">V1 WORKFLOW</p>
        <h2>From niche discovery to verified backlink</h2>
        <div className="pipeline">
          {pipeline.map((step, index) => (
            <div className="step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid">
        <article className="panel">
          <p className="eyebrow">LOCAL AI</p>
          <h2>LM Studio</h2>
          <p className="muted">
            Configure your tunnel in <code>.env</code>. LinkTide will use it for
            query generation, opportunity classification, and form mapping.
          </p>
          <span className="badge">Not configured</span>
        </article>

        <article className="panel">
          <p className="eyebrow">AUTOMATION</p>
          <h2>Playwright worker</h2>
          <p className="muted">
            High-confidence forms can be completed automatically. CAPTCHA,
            payment, verification, and ambiguous agreements pause for review.
          </p>
          <span className="badge">Worker idle</span>
        </article>
      </section>
    </main>
  );
}
