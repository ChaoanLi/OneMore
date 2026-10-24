# OneMore Bilingual Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the independent client and core/server tasks; the controller implements integration/docs. Follow superpowers:dispatching-parallel-agents only within the disjoint file ownership below.

**Goal:** Ship an attractive bilingual application and two portfolio-quality READMEs under a noncommercial license, prepared for an explicit public release decision.

**Architecture:** Locale is explicit in every server context and part of immutable client request generations. Use source-text translation keys with indexed parameters, structured new notification messages, account locale preference and device fallback. Preserve all group/UTC rules; polish the existing visual language rather than adding a new app.

**Tech Stack:** Existing TypeScript/React/Taro, Hono, SQLite, Zod, Vitest, SVG assets. No external runtime translation service or font dependency.

**Spec:** `docs/superpowers/specs/2026-10-23-bilingual-showcase-design.md` (user approved).

## Global Constraints

- Supported locales: Simplified Chinese (`zh-CN`) and English (`en`).
- Language, time zone and active space are independent.
- Never translate user-authored content, remove isolation checks or create shared mutable server locale.
- New notifications can render for the viewer; emails use recipient preference. Old unstructured text remains historical content.
- English default README, full Chinese companion, synthetic actual screenshots, honest unverified-service status.
- PolyForm Noncommercial 1.0.0 reproduced unmodified; third-party ISC/MIT notices retained.
- Repository stays private until a final explicit public-release decision.

## Review Focus

- Language changes during requests must discard stale responses without losing or reinterpreting unsaved input.
- Signed-out selection and restored-account preference must resolve predictably without touching space/time zone.
- English times, errors, sharing and validation must not fall back to Chinese system text; user text remains verbatim.
- Mixed-language concurrent requests and delayed email must use the correct viewer/recipient, preserving revocation checks.
- Published assets/history must contain no private identities, invitation tokens, credentials or invented production claims.

### Task 1: Client locale/session integration (controller)

**Files:** `apps/client/src/lib/i18n.ts`, `requestContext.ts`, `api.ts`, `session.ts`; tests `apps/server/test/client-api.test.ts`, `client-context.test.ts`, new locale preference test.

**Interfaces:**
- Client `i18n.ts` exports `type Locale='zh-CN'|'en'`, `getLocale():Locale`, `useLocale():Locale`, `setLocale(locale:Locale):Promise<void>`, `applyLocale(locale:Locale):void`, `setLocalePersistence(handler:(locale:Locale)=>Promise<void>):void`, `t(key:string,...args:unknown[]):string`, `useLocaleDidShow(callback:()=>void):void`, `localizeBuiltinGame<T extends {name:string;gameKey?:string|null;key?:string}>(game:T):T`.
- `t` reads `clientEnglish` exported by `apps/client/src/lib/locales/en.ts` (client task ownership), with core system translations available through explicit helpers. Keys are Chinese source templates with `{0}` parameters, never user data.
- RequestContext adds `locale` to capture and `setLocale` to generation invalidation. API sends `Accept-Language` on every request. Session sends locale for signup and persists explicit preference with `PATCH /api/me`; apply stored account preference at boot/restore without changing space/time zone.
- [ ] Add failing tests: locale change invalidates in-flight successful response; custom names preserved; normalized device language/fallback/persistence.
- [ ] Run targeted tests (expect RED), implement locale integration, run same tests (GREEN).
- [ ] Keep form components mounted on language change; page loaders re-run through `useLocaleDidShow` only after locale changes, alongside ordinary Taro lifecycle.

### Task 2: Core/server localization (independent implementer)

**Ownership:** all `packages/core/src` and new core tests; `apps/server/src` and new `apps/server/test/i18n.test.ts`. Do not modify client files, existing server test fixtures, docs or root package/lock files. Preserve legacy Chinese tests through default `zh-CN`.

**Interfaces:**
- Export `Locale`, `normalizeLocale(value?:string):Locale`, `Message {key:string;args:MessageValue[]}`, `message(key,...args):Message`, `renderMessage(locale, message):string`, `translate(locale,key,...args):string`, and `formatMessage(template,args):string` from core. Source templates use indexed `{0}` placeholders.
- User adds optional `locale`; signup/update schemas accept `zh-CN|en`. Ctx adds optional `locale`. Hono middleware derives display locale from `Accept-Language` with default Chinese, independent of account recipient preference.
- Existing time/status/quorum/draft helper signatures retain backward compatibility, adding locale as the final optional parameter. `zoneLabel(tz,locale?)`; `formatSlot(slot,tz,now?,locale?)`; `slotOneLine(slot,tz,now?,locale?)`; `slotInOtherZone(slot,viewerTz,otherTz,locale?)`; `statusText(status,locale?)`.
- Notifications accept structured `Message|string` title/body and store optional translation metadata; list renders metadata in current Ctx.locale. Old text remains intact. Emails and calendar feeds use recipient account locale, independent of current requester.
- [ ] Add failing tests for English/Chinese status, dates/DST/day offsets, errors/validation, concurrent locales, recipient email language, notification re-rendering and English demo parsing.
- [ ] Implement explicit dictionaries and structured messages; no arbitrary recursive translation of response/user strings. Preserve all membership checks, queue metadata/generation and old data compatibility.
- [ ] Verify core/server tests and server types; report commands, counts and exact helper signatures for integration. Do not commit or spawn reviewers.

### Task 3: Bilingual client and visual polish (independent implementer)

**Ownership:** `apps/client/src/components/**`, `pages/**`, `app.scss`, `lib/ui.ts`, `lib/brand.ts`, new `lib/locales/en.ts` and locale page helpers. Do not modify root-owned `lib/i18n.ts`, api/session/requestContext, app.ts, config infrastructure or any core/server implementation.

**Interfaces:** Consume Task 1 client i18n contract; core helper locale overloads as listed in Task 2. Use `t` for all explicit system text and `useLocale` in components needing re-render; use `useLocaleDidShow` where server-derived labels reload. Do not translate arbitrary user content or reset forms to switch language.
- [ ] Add pure dictionary/template coverage tests in a new `apps/server/test/client-translations.test.ts` where practical; watch failures before implementing.
- [ ] Localize system labels/dialogs/errors/navigation/page titles, forms, social/space/email/calendar/AI journeys, dynamically formatted messages and all share text. Ensure no module-level translated arrays freeze the first locale.
- [ ] Add clear language control available without login/membership; preserve Page permission gates. Improve home/event/space hierarchy with original hand/red identity, stronger spacing and readable English wrapping, inheriting shared components for secondary pages.
- [ ] Use “Less planning. More playing.” / “把「下次一定」变成这次。” appropriately. No artificial functionality or user metrics.
- [ ] Verify client typecheck when shared core changes are available; report untranslated known gaps, dictionary coverage evidence and files changed. No commits or extra reviewers.

### Task 4: Showcase, licensing and repo preparation (controller)

**Files:** `README.md`, `README.zh-CN.md`, `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, `docs/ARCHITECTURE.md`, `docs/assets/**`, contribution/security guidance and verification record. Keep operational notes excluded.

- [ ] Obtain official unmodified PolyForm license, required notice for Chaoan Li, Lucide ISC/Feather MIT notices; check exact source text and dependency licenses.
- [ ] Write equivalent EN/ZH READMEs focused on problem→workflow→screenshots→technical decisions→runnable instructions→license/status, with language links and truthful optional AI/hosting state.
- [ ] Create original SVG banner and actual bilingual screenshots using synthetic fixture data; no join tokens, private profiles or fabricated metrics. Inspect rendered assets and all README links.
- [ ] Review both task diffs for spec and quality, integrate any significant corrections with tests. Add build/test automation if it has no private-run cost (public repo jobs only).
- [ ] Run full tests, all typechecks, H5 build and bilingual browser journeys; inspect narrow English layout, UTC/daylight-saving consistency, language/space independence and preserved input.
- [ ] Fresh whole-branch code review, regression fixes, final history/asset credential scan. Push reviewable result to existing PRIVATE repository; verify remote commit and rendered READMEs.
- [ ] Present finished app/readmes/license/screenshots for explicit public-release decision, then apply visibility change only if authorized at that point.

## Execution record

User chose “按设计直接实施”. No further implementation approval is needed. Work on a dedicated local feature branch in the shared checkout; disjoint file ownership enables the core/server and client tasks to proceed after interface definitions are fixed. Controller owns integration, documentation and final browser/repository actions. Detailed progress lives in ignored `.superpowers/sdd/2026-10-23-bilingual-showcase/progress.md` until final verification.
