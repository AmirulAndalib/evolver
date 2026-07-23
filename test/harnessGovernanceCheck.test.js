const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  changedFilesTouchGovernanceSurface,
  validateGovernancePacket,
  stripHtmlComments,
} = require('../scripts/harness-governance-check');

const basePacket = `
## Harness/evaluator governance

Upstream governance surface: PR metadata guard for Evolver harness/evaluator surfaces
Downstream EvoX impact: requires downstream PRs to keep EvoX bridge contracts aligned
Rollout-local scope: PR-time CI only
Promotion boundary: merge through reviewed PR only
Evaluator mismatch sets: observation/action/repair/verification/evidence/belief N/A for CI guard
Non-regression evidence: node --test test/harnessGovernanceCheck.test.js
Fix-severity review: low
Owner approval: repo owner via CODEOWNERS
Security boundary: no data/tool/host/network/secrets change
Rollback: revert this PR
Live promotion: no
Autonomous evaluator self-editing: no
`;

describe('harness governance PR gate', () => {
  it('does not trigger for unrelated docs', () => {
    assert.equal(changedFilesTouchGovernanceSurface(['docs/release-workflow.md']), false);
    assert.deepEqual(validateGovernancePacket('', ['docs/release-workflow.md']), []);
  });

  it('triggers on upstream harness/evaluator surfaces', () => {
    assert.equal(changedFilesTouchGovernanceSurface(['src/gep/selector.js']), true);
    assert.equal(changedFilesTouchGovernanceSurface(['src/gep/a2aProtocol.js']), true);
    assert.equal(changedFilesTouchGovernanceSurface(['src/gep/validator/report.js']), true);
    assert.equal(changedFilesTouchGovernanceSurface(['src/evolve/pipeline/select.js']), true);
    assert.equal(changedFilesTouchGovernanceSurface(['src/proxy/router/model_router.js']), true);
    assert.equal(changedFilesTouchGovernanceSurface(['assets/gep/genes.json']), true);
  });

  it('requires the governance packet for sensitive changes', () => {
    const errors = validateGovernancePacket('## Summary\nchange selector', ['src/gep/selector.js']);
    assert.ok(errors.length >= 8, 'sensitive change should require multiple evidence lines');
    assert.ok(errors.some(e => e.includes('Live promotion')));
    assert.ok(errors.some(e => e.includes('Autonomous evaluator self-editing')));
  });

  it('rejects unchanged template placeholders for sensitive changes', () => {
    const placeholderPacket = `
## Harness/evaluator governance

Upstream governance surface: <typed Evolver surface, or N/A>
Downstream EvoX impact: <bridge/contract/runtime impact, or N/A>
Rollout-local scope: <proposal/shadow/cohort boundary before promotion, or N/A>
Promotion boundary: <proposal→rollout→PR/default boundary, or N/A>
Evaluator mismatch sets: <observation/action/repair/verification/evidence/belief sets covered, or N/A>
Non-regression evidence: <tests/shadow runs/replay/doc-only rationale, or N/A>
Fix-severity review: low
Owner approval: <owning module/reviewer requirement, or N/A>
Security boundary: <data/tool/host/network/secrets impact, or N/A>
Rollback: <disable/revert/quarantine path, or N/A>
Live promotion: no
Autonomous evaluator self-editing: no
`;
    const errors = validateGovernancePacket(placeholderPacket, ['src/gep/a2aProtocol.js']);
    assert.ok(errors.some(e => e.includes('Upstream governance surface')));
    assert.ok(errors.some(e => e.includes('Downstream EvoX impact')));
  });

  it('rejects N/A template evidence for sensitive changes', () => {
    const bareNaPacket = `
## Harness/evaluator governance

Upstream governance surface: N/A -- not a harness/evaluator governance change
Downstream EvoX impact: N/A
Rollout-local scope: N/A:
Promotion boundary: N/A.
Evaluator mismatch sets: N/A
Non-regression evidence: N/A
Fix-severity review: low
Owner approval: N/A
Security boundary: N/A
Rollback: N/A
Live promotion: no
Autonomous evaluator self-editing: no
`;
    const errors = validateGovernancePacket(bareNaPacket, ['src/gep/a2aProtocol.js']);
    assert.ok(errors.some(e => e.includes('Upstream governance surface')));
    assert.ok(errors.some(e => e.includes('Rollback')));
  });

  it('accepts a complete governance packet for sensitive changes', () => {
    const errors = validateGovernancePacket('## Summary\nchange gate\n' + basePacket, ['src/gep/selector.js']);
    assert.deepEqual(errors, []);
  });

  it('requires exact hard no values', () => {
    const softNoPacket = basePacket
      .replace('Live promotion: no', 'Live promotion: no, but later yes')
      .replace('Autonomous evaluator self-editing: no', 'Autonomous evaluator self-editing: no way');
    const errors = validateGovernancePacket(softNoPacket, ['src/gep/selector.js']);
    assert.ok(errors.some(e => e.includes('Live promotion')));
    assert.ok(errors.some(e => e.includes('Autonomous evaluator self-editing')));
  });

  it('strips HTML comments before validation', () => {
    const text = `<!--\n## Harness/evaluator governance\nLive promotion: no\nAutonomous evaluator self-editing: no\n-->`;
    assert.equal(stripHtmlComments(text).trim(), '');
    const errors = validateGovernancePacket(text, ['src/gep/selector.js']);
    assert.ok(errors.length > 0);
  });
});
