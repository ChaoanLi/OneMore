# Independent Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate groups within one account, then upload verified source to a private GitHub repository.

**Architecture:** Global accounts and immutable per-request space stores share one SQLite database. New space tables preserve inaccessible legacy data. Authorization precedes every space operation, with explicit member lifecycle cleanup and scoped background work.

**Tech Stack:** Existing Node 24, Hono, SQLite, React/Taro, TypeScript, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-23-independent-spaces-design.md` (approved by user).

## Global Constraints

- One account switches spaces; no implicit shared default space or anonymous activity preview.
- Membership requires owner approval. Only owner manages members and join links.
- User identity and verified email global; business data, notifications, email preferences and feeds scoped.
- Preserve and back up legacy data; never upload databases, credentials or local cloud records.
- Exit cancels active hosting and withdraws future participation; rejoin never restores old operational relationships.
- GitHub private `ChaoanLi/OneMore` only after verification. Deployment remains separate.

## Review Focus

- Concurrent async requests and stale client responses must retain immutable space context.
- Every raw object reference, including roster, circles and interest conversion, requires matching scope.
- Membership revocation must apply to delayed mail and bearer calendar links.
- Restarting on a populated legacy database must neither expose nor send legacy data.
- Owner departure and repeated approval/leave/rejoin must preserve invariants without restoring stale access.

### Task 1: Scoped persistence and membership lifecycle

**Files:** Modify `apps/server/src/store.ts`, core types; create `apps/server/src/services/spaces.ts`, `apps/server/src/space-schema.ts`, `apps/server/test/spaces.test.ts`.

**Interfaces:** `Store.forSpace(spaceId: string): Store`, readonly `Store.spaceId`; `getSpace`, `listSpaces(userId)`, `getMembership(spaceId,userId)`; space service create/list/invite/request/approve/reject/remove. Root identity store cannot read business data without scope.

- [x] Write failing API tests: one guest creates A/B; a second member joins only through approved request; missing/forged scope denied; outsider activity preview denied; independent identical friendship pairs.
- [x] Run `npm run test -w @couju/server -- --reporter=dot`; observe new failures before implementation.
- [x] Add versioned space tables and immutable scoped persistence. Preserve legacy tables; back up persistent database before first schema upgrade.
- [x] Implement owner/member management, revocable hashed invite tokens, membership transactions and safe exit/rejoin cleanup.
- [x] Verify tests for independent queries, concurrent contexts, invalid owner removal, repeated approval and rejoin. Commit scoped storage.

### Task 2: API, object authorization, mail and calendar boundaries

**Files:** Modify `app.ts`, services social/events/interests/users/notify/email/mailer/calendar/context, `index.ts`, seed and existing API tests.

**Interfaces:** Authenticated space requests use `X-Space-Id`; `GET /api/me` returns account and spaces; `/api/spaces` and `/api/space-invites/:token` manage membership. Business routes consume a per-request Ctx. Calendar token resolves user+space. Outbox items carry spaceId/recipientId/object reference.

- [x] Add failing tests for cross-space event/circle/interest reads and writes, injected invitees/rosters, notification counts, ICS revocation and delayed mail cancellation.
- [x] Run targeted tests; implement route middleware requiring active membership and scoped service context, independent global account routes, strict object references and space links.
- [x] Scope calendar tokens and recheck permissions before dispatching queued email. Suppress unknown recipients and legacy unscoped non-verification mail.
- [x] Iterate spaces in background sweep; update seed to explicit demo space. Adapt existing API fixtures to approved memberships, replacing obsolete anonymous-preview and outsider email expectations.
- [x] Verify full server suite and typecheck; commit server boundary.

### Task 3: Space UI and client state

**Files:** Modify client API/session/Page/app config/draft store and share links; create space list/join/manage page and scoped request guard tests in server test runner.

**Interfaces:** API captures space and session generation when starting requests; stale completion throws `stale_context`. Session exposes spaces, activeSpace, selectSpace and refreshSpaces. Page mounts business children only within authorized active membership and resets children on switch.

- [x] Write failing pure client context tests for delayed A response after selecting B and logout/account switch; test scope-bound draft reset.
- [x] Implement selection persistence bound to user identity, space header, stale result guard, initial no-space view, and reset of drafts/children/unread on switch.
- [x] Add create/join/approval/member management UI using established components. All event/friend/share links bind space; deep links authorize before switching.
- [x] Verify client types and H5 production build, then browser flows and small-screen layout; commit client.

### Task 4: Legacy import, documentation, final review and GitHub

**Files:** Create local-only preview/import CLI and tests; modify README/deploy docs/ignore rules and package script.

**Interfaces:** CLI requires explicit target space and complete member allowlist; preview default, `--apply` transaction with migration receipt and pre-import backup. Reject/skip objects containing non-allowlisted references. Never import historical outbox, notifications or feeds.

- [x] Write failing import tests: partial participant sets skipped, dry-run no mutation, repeated apply idempotent and old data remains unavailable.
- [x] Implement CLI, migration guide and current deployment status documentation without local resource IDs.
- [x] Run `npm test`, `npm run typecheck`, `npm run build`; inspect final diff and fresh independent code review; fix important findings with regression tests.
- [ ] Check staged file list and secret patterns. Create private OneMore repo, push source, verify remote branch/files and privacy. Preserve local database and backups outside git.

## Execution record

User approved the design and implementation. Execute inline in the existing new-project directory; there is no pre-existing repository or shared main branch to protect. Initialize a local source baseline and feature branch, avoiding an unnecessary duplicate checkout. Dependencies are already installed. Read-only fresh review is required at completion. Source commits follow each verified task; no GitHub upload until final checks pass.
