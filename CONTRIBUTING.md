# Contributing

OneMore is a small, self-hosted project for friends who want to play together.
Bug reports, accessibility improvements, translations, tests and focused fixes
are welcome. Please read [LICENSE](LICENSE) before using or contributing code.
Contributions are offered under the same license as this project; keep any
third-party notices and identify externally sourced code.

Use Node 24 and `npm ci`. Before submitting a change, run:

```sh
npm test
npm run typecheck
npm run build
```

For behavioral changes, add a regression test that exercises the user-visible
rule. Test with a separate `DB_PATH`; never commit databases, recovery codes,
space invitation links, calendar feed tokens, `.env` files or credentials.

Preserve these invariants:

- A request acts in one explicit space after current membership is checked.
- A removed member cannot receive queued messages or keep a working feed token.
- UTC instants, IANA time zones and display language remain separate.
- Translate explicit system templates, never user-written titles or names.
- AI produces a validated draft; only the user creates an event.

Keep pull requests small and explain the problem, resulting behavior and checks.
The project currently targets H5. WeChat builds and real external service
integrations need separate evidence before claiming support.
