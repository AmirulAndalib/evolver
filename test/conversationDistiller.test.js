'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  distillConversation,
  evaluateGate,
  normalizeConversationInput,
  inferSignals,
} = require('../src/gep/conversationDistiller');

// A conversation that is *about* the evolver mechanism itself: it only mentions
// genes/capsules/distillation/self-evolution, with no concrete domain work.
const META_ONLY = {
  summary: 'We discussed how the evolver distills genes and whether reusing a gene about reusing genes is worth it.',
  strategy: [
    'Talk about how gene distillation works in evolver',
    'Debate whether capsules should be recalled again',
    'Decide the evomap self-evolution loop needs a guard',
  ],
  artifacts: ['notes-about-genes.md'],
  validation: ['node --version'],
  platform: 'claude-code',
};

// A real domain capability: publishing a Feishu doc via lark-cli. Mentions no
// evolver meta words — the ordinary case that must keep distilling.
const DOMAIN = {
  summary: 'Publish a markdown file as a Feishu doc via lark-cli and return the shareable url.',
  strategy: [
    'Render the markdown body with the im-markdown format',
    'Call lark-cli docs +create with the rendered content',
    'Verify the returned url resolves before reporting success',
  ],
  artifacts: ['publish-feishu-doc.md'],
  validation: ['lark-cli auth status'],
  platform: 'claude-code',
};

describe('evaluateGate — meta self-reference gate', () => {
  it('rejects a meta-only conversation with reason meta_self_reference', () => {
    const normalized = normalizeConversationInput(META_ONLY);
    const gate = evaluateGate(META_ONLY, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
    // Guard the premise: every inferred signal really is a meta signal.
    for (const s of normalized.signals) {
      assert.ok(
        ['conversation_distillation', 'gene_publish', 'agent_self_evolution', 'reusable_capability'].includes(s),
        `unexpected non-meta signal leaked in: ${s}`,
      );
    }
  });

  it('passes a real domain conversation (has a domain signal)', () => {
    const normalized = normalizeConversationInput(DOMAIN);
    const gate = evaluateGate(DOMAIN, normalized);
    assert.equal(gate.ok, true, `expected pass, got ${gate.reason} score=${gate.score}`);
  });

  it('rejects meta discussion even when reusable/test/plugin words match broad signals', () => {
    const input = {
      summary: 'We discussed whether a reusable gene about reusing genes should be distilled into the evolver plugin test workflow.',
      strategy: [
        'Talk about how the evolver plugin recalls reusable genes',
        'Debate whether this repeatable gene workflow is self-referential',
        'Verify with node --version that the test environment exists',
      ],
      artifacts: ['gene-reuse-notes.md'],
      validation: ['node --version'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(normalized.signals.includes('reusable_capability'));
    assert.ok(normalized.signals.includes('plugin_integration'));
    assert.ok(normalized.signals.includes('test_verified'));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
  });

  it('rejects meta discussion whose meta vocabulary only appears in strategy/artifacts', () => {
    const input = {
      summary: 'We captured a repeatable workflow and debated whether it should be preserved.',
      strategy: [
        'Discuss how gene distillation works in the evolver',
        'Debate whether this reusable gene should recall another reusable gene',
        'Verify the generic runner still starts with npm test',
      ],
      artifacts: ['gene-reuse-notes'],
      validation: ['npm test'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(normalized.signals.includes('gene_publish'));
    assert.ok(normalized.signals.includes('test_verified'));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
  });

  it('rejects caller-supplied meta signals even without literal meta vocabulary', () => {
    const input = {
      summary: 'We discussed whether this reusable workflow should be stored for later recall.',
      signals: ['gene_publish'],
      strategy: [
        'Talk about the storage rule',
        'Debate whether a reusable workflow about reusable workflows is valuable',
        'Run npm run build as a generic check',
      ],
      artifacts: ['reuse-policy-notes'],
      validation: ['npm run build'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
  });

  it('does not treat generated fallback strategy Proxy/Hub wording as domain evidence', () => {
    const input = {
      summary: 'We discussed whether reusing a gene about reusing genes is worth distilling in evolver.',
      artifacts: ['gene-reuse-notes'],
      validation: ['node --version'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(normalized.strategy.some((step) => /Proxy.*Hub/.test(step)));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
  });

  it('rejects meta discussion despite incidental strong signals in strategy evidence', () => {
    const input = {
      summary: 'We discussed whether a reusable gene about reusing genes should be distilled.',
      strategy: [
        'Mock the interaction between two capsules while debating the gene recall loop',
        'Capture a visual note about whether reusable genes should recall reusable genes',
        'Run npm test as a generic check',
      ],
      artifacts: ['gene-reuse-notes'],
      validation: ['npm test'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(normalized.signals.includes('frontend_polish'));
    assert.ok(normalized.signals.includes('visual_annotation'));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, false);
    assert.equal(gate.reason, 'meta_self_reference');
  });

  it('passes concrete GEP work even when concrete evidence appears after long text', () => {
    const input = {
      summary: 'Discuss gene distillation behavior. ' + 'padding '.repeat(1500),
      strategy: [
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Preserve filler context before the concrete file evidence. ' + 'detail '.repeat(30),
        'Update src/gep/conversationDistiller.js after the long transcript context',
      ],
      artifacts: ['src/gep/conversationDistiller.js', 'test/conversationDistiller.test.js'],
      validation: ['node --test test/conversationDistiller.test.js'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(!normalized.evidence_text.includes('src/gep/conversationDistiller.js'));
    assert.ok(normalized.evidence_parts.some((part) => part.includes('src/gep/conversationDistiller.js')));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, true, `expected pass, got ${gate.reason} score=${gate.score}`);
  });

  it('passes concrete evolver/GEP engineering even when gene meta words are present', () => {
    const input = {
      summary: 'Fix src/gep/conversationDistiller.js so gene distillation keeps real GEP engineering work but rejects meta-only reuse loops.',
      strategy: [
        'Update src/gep/conversationDistiller.js with concrete domain evidence checks',
        'Add regression coverage in test/conversationDistiller.test.js',
        'Run node --test test/conversationDistiller.test.js',
      ],
      artifacts: ['src/gep/conversationDistiller.js', 'test/conversationDistiller.test.js'],
      validation: ['node --test test/conversationDistiller.test.js'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, true, `expected pass, got ${gate.reason} score=${gate.score}`);
  });

  it('passes domain-specific source text even with discussion-style meta wording', () => {
    const input = {
      summary: 'Discuss whether the frontend interaction workflow should be distilled as a reusable gene after verifying the share URL.',
      strategy: [
        'Render markdown for Feishu',
        'Call lark-cli docs +create',
        'Verify the share URL resolves',
      ],
      artifacts: ['publish-feishu-doc.md'],
      validation: ['lark-cli auth status'],
      platform: 'claude-code',
    };
    const normalized = normalizeConversationInput(input);
    assert.ok(normalized.source_signals.includes('frontend_polish'));
    const gate = evaluateGate(input, normalized);
    assert.equal(gate.ok, true, `expected pass, got ${gate.reason} score=${gate.score}`);
  });

  it('no longer awards the +2 explicit_distill_signal bonus', () => {
    // A domain conversation that also happens to mention "gene"/"distill" must
    // NOT score higher for it — reusability is proven by structure, not by
    // naming the evolver. Its reasons must never include the removed bonus.
    const withMetaWords = {
      ...DOMAIN,
      summary: DOMAIN.summary + ' We also distilled this into a reusable gene for evomap.',
    };
    const normalized = normalizeConversationInput(withMetaWords);
    const gate = evaluateGate(withMetaWords, normalized);
    assert.ok(!gate.reasons.includes('explicit_distill_signal'), 'the +2 self-referential bonus must be gone');
  });
});

describe('inferSignals — DEFAULT_SIGNALS no longer self-labels', () => {
  it('a signal-less conversation is not tagged with any meta-self signal', () => {
    // Text with no rule match falls back to DEFAULT_SIGNALS. That fallback must
    // not brand the conversation as self-evolution or distillation, which would
    // make it recall against its own meta signals.
    const signals = inferSignals('xyzzy plugh frobnicate', []);
    assert.ok(!signals.includes('agent_self_evolution'), 'default fallback must not self-label as agent_self_evolution');
    assert.ok(!signals.includes('conversation_distillation'), 'default fallback must not self-label as conversation_distillation');
    assert.ok(!signals.includes('gene_publish'), 'default fallback must not self-label as gene_publish');
  });
});

describe('distillConversation — end-to-end gate wiring', () => {
  it('skips a meta-only conversation without persisting', () => {
    const res = distillConversation(META_ONLY, { persist: false });
    assert.equal(res.ok, false);
    assert.equal(res.status, 'skipped');
    assert.equal(res.reason, 'meta_self_reference');
  });

  it('distils a real domain conversation', () => {
    const res = distillConversation(DOMAIN, { persist: false });
    assert.equal(res.ok, true, `expected ok, got ${res.reason}`);
    assert.equal(res.status, 'draft');
    assert.ok(res.gene && res.gene.id, 'a gene should be produced');
  });
});
