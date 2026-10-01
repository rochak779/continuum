# Continuum

**Continuous vendor monitoring: know when a supplier's company status, directors or filings change, before it becomes a problem.**

Live demo: TBC

<!-- TODO(Rochak): add a screenshot at docs/readme/screenshot.png once the app is redeployed, then uncomment the line below. -->
<!-- ![Continuum dashboard](docs/readme/screenshot.png) -->

## The problem

Most companies check a supplier properly once, at onboarding, and then rarely again. After that, the supplier record in the procurement system goes stale while the real company keeps changing: it can enter liquidation, replace its directors or fall behind on its filings. Nobody notices until a payment, an audit or an incident forces someone to look.

## What it does

- **Monitors every vendor against Companies House** on a schedule, and records what was observed and when.
- **Flags material changes** in company status, name, registered address and business activity, each with the evidence behind it.
- **Sorts changes by severity.** Critical and attention-level changes become alerts, and minor changes are kept as history.
- **Gives a health view per vendor and across the portfolio,** with dedicated pages for alerts, changes and upcoming document expiries.
- **Tracks vendor documents,** reading expiry dates from uploads such as insurance certificates.
- **Answers questions about a vendor** with an AI assistant that only uses the vendor's records and documents, and names its source.
- **Emails critical alerts.**

## Key product decisions

- **Compare against the last verified state, not the last check.** A change stays flagged until a person reviews and accepts it, so it can't quietly become the new normal.
- **Only material changes raise alerts.** Minor changes are recorded but don't notify anyone, to avoid alert fatigue.
- **A failed check never looks healthy.** If monitoring is stale or failing, the vendor shows "Monitoring issue" rather than a reassuring green status.
- **Rules for detection, AI only where it helps.** Change detection is deterministic. AI reads expiry dates from documents (the user confirms them, and a failed read never blocks an upload) and answers questions only from what the tools return.
- **Work alongside existing systems.** Procurement tools like SAP or Coupa stay the source of vendor records; Continuum adds monitoring on top instead of replacing them.

## Results & evidence

<!-- TODO(Rochak): add any users, pilots or feedback here if you have them. -->
- A working end-to-end flow: add a vendor, set a baseline from Companies House, detect a change, raise an alert, verify it and update the vendor's profile.
- Not yet used by external customers.

## Scope & limits

- **UK companies only,** through Companies House.
- **Single-user accounts.** Vendors belong to one user; team and organisation accounts are not built yet.
- **Live demo is currently offline.**

## Next in roadmap

- Team and organisation accounts.
- More data sources, such as sanctions lists, insolvency notices and company registries outside the UK.

<details>
<summary><strong>Tech stack & running locally</strong></summary>

**Stack:** TanStack Start, React, TypeScript, Supabase (Postgres with Row Level Security, scheduled jobs, Vault, Storage), Companies House API, Google Gemini (document reading and the assistant).

```sh
npm i
npm run dev
```

See [DESIGN.md](./DESIGN.md) for the design system and [docs/current-architecture.md](docs/current-architecture.md) for how monitoring works.

</details>
