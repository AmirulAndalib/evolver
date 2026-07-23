## Summary

Short 1-2 sentence summary of the change.

## What changed

- Bullet list of changes

## How to test

1. Copy commands
2. Expected output

## Risk

Low / Medium / High -- note if it touches infra or public API.

## Harness/evaluator governance

Required when this PR touches Evolver harness/evaluator/self-evolution surfaces:
GEP schemas, prompt/selector/mutation/solidify/candidate/evaluator logic,
evolve pipeline, adapter execution bridge, proxy routing/trace, bundled GEP
assets, or the EvoX bridge contract. For unrelated PRs, write
`N/A -- not a harness/evaluator governance change` on each line.

Upstream governance surface: <typed Evolver surface, or N/A>
Downstream EvoX impact: <bridge/contract/runtime impact, or N/A>
Rollout-local scope: <proposal/shadow/cohort boundary before promotion, or N/A>
Promotion boundary: <proposal→rollout→PR/default boundary, or N/A>
Evaluator mismatch sets: <observation/action/repair/verification/evidence/belief sets covered, or N/A>
Non-regression evidence: <tests/shadow runs/replay/doc-only rationale, or N/A>
Fix-severity review: <low | medium | high | critical>
Owner approval: <owning module/reviewer requirement, or N/A>
Security boundary: <data/tool/host/network/secrets impact, or N/A>
Rollback: <disable/revert/quarantine path, or N/A>
Live promotion: no
Autonomous evaluator self-editing: no

## Self-check

Tick only the boxes that apply, but every applicable box must be ticked. Bugbot
reads the project rules and will request changes if anything below is missing.

- [ ] If this PR adds a new source file under `src/`, it is registered in
      `public.manifest.json` consistently with its sibling files (e.g. listed
      in `obfuscate` when the rest of the directory is). Build verification
      passed: `node scripts/build_public.js` succeeded and the new file shows
      up in `dist-public/` in the expected (obfuscated or plain) form.
- [ ] If this PR adds or modifies a schema factory under `src/gep/schemas/`,
      the corresponding `validate*` function is invoked at every write and
      every publish call site (not just defined).
- [ ] If this PR uses `Object.assign({}, DEFAULTS, partial)` to build an
      object, every reference-typed field (arrays, sub-objects) on the result
      is sliced or cloned -- not held by reference to either source.
- [ ] If this PR introduces a new module-level constant initialized from
      `process.env.X`, the owning module is loaded after the entry point's
      dotenv configuration step (or the constant is migrated to the lazy
      env helpers in `src/config.js`).
- [ ] No new runtime dependencies added without a clear justification in the
      "What changed" section above.
- [ ] Tests added or updated to cover the new behavior; full suite passes
      locally (`node --test test/*.test.js`).

## Related

Closes #NN
