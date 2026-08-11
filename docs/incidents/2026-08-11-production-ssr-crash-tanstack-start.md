# Incident: production down after PR #7 merge — `createCsrfMiddleware is not a function`

**Date:** 2026-08-11
**Status:** Production restored via rollback. Root cause NOT fixed — `main` still
carries the broken commits and will fail the same way on its next deploy.
This doc is the handoff for whoever picks up the real fix.

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
