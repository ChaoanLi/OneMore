# Verification / 验证记录

Date: 2026-10-23. The bilingual showcase extends the independent-space baseline below.

## Current bilingual build

- `npm test`: **61 core + 105 server/client = 166 passing tests**, including request-language concurrency, recipient email/account-locale ICS, UTC/DST calculations, notification metadata, historical text, validated scheduling presets, revoked queued permissions, locale bootstrap races, stale rejected responses and real React cached-page lifecycle behavior.
- `npm run typecheck`: core, server and client pass. React DOM types were added for the real hook regression test; JSDOM is an explicit development dependency, reusing the installed version.
- `npm run build`: production H5 succeeds. Two webpack size warnings remain; combined entry is approximately **600 KiB**. This is a size limitation, not a claim of measured network performance.
- Root integration regressions: locale-only bootstrap invalidation retries without restoring a replaced account; outdated network failures become `stale_context`. Display generations and content generations remain separate.
- Fresh scoped reviews: core/server approved; client review identified and then approved fixes for sheet refresh, structured interest presets, button contrast and hidden-page navigation. Final whole-branch review identified and then approved the fixes described below; no unresolved findings remain.

## Browser checks with isolated synthetic data

The browser used an independent temporary SQLite database, five invented accounts and two spaces. Existing personal databases were not opened or modified.

- English and Chinese home, event and space screens; both language selectors remain reachable. Actual H5 screenshots in `docs/assets` show synthetic data and contain no invitation/recovery/feed tokens.
- 375px responsive layout: page width and document scroll width both 375; checked readable controls and English wrapping. Corrected Taro's `disabled="false"` selector interaction; inactive language text computes to dark gray, active to white, with no wrapping.
- A linked event in space A → management → open B now stays in B and shows only B's event. Switching language preserves B. Returning to A shows A's separate events. Cached hidden pages can no longer select their old linked space.
- English demo request `Riichi mahjong tomorrow evening with 4 players` produces an editable draft. Chicago 20:00 and Beijing 09:00 the following day remain identical across language changes. No event or invitation is created by generating the draft.
- Mixed-language title and note entered in the draft remain verbatim after English→Chinese. Candidate times and switches remain selected. Email settings preserve typed input while the open sheet changes language. Account time zone remains US Central.
- Six real app screenshots (English/Chinese home, details and spaces) form the README gallery. The banner is a separate original SVG.

## Final integration review and fixes

The final review found four cross-layer issues: differing English catalog names,
stale profile merges, a new explicit language choice overwritten during bootstrap,
and successful command acknowledgements discarded by locale invalidation. They
were fixed together and passed a scoped re-review. Client game naming now uses the
shared core helper. Profile updates merge against the latest stored row; client
cache merges acknowledged fields and guards older reads. Explicit selections made
during bootstrap persist for the resolved identity. Language switching waits for
in-flight commands and their callers to acknowledge results; commands are never
retried automatically. New tests also cover first signup, replaced identities,
one-time calendar URL continuity and query-stamped page titles.

The root reran the complete 166-test suite, all three typechecks and H5 build after
these fixes. In the actual browser, a simulated 650ms network delay allowed a
language choice during event creation: the UI reached the created event in Chinese,
and the isolated database contained exactly one event with the test title. An
English-created built-in game displayed as Chinese 日麻. Generating a calendar
subscription, switching language and reading the displayed URL confirmed the same
URL remained available. The account still showed US Central time. Network emulation
was disabled after testing. The final whole-branch and scoped fix reviews reported
no remaining Critical, Important or Minor issues.

## External services and release limits

- No production DeepSeek request or real SMTP delivery verified. Default AI is a labelled keyword demo; email is a logged demo transport.
- No public domain deployment, mainland China/US reachability measurements, WeChat device validation, or third-party calendar polling measurement.
- Repository preparation remains private pending the user's explicit public-visibility decision. License is the unmodified official PolyForm Noncommercial 1.0.0; exact-text comparison passed. Lucide ISC and Feather MIT notices are retained separately.
- Credential-pattern and tracked-file/history checks are targeted checks, not a guarantee that every possible secret format is detectable. Databases, actual `.env`, private cloud notes, keys and temporary fixtures remain excluded.

# 先前的独立空间验证（基线）

日期：2026-10-23。

该阶段源码已上传私有仓库，以下是当时的验证记录。

- `npm test`：核心规则 53 项、服务端与客户端边界 48 项，共 101 项通过。
- `npm run typecheck`：core、server、client 全部通过。
- `npm run build`：H5 生产构建通过；保留两条包体积提示，入口约 531 KiB。
- 独立临时数据库运行 seed：创建 1 个明确的演示空间和 5 位成员，不在正式启动自动执行。
- 合成旧数据库测试：一致性备份、旧数据隔离、名单不完整时整条跳过、预览无业务写入、导入幂等。
- 浏览器：新账号创建空间、同账号创建 A/B、B 活动在 A 不显示、申请及批准、空间外分享链接拒绝访问、刷新后保持正确空间。跨空间跳转过滤 Taro 内部 stamp 参数，已在浏览器验证活动短码保留、共同成员切至所属空间，并有回归测试。
- 独立审阅发现的慢正文请求撤销竞态、管理员自申请降权已通过 RED→GREEN 回归修复。成员资格使用独立 generation，重新加入不能继续旧请求或旧邮件。
- Git 提交前检查凭证模式及文件清单；数据库、备份、实际环境密钥和本机云资源记录不进入仓库。

没有用真实 SMTP/DeepSeek 凭证联调；没有验证小程序真机、第三方日历的实际刷新周期或中美公网访问。原有个人数据库没有在验证过程中打开或修改。公网部署和域名配置是后续工作。
