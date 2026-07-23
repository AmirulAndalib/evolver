#!/usr/bin/env node
'use strict';

const fs = require('fs');

const SENSITIVE_PATH_RE = /^(CONTRIBUTING\.md|\.github\/pull_request_template\.md|\.github\/workflows\/test\.yml|scripts\/harness-governance-check\.js|test\/harnessGovernanceCheck\.test\.js|src\/evolve\.js|src\/evolve\/|src\/adapters\/|src\/experiment\/|src\/gep\/|src\/proxy\/(router|trace)\/|src\/proxy\/inject\.js|assets\/gep\/)/;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--body') out.bodyFile = argv[++i];
    else if (arg === '--changed') out.changedFile = argv[++i];
    else if (arg === '--event') out.eventFile = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error('unknown argument: ' + arg);
  }
  return out;
}

function stripHtmlComments(text) {
  return String(text || '').replace(/<!--[\s\S]*?-->/g, '');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

function readBody(opts) {
  if (opts.bodyFile) return fs.readFileSync(opts.bodyFile, 'utf8');
  if (opts.eventFile) {
    const event = JSON.parse(fs.readFileSync(opts.eventFile, 'utf8'));
    return String(event && event.pull_request && event.pull_request.body || '');
  }
  if (process.env.PR_BODY_FILE) return fs.readFileSync(process.env.PR_BODY_FILE, 'utf8');
  if (process.env.PR_BODY) return String(process.env.PR_BODY);
  return readStdin();
}

function readChangedFiles(opts) {
  let raw = '';
  if (opts.changedFile) raw = fs.readFileSync(opts.changedFile, 'utf8');
  else if (process.env.PR_CHANGED_FILES_FILE) raw = fs.readFileSync(process.env.PR_CHANGED_FILES_FILE, 'utf8');
  else if (process.env.PR_CHANGED_FILES) raw = String(process.env.PR_CHANGED_FILES);
  return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.replace(/\\/g, '/'));
}

function changedFilesTouchGovernanceSurface(files) {
  return files.some(f => SENSITIVE_PATH_RE.test(f));
}

function lineValue(body, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = body.match(new RegExp('^' + escaped + ':\\s*(.*)$', 'im'));
  return match ? match[1].trim() : null;
}

function isSubstantiveValue(value) {
  if (!value) return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/[<>]/.test(normalized)) return false;
  if (/^n\/?a\.?(?:$|[\s:;,.\-–—])/i.test(normalized)) return false;
  return true;
}

function valueMatches(body, label, valuePattern) {
  const value = lineValue(body, label);
  return isSubstantiveValue(value) && valuePattern.test(value);
}

function validateGovernancePacket(body, changedFiles) {
  const stripped = stripHtmlComments(body);
  const errors = [];
  if (!changedFilesTouchGovernanceSurface(changedFiles)) return errors;

  if (!/^##+\s+Harness\/evaluator governance/im.test(stripped)) {
    errors.push('missing ## Harness/evaluator governance — add the PR-template section from CONTRIBUTING.md');
  }

  const requiredValues = [
    ['Upstream governance surface', /\S/, 'name the Evolver harness/evaluator surface; template placeholders and bare N/A are not accepted for sensitive diffs'],
    ['Downstream EvoX impact', /\S/, 'state whether EvoX downstream behavior or contracts are affected; template placeholders and bare N/A are not accepted'],
    ['Rollout-local scope', /\S/, 'state the proposal/shadow/cohort boundary before promotion'],
    ['Promotion boundary', /\S/, 'state how rollout becomes default behavior'],
    ['Evaluator mismatch sets', /\S/, 'cover observation/action/repair/verification/evidence/belief deltas or explain why each is not changed'],
    ['Non-regression evidence', /\S/, 'link tests, shadow runs, replay, or doc-only rationale'],
    ['Fix-severity review', /^(low|medium|high|critical)\b/i, 'classify the strongest fix severity'],
    ['Owner approval', /\S/, 'name the owning module/reviewer requirement'],
    ['Security boundary', /\S/, 'state data/tool/host/network/secrets impact'],
    ['Rollback', /\S/, 'state how to disable/revert/quarantine'],
    ['Live promotion', /^no$/i, "state exactly 'Live promotion: no'"],
    ['Autonomous evaluator self-editing', /^no$/i, "state exactly 'Autonomous evaluator self-editing: no'"],
  ];

  for (const [label, pattern, hint] of requiredValues) {
    if (!valueMatches(stripped, label, pattern)) {
      errors.push('missing ' + label + ' — ' + hint);
    }
  }
  return errors;
}

function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log('usage: node scripts/harness-governance-check.js [--body file | --event file] --changed file');
    return 0;
  }
  const body = readBody(opts);
  const changedFiles = readChangedFiles(opts);
  const errors = validateGovernancePacket(body, changedFiles);
  if (errors.length) {
    console.error('Harness/evaluator governance gate FAILED.');
    for (const err of errors) console.error('- ' + err);
    console.error('Changed sensitive files:');
    for (const f of changedFiles.filter(f => SENSITIVE_PATH_RE.test(f))) console.error('- ' + f);
    return 1;
  }
  if (changedFilesTouchGovernanceSurface(changedFiles)) {
    console.log('Harness/evaluator governance gate: PASSED');
  } else {
    console.log('Harness/evaluator governance gate: not applicable');
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error('Harness/evaluator governance gate ERROR: ' + (err && err.message || err));
    process.exitCode = 2;
  }
}

module.exports = {
  changedFilesTouchGovernanceSurface,
  validateGovernancePacket,
  stripHtmlComments,
  isSubstantiveValue,
  SENSITIVE_PATH_RE,
};
