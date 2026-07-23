## Contributing

Thank you for contributing. Please follow these rules:

- Do not use emoji (except the DNA emoji in documentation if needed).
- Keep changes small and reviewable.
- Update related documentation when you change behavior.
- Run `node index.js` for a quick sanity check.

Submit PRs with clear intent and scope.

### Engineering conventions

- **Evolver is the upstream governance source for EvoX harness/evolver behavior.**
  Any PR that changes harness/evaluator/self-evolution surfaces (GEP schemas,
  prompt/selector/mutation/solidify/candidate/evaluator logic, evolve pipeline,
  adapter execution bridge, proxy routing/trace, bundled GEP assets, or the EvoX
  bridge contract) must fill the `## Harness/evaluator governance` PR-template
  packet. The required packet documents the whitelisted surface, downstream EvoX
  impact, rollout-local scope, promotion boundary, evaluator mismatch sets,
  non-regression evidence, fix severity, owner approval, security boundary,
  rollback, and the two hard denials: `Live promotion: no` and
  `Autonomous evaluator self-editing: no`. `scripts/harness-governance-check.js`
  enforces this on PRs.

- **Spawn child CLIs as `node <entry.js>` — never via a `.cmd` shim, npm symlink, or bare command name.** When launching a harness/tool subprocess (claude-code, openclaw, codex, ...), resolve the JS entry behind the launcher and hand it to `node` directly. Two reasons:
  1. On Windows, `child_process.spawn` without `shell:true` on a `.cmd`/`.bat` throws `EINVAL` since the CVE-2024-27980 fix (Node >=18.20.2 / 20.12.2 / 21.7.3) — this silently broke the auto-exec bridge on Windows.
  2. Across platforms, shims/wrappers can emit warnings or silently exit on some machines. `node <entry>` is zero-shell, deterministic, and passes args via argv (no shell-injection surface).

  `runChild` in `src/gep/execBridge.js` implements this for Windows npm shims (`_resolveNpmCmdShim`: parse the shim's `"%dp0%\<entry>" %*` exec line and rewrite `(bin, args)` -> `(process.execPath, [<entry>, ...args])`), falling back to the original target when it is not a recognized npm shim. POSIX binaries / wrappers spawn natively and are left unchanged. A unit test (`test/execBridgeSpawnNpmShim.test.js`) enforces the parser.

