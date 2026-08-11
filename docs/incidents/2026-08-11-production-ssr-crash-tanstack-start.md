# Incident: production down after PR #7 merge — `createCsrfMiddleware is not a function`

**Date:** 2026-08-11
**Status:** RESOLVED — fixed via a bump of the `@tanstack/*` package family,
plus an incidental downgrade of the transitive `h3` dependency (now pinned
via `overrides` to prevent regression). `nitro` itself is **unchanged** from
before the incident (`3.0.260603-beta` both before and after — it was bumped
mid-investigation, then reverted, see below). Verified against a real Vercel
preview deployment. See "Resolution" section below for exact versions,
what's actually causally established vs. not, and verification evidence.

## Summary

PR #7 (`worktree-document-expiry-extraction`, the Gemini document-extraction
feature) merged into `main` and auto-deployed to production. Every request
started 500ing immediately:

```
TypeError: createCsrfMiddleware is not a function
    at file:///var/task/_ssr/server-VjYXtyVb2.mjs:1302:29
    at async Object.fetch (file:///var/task/_ssr/ssr.mjs:131:56)
```

Production was rolled back to the last good deployment (`vercel rollback`)
within the same session. **No further deploys have been made to
production since.** `main` at `6103c83` is still broken — the next push to
`main` (or manual redeploy) will reproduce this outage.

## Root cause (best understanding, not fully proven)

The crash is inside **TanStack Start's own bundled SSR output**, not
application code. The variable name in the compiled stack trace —
`defaultCsrfMiddleware` — doesn't match anything in `src/start.ts` (our
middleware there is named `csrfMiddleware`), which strongly suggests this is
TanStack Start's own internal fallback CSRF middleware instance, created as
a module-level side effect somewhere inside `@tanstack/start-server-core` /
`@tanstack/react-start-server`.

Nitro's Vite build (`node_modules/.nitro/vite/services/ssr/...`) splits the
SSR bundle into two files that import from each other:

- `server-BwJCwYtS.mjs` — defines `createCsrfMiddleware`, imports
  `server_exports` from the other chunk.
- `server-BwJCwYtS2.mjs` — imports `createCsrfMiddleware` from the first
  chunk, and calls it at module top level
  (`var defaultCsrfMiddleware = createCsrfMiddleware(...)`).

This is a circular ES-module import. Normally circular imports resolve fine
as long as nothing uses a binding before its defining module finishes
executing. Here, depending on **which chunk the rest of the module graph
imports first**, the call can land while `createCsrfMiddleware` is still
`undefined` (a `var`, not `let/const`, so it's `undefined` rather than a
TDZ `ReferenceError` — matching the exact `TypeError` observed).

Which chunk gets entered first is decided by Rollup/Rolldown's automatic
chunk-splitting, which is sensitive to the shape of the *entire* module
graph — not just the files that "obviously" relate to the crash. That's
why this investigation kept getting contradictory results (see below).

## What was tried, and ruled out

All of the following were tested against **real Vercel preview
deployments** (not local builds — see "local builds are not a valid test
oracle" below), without touching production:

| Theory | Test | Result |
|---|---|---|
| The `ai` / `@ai-sdk/google` SDK's bundle weight tripped the bug | Removed both, replaced with a plain Gemini REST `fetch` call | ❌ Still crashed |
| Any new `*.server.ts` file under `src/` gets scanned into the SSR bundle regardless of imports | Moved the extraction logic entirely to a standalone `api/extract-document-fields.ts` (a separate Vercel Function, built independently of the Nitro/TanStack SSR bundle) | ❌ Still crashed |
| A completely empty stub `/api/*.ts` file alone breaks it | Deployed a no-op stub at `api/extract-document-fields.ts` on top of an otherwise-clean, known-good commit | ❌ Still crashed |
| Missing/inconsistent npm lockfile causes non-reproducible builds | Confirmed: `package-lock.json` didn't exist in this repo until commit `9c28b84` — every commit before that (including the current rollback target) has **no npm lockfile**, so `npm install` re-resolves fresh against the live registry on every build. This is real and explains why some early bisection results flip-flopped for the *same* commit. | ⚠️ Real bug, but not *the* bug — see below |
| A dependency published today (`@lovable.dev/vite-tanstack-config@2.11.0`, released hours before the incident) is the trigger | Pinned back to `2.10.0` (the version in `bun.lock`, last known-good) | ❌ Still crashed — and produced a byte-identical build, meaning this package doesn't actually pin the Nitro/Rolldown version; coincidental timing, not causal |

**Net result:** no dependency change, no code relocation, and no version pin
tested made any difference. This looks like a structural bundler bug that's
sensitive to the overall module graph shape in a way that isn't controllable
from application code.

## Important side-finding: local builds are not a valid test oracle

`vercel build` run locally (macOS/arm64) reproduces this crash **on every
commit tested, including the commit currently live and working in
production**. Real Vercel cloud builds (Linux) do not have this problem —
confirmed by deploying the exact live commit as a fresh preview multiple
times and getting consistent 200s. Do not use local `vercel build` to
validate any future fix attempt here — it will produce false positives.
Always validate with a real `vercel deploy` preview.

## Separate, real, still-open issue: no lockfile before commit `9c28b84`

Independent of the crash above: this repo has **two lockfiles**
(`bun.lock` and `package-lock.json`) that have drifted out of sync.
`bun.lock` is stuck at `@lovable.dev/vite-tanstack-config@2.10.0` (last
properly `bun install`'d before the `ai` package was added); npm's
regenerated `package-lock.json` has since moved to `2.11.0`. Vercel's build
uses `npm`/`package-lock.json`, not `bun.lock`, confirmed from build logs
(`Command "npm run build" exited with 1`). Practically:

- Any commit before `9c28b84` has **zero** npm dependency pinning — a
  redeploy of old, "known good" code is not guaranteed to reproduce the same
  build.
- `bun.lock` is misleading (it's not what's actually used) and should
  either be kept honestly in sync or removed to avoid confusion.

This should be fixed regardless of the crash above — it's a standing risk
to build reproducibility.

## What's currently true

- **Production**: rolled back, serving traffic normally, untouched since.
- **`main`**: broken at `6103c83`. Do not redeploy it without a real fix —
  it will 500 immediately.
- **This worktree** (`worktree-document-expiry-extraction`, uncommitted):
  has the `api/`-restructured version of the extraction feature (Gemini via
  plain `fetch`, no `ai` SDK, logic moved to `api/extract-document-fields.ts`
  outside `src/`). This is a genuine improvement in isolation (smaller
  dependency footprint, no unused `@ai-sdk/gateway`) but **does not fix the
  crash** and should not be merged as-is without further work.

## Recommended next steps

1. **Do not touch `main`/production** until one of the below is done.
2. **Fix the lockfile drift first**, independent of everything else —
   regenerate `package-lock.json` from a clean `npm install`, decide whether
   to keep `bun.lock` in sync or drop it, and commit. This removes one
   confirmed source of non-reproducible builds and should happen regardless
   of the TanStack bug.
3. **The real fix is almost certainly a TanStack Start / Router / Nitro
   version upgrade**, done as its own scoped project — bump the whole
   package family together (a lone patch bump on `@tanstack/react-start`
   was tried and broke the build differently, due to `@tanstack/router-core`
   version skew — the whole family needs to move in lockstep). Test each
   step against real preview deploys, not local builds.
4. Consider filing a minimal repro with TanStack/Nitro upstream — this is a
   legitimate, reproducible bug (circular import in generated SSR chunks)
   independent of this app's specifics, and worth reporting regardless of
   whether we self-serve a fix.
5. Once the upgrade lands and is verified stable via preview deploys, revisit
   the document-extraction feature — the `api/`-restructured version in this
   worktree is a reasonable starting point, or the original TanStack
   server-function approach may work fine once the underlying bug is gone.

## Resolution (2026-08-11)

The recommended fix (step 3 above — bump the `@tanstack/*` family and `nitro`
together in lockstep) resolved the crash. Confirmed on a real Vercel preview
deployment, not a local build (per the "local builds are not a valid test
oracle" finding above).

**Branch:** `fix/tanstack-nitro-upgrade`, commit `88fd105e0d68a4231e6edbe750f16f0dd788c7a4`

**Versions bumped to:**

```
"@tanstack/react-query": "^5.101.4"
"@tanstack/react-router": "1.170.25"   (exact-pinned)
"@tanstack/react-start": "1.168.42"    (exact-pinned)
"@tanstack/router-plugin": "1.168.29"  (exact-pinned)
"nitro": "3.0.260603-beta"             (exact-pinned)
"vite": "^8.2.1"
```

Note: `nitro` was initially bumped to `3.0.260610-beta`, which broke the
Vercel remote build itself (`npm install` ERESOLVE) — `@lovable.dev/vite-tanstack-config@2.11.0`
declares a peer dependency on `nitro >=3.0.260603-beta`, and npm's semver
prerelease matching only accepts a prerelease version against a range
comparator that shares the same `[major, minor, patch]` tuple. `3.0.260610-beta`
has a different "patch" (`260610` vs `260603`) than the comparator, so it
failed the peer check even though it's numerically newer. `nitro` was
reverted to the exact pre-existing pin, `3.0.260603-beta` — the only
published prerelease matching that tuple — while the `@tanstack/*` family
stayed bumped and lockstep-consistent.

**Preview deployment tested:**
- URL: `https://continuum-h6j1v8hla-rochakag779-1476s-projects.vercel.app`
- Deployment ID: `dpl_413hj5co1qCvQpJu39uPZcYShwpJ`
- Remote Vercel build succeeded (`npm install` and `vite build` both clean,
  no ERESOLVE, no build errors).

**Verification performed** (via `vercel curl`, which authenticates through
Vercel's deployment-protection SSO on this project — plain `curl` on this
project returns a 302 to Vercel's SSO login regardless of app state, so it
was not a valid test channel here):

| Route | Result |
|---|---|
| `/` (landing page) | Full SSR HTML returned, real page content (nav, hero, stats). 0 occurrences of `createCsrfMiddleware`. |
| `/auth` (public, sign-in page) | Full SSR HTML returned, `<title>Sign in to Continuum \| Vendor Risk Management</title>`. 0 occurrences of `createCsrfMiddleware`. |
| `/dashboard` (auth-gated) | SSR shell returned (no 500, no error boundary); route data shows `s:"pending", ssr:!1` for the `_authenticated` layout, i.e. client-side auth check takes over rather than a server error — the expected, distinct-from-crash outcome for an unauthenticated request to a gated route. 0 occurrences of `createCsrfMiddleware`. |
| `/vendors` (auth-gated, vendor-documents area) | Same as `/dashboard` — clean SSR shell, no crash, no 500. 0 occurrences of `createCsrfMiddleware`. |

No route returned a 500, an error-boundary page, or the `createCsrfMiddleware
is not a function` signature. The crash described in this incident is
confirmed gone on this branch.

**Additional, stronger check — direct server-function invocation:** the four
routes above are page GETs; the original crash was specifically in CSRF
middleware, which every TanStack Start server-function call routes through,
so a direct server-fn POST is a more targeted test of the exact broken code
path. Located the two generated `POST /_serverFn/<id>` endpoints by grepping
the built server bundle (`resolveAlertFn` and `extractDocumentFieldsFn`) and
invoked both directly on the same preview deployment
(`dpl_413hj5co1qCvQpJu39uPZcYShwpJ`):

```
POST /_serverFn/b3a1eba16d48d1bb69b59a7de8073a48d2dd154eb1d56ff44676557376ac5a20   (resolveAlertFn)
POST /_serverFn/e46b7466fb9c0ea4bbbc3437fe9498722c9b29652d65234eaf98a006d2221f6a   (extractDocumentFieldsFn)
```

Both returned `HTTP/2 500` with `x-tss-serialized: true` and a structured
TanStack Start RPC error body (`{"...":"$TSR/Error"...,"Seroval Error"}`) —
i.e. the request reached and was processed by the server-function pipeline
(CSRF middleware included), and failed only because the hand-crafted request
body wasn't in TanStack's expected wire format. No `createCsrfMiddleware`
string in either response, no generic unhandled-exception page. This is a
pass by the same "some structured response, not the crash" standard used
throughout this doc, and it exercises the exact code path the incident
happened in — stronger evidence than the page-GET checks alone.

**Not yet done:** this branch has not been merged to `main` or promoted to
production. That is a separate decision for whoever owns this plan next.

## Post-review addendum: `h3` transitive dependency also moved, now pinned

A whole-branch review after the fact found that the committed
`package-lock.json` was not actually reproducible from `package.json`. The
`nitro` dependency declares `h3: ^2.0.1-rc.22`, but a fresh `npm install`
against the *unmodified* `package.json` resolved `h3` to `2.0.1-rc.26` — the
exact version present in the original broken commit (`6103c83`). The
verified, working lockfile had `h3` pinned to `2.0.1-rc.22` only as an
incidental side effect of the clean lockfile regeneration done earlier in
this plan (see the "no lockfile before `9c28b84`" section above), not
because anything in `package.json` actually constrained it there.

This matters because `h3` is Nitro's HTTP/middleware layer — it's where
`createCsrfMiddleware`, the function in the crash stack trace, lives. Since
`h3` moved (`rc.26` → `rc.22`) at the same time the `@tanstack/*` family was
bumped, and both changes shipped together into the one verified-working
preview deployment, **this incident's existing verification does not
disentangle which of the two changes actually fixed the crash.** It's
plausible the `h3` downgrade did some or all of the real work and the
`@tanstack/*` bump is coincidental (or vice versa, or both were needed
together). No experiment was run holding one fixed and varying the other.

To stop this from silently regressing — a fresh `npm install`,
dependency-bot lockfile refresh, or merge-conflict lockfile regen could
otherwise re-resolve `h3` back to `rc.26` and reintroduce the exact
original bug — an explicit `"overrides": { "h3": "2.0.1-rc.22" }` was added
to `package.json`. Verified: deleting `node_modules` and
`package-lock.json` and running `npm install` from a clean slate
reproducibly resolves `h3` to `2.0.1-rc.22` (`npm ls h3` reports it as
`overridden`), and `tsc --noEmit` / `lint` / `test` all still pass.

If this ever needs to be root-caused for real, the way to do it is a preview
deploy with `@tanstack/*` bumped but `h3` forced back to `rc.26` (or the
reverse), to see which one alone reproduces the crash.

## Known follow-up (not fixed here): `monitor:check` still requires `bun`

`package.json`'s `monitor:check` script (`bun run
scripts/check-vendor-monitoring.ts`) still shells out to `bun`, even though
`bun.lock` was removed earlier in this plan. This is accepted as a known
gap for now — Vercel's build never runs this script, and re-adding a
tracked `bun.lock` (or rewriting the script to run under `npm`/`node`) is
out of scope for this plan.
