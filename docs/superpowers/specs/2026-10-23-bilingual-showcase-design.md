# OneMore bilingual product and public project showcase

Date: 2026-10-23. Status: proposed design, pending independent review and user approval.

## Intent and agreed approach

Chaoan wants OneMore to become a representative personal project: useful to real friend groups, attractive enough to share, understandable in Chinese and English, with a public repository permitting noncommercial use. The repository is currently private at `ChaoanLi/OneMore`; production hosting, SMTP and real DeepSeek credentials are still pending.

The user explicitly selected **bilingual application interfaces plus two READMEs**, rather than documentation alone.

Approaches considered:

1. **Complete bilingual product and portfolio presentation — selected.** Translate the actual product journey, improve the principal screens, and present it through an English default README and a Chinese companion, actual screenshots and a clear technical story. This touches client, shared formatting and server-generated text.
2. Documentation-first presentation. Faster, with English/Chinese READMEs and visuals, but the application remains Chinese; this does not satisfy the selected scope.
3. Separate Chinese and English sites. Rejected as unnecessary duplication of deployment, accounts and group data. One application switches language while retaining its space boundaries.

## Product story and visual direction

The product addresses a concrete problem: people express interest in playing together, but agreeing on a game, enough players and a time across time zones repeatedly breaks down in group chat.

Proposed copy (implementation decisions, not user quotations):

- English: **Less planning. More playing.**
- Chinese: **把「下次一定」变成这次。**
- Supporting explanation: choose games, propose times, share within an independent space, then confirm when player count and required roles fit.

Retain the OneMore name, the raised-hand identity, light background, dark typography and one strong red accent. Establish an original, coherent visual system rather than describing the UI as a reproduction of another site's style. Use better type hierarchy, spacing, clear states and carefully selected line icons. Avoid decorative complexity or a second marketing site.

Polish the home screen, event detail, space entry/management and shared page components so the application and README screenshots tell one story. Existing secondary workflows inherit the shared visual improvements; do not redesign every interaction or add features such as chat, payments, recommendations or public group discovery.

## Language behavior

- Supported locales: Simplified Chinese (`zh-CN`) and English (`en`). A visible `中文 / EN` control is available before login and without space membership, and remains reachable in the application shell/account settings.
- Language, time zone and active space are independent. Changing language must not change time zone, space, memberships, drafts' meaning, activity records or availability.
- A local preference is available to signed-out users; otherwise use the browser/device language (`zh*` → Chinese, other languages → English). For signed-in users an explicitly saved account preference takes priority and supplies the recipient language for future notifications and email.
- Existing accounts without a saved preference can use the local/device preference for display. Store a preference when the user explicitly chooses a language. Existing records and credentials remain compatible.
- Changing display language refreshes server-rendered labels and remounts/reloads the appropriate page using the established Taro navigation safeguards. In-flight responses from the previous language cannot overwrite the new display. Account/space isolation and existing stale-response protections remain in force.
- All system interface copy is localized: navigation, buttons, labels, empty/loading/error states, dialogs, identity and recovery, spaces/approval, games, event creation/detail and sharing, interest posts, friends/circles, notifications, calendars/ICS, email settings and AI draft flows. Browser/page titles and accessible labels follow the selected language.
- Server-produced status, progress, date/time descriptions, validation and permission errors use the requested display language. There is no shared mutable server "current language"; concurrent requests may use different languages safely.
- New system notifications store enough structured information to render their system text for the viewer's language. Outgoing emails use the recipient's account preference, not the host's or the last HTTP request's language. Existing permission rechecks at actual send time remain mandatory.
- Do not translate user-authored space names, nicknames, event titles/notes, custom games, locations or comments. Built-in game names may use localized catalog names; explicitly customized game names remain user content.
- Preserve old activity text and old free-form notification text where no translation metadata exists; do not guess or send historical private content to a translation service. Treat that as historical content, with a documented compatibility note. New system text must be fully bilingual.
- Time zones use IANA values and UTC storage. English labels include recognizable zone names, English weekdays and day offsets; preserve correct daylight saving and next-day behavior. Keep unambiguous 24-hour times in both locales. Existing Monday-first calendar layout can remain.
- English input in the default demo parser should handle the supported common game/time/player/role patterns (e.g. tomorrow evening, next weekend, upcoming weekends); uncertain text remains an editable draft with uncertainty visible. The actual DeepSeek provider remains optional and explicitly unverified without a real key.

## README and project presentation

- `README.md`: English default for international readers; `README.zh-CN.md`: complete Chinese companion. Both link clearly to each other and cover equivalent capabilities, limitations and commands.
- Opening section: name, concise value proposition, self-created banner and actual app screenshots. Show a believable example spanning US Central and Beijing, with synthetic names and activities only. No real friends, email addresses, join tokens or recovery credentials in published images.
- Explain three differentiators: time-zone-aware availability, rule-based player/role readiness, and independent spaces for different friend groups. Position AI as an optional draft aid, not the mechanism that decides attendance or grants access.
- Include a short walk-through, architecture diagram, technical decisions, quick start, tests, self-hosting, noncommercial license and realistic roadmap. Move operational details to docs; avoid a long wall of implementation inventory at the top.
- Present the project as created/maintained by Chaoan Li with AI-assisted development. Do not claim all code was manually written, invent adoption metrics, testimonials, performance numbers or production availability.
- Do not create a fake live-demo link: the repository can be a strong runnable showcase before the domain is deployed. A local demonstration with explicit synthetic seed data is sufficient for screenshots.
- Add/refresh third-party notices, concise contribution/security guidance, a focused architecture/decision document and test instructions. Existing detailed design/history can remain accessible, without being the main README narrative.
- Prepare repository description/topics and a share preview using self-created assets. Do not modify the user's profile, personal website or unrelated repositories.

## Noncommercial license and third-party materials

Proposed license: **PolyForm Noncommercial License 1.0.0**, reproduced unmodified from its official source in `LICENSE`; a separate notice identifies the licensor as Chaoan Li. Explain permitted noncommercial use and that commercial use outside those permissions requires separate authorization. Do not use MIT for the original project or label it OSI-approved open source.

The license explicitly permits certain personal uses and uses by specified noncommercial organizations. The standard license text controls; README summaries must not redefine its scope or add contradictory restrictions. Do not promise that a license technically prevents copying or misuse.

Third-party components retain their licenses. The embedded Lucide paths require the ISC notice and, for Feather-derived icons, the applicable MIT notice. Include both where relevant; system fonts do not require fetching external font assets. Newly created artwork can be kept as repository-native SVGs and rendered screenshots, with no external stock-image dependency.

Primary references reviewed:

- https://polyformproject.org/licenses/noncommercial/1.0.0
- https://polyformproject.org/why-adopt-polyform
- https://opensource.org/osd
- https://lucide.dev/license
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility

## Public release boundary

The repository remains private during preparation. Inspect **all Git history**, tracked assets and configuration before proposing public release. Current baseline audit: four commits, 177 unique file blobs, no common credential-pattern matches and no tracked database/backup/local operational record. This is evidence from a targeted audit, not a guarantee that all possible secrets are absent.

Keep `.env`, SQLite files/WAL/backups, private keys, cloud resource operation notes, local logs, node_modules and generated private data excluded. Use safe placeholders and synthetic screenshot fixtures. Do not rewrite Git history or delete the user's existing data as a routine presentation cleanup.

When the code, both READMEs, license and screenshots are concrete and reviewable, present the result before changing visibility. Public release exposes the repository's commit history and permits public forks; switching back to private does not retract existing public copies. The user has said to consider public release, so request an explicit final release decision at that point. Do not ask for passwords or create new credentials.

## Verification and completion

1. Preserve all existing space-isolation/permissions tests and rules. Language switching cannot cross spaces or grant access, including concurrent requests and delayed bodies.
2. Add tests for locale selection/persistence, stale language responses, English/Chinese system errors and status/date formatting, catalog names vs custom content, recipient-language email/notifications, and English demo parsing.
3. Test US Central/Beijing next-day conversion and US daylight-saving transitions in both languages; language changes leave UTC instants and attendance identical.
4. Verify real UI journeys in both languages: create/select space, request/approve membership, create/share an activity, respond and view readiness, calendar, notifications and account preferences. Inspect English length/wrapping and narrow screen layout. Existing Chinese records retain their content.
5. Run full tests, all typechecks and H5 production build. Check dictionary coverage and untranslated new system text, broken README links/assets and license/notice completeness. Be candid about services and platforms not actually tested.
6. Obtain one fresh read-only review of the completed implementation and address significant issues with regression tests.
7. Push the prepared result to the existing private repository. Verify remote commit and reviewable rendered READMEs before the final public-visibility decision.

## Decisions left to the implementer

Use the existing React/Taro + Hono + SQLite architecture, dependencies and visual components where suitable. Choose dictionary structure, translation keys, exact locale preference API fields, localization metadata, component splits, banner composition and screenshot tooling. Prefer explicit, typed localization over runtime DOM text replacement or automatic external translation.

The work can be staged in a single plan: localization infrastructure and core/server text, bilingual client and visual polish, showcase/license/docs/assets, then verification and publication preparation. Real hosting, DNS, SMTP provider setup, real DeepSeek billing/key validation and new gameplay features remain outside this round.
