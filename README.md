# Continuum

Continuum is a B2B SaaS platform for continuous vendor monitoring and risk management. It watches your vendors for the changes that actually matter — company status changes, director changes, overdue accounts and confirmation statements — and surfaces them as alerts before they become bigger problems.

## What it does

- **Continuous monitoring** — tracks each vendor against Companies House data and flags material changes (status, directors, filings).
- **Dashboard** — an overview of vendor health, recent alerts, changes, and upcoming document expiries, with dedicated screens (`/alerts`, `/changes`, `/expiries`) to drill in.
- **Document tracking** — extracts and tracks expiry dates on vendor documents (e.g. insurance certificates) so nothing lapses unnoticed.
- **AI assistant** — a chat assistant with RAG over your vendor documents to answer questions about a vendor's status, risk, and paperwork.
- **Critical alert emails** — notifies you by email when a vendor's monitoring turns up a critical issue.
- **Vendor detail pages** — a full view per vendor combining Companies House data, alerts, changes, and documents.

See [DESIGN.md](./DESIGN.md) for the design system (colors, typography, spacing, components) this UI is built against.

## Development

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
