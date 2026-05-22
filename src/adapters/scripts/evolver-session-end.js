#!/usr/bin/env node
// evolver-session-end.js
// Records evolution outcome at session end.
// Collects git diff stats, extracts signals, records via Hub API or local memory.
// Input: stdin JSON. Output: stdout JSON with followup_message.

const fs = require('fs');
const { spawnSync } = require('child_process');
// 10 MB — prevents RangeError on large child process output (e.g. git log/diff
// on large repos). See GHSA reports / issue #451.
const MAX_EXEC_BUFFER = 10 * 1024 * 1024;

const { findEvolverRoot, findMemoryGraph } = require('./_runtimePaths');

function runGit(args, cwd) {
  // Argv-array form, no shell. Avoids POSIX `2>/dev/null` redirects that
  // break on Windows cmd.exe (#537). Failures (e.g. no HEAD~1 in a fresh
  // repo) are surfaced as a non-zero status; callers distinguish them
  // from successful empty output via the `ok` flag (PR #94 round-6 LOW).
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: MAX_EXEC_BUFFER,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (res.status === 0 && typeof res.stdout === 'string') {
    return { ok: true, out: res.stdout.trim() };
  }
  return { ok: false, out: '' };
}

function getGitDiffStats() {
  const cwd = process.cwd();
  // Distinguish "git failed (no HEAD~1, etc.)" from "git succeeded with
  // empty output (e.g. empty merge)". The previous `||` chain treated
  // both as falsy and fell through to the working-tree diff, which can
  // surface unrelated unstaged changes as the session outcome.
  const statHead1 = runGit(['diff', '--stat', 'HEAD~1'], cwd);
  const stat = statHead1.ok ? statHead1.out : runGit(['diff', '--stat'], cwd).out;
  const diffHead1 = runGit(['diff', '--no-color', 'HEAD~1'], cwd);
  const diffContent = diffHead1.ok ? diffHead1.out : runGit(['diff', '--no-color'], cwd).out;
  const filesChanged = (stat.match(/\d+ files? changed/) || ['0'])[0];
  const insertions = (stat.match(/(\d+) insertions?/) || [null, '0'])[1];
  const deletions = (stat.match(/(\d+) deletions?/) || [null, '0'])[1];
  return {
    stat,
    summary: `${filesChanged}, +${insertions}/-${deletions}`,
    diffSnippet: diffContent.slice(0, 2000),
    hasChanges: stat.length > 0,
  };
}

function detectSignals(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const signals = [];
  if (/error:|exception:|failed/i.test(lower)) signals.push('log_error');
  if (/timeout|slow|latency|bottleneck/i.test(lower)) signals.push('perf_bottleneck');
  if (/add|implement|feature|new function|new module/i.test(lower)) signals.push('user_feature_request');
  if (/improve|enhance|refactor|optimize/i.test(lower)) signals.push('user_improvement_suggestion');
  if (/not supported|unsupported|not implemented/i.test(lower)) signals.push('capability_gap');
  if (/deploy|ci|pipeline|build failed/i.test(lower)) signals.push('deployment_issue');
  if (/test fail|assertion|expect\(/i.test(lower)) signals.push('test_failure');
  return [...new Set(signals)];
}

function recordToHub(outcome) {
  const hubUrl = process.env.EVOMAP_HUB_URL || process.env.A2A_HUB_URL;
  const apiKey = process.env.EVOMAP_API_KEY || process.env.A2A_NODE_SECRET;
  const nodeId = process.env.EVOMAP_NODE_ID || process.env.A2A_NODE_ID;
  if (!hubUrl || !apiKey) return false;

  try {
    const payload = JSON.stringify({
      gene_id: outcome.geneId || 'ad_hoc',
      signals: outcome.signals,
      status: outcome.status,
      score: outcome.score,
      summary: outcome.summary,
      sender_id: nodeId || undefined,
    });
    // Argv-array form avoids shell interpretation of apiKey, payload, or the
    // hub URL. Values cannot break out through shell metacharacters.
    const res = spawnSync('curl', [
      '-s', '-m', '8', '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-H', `Authorization: Bearer ${apiKey}`,
      '-d', payload,
      `${hubUrl.replace(/\/+$/, '')}/a2a/evolution/record`,
    ], {
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: MAX_EXEC_BUFFER,
      shell: false,
    });
    if (res.status !== 0 || res.error) return false;
    return true;
  } catch {
    return false;
  }
}

function recordToLocal(graphPath, outcome) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      gene_id: outcome.geneId || 'ad_hoc',
      signals: outcome.signals,
      outcome: {
        status: outcome.status,
        score: outcome.score,
        note: outcome.summary,
      },
      source: 'hook:session-end',
    };
    fs.appendFileSync(graphPath, JSON.stringify(entry) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

function main() {
  let inputData = '';
  let handled = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { inputData += chunk; });
  process.stdin.on('end', () => {
    if (handled) return;
    handled = true;
    try {
      const diffInfo = getGitDiffStats();

      if (!diffInfo.hasChanges) {
        process.stdout.write(JSON.stringify({}));
        return;
      }

      const signals = detectSignals(diffInfo.diffSnippet);
      if (signals.length === 0) signals.push('stable_success_plateau');

      const hasErrors = signals.includes('log_error') || signals.includes('test_failure');
      const status = hasErrors ? 'failed' : 'success';
      const score = hasErrors ? 0.3 : 0.8;

      const outcome = {
        geneId: 'ad_hoc',
        signals,
        status,
        score,
        summary: `Session end: ${diffInfo.summary}. Signals: [${signals.join(', ')}]`,
      };

      const evolverRoot = findEvolverRoot();
      const graphPath = findMemoryGraph(evolverRoot);

      const hubOk = recordToHub(outcome);
      const localOk = graphPath ? recordToLocal(graphPath, outcome) : false;

      const target = hubOk ? 'Hub' : localOk ? 'local memory' : 'nowhere (no Hub or local path)';
      const msg = `[Evolution] Session outcome recorded to ${target}: ${outcome.summary}`;

      process.stdout.write(JSON.stringify({
        followup_message: msg,
        stopMessage: msg,
        additionalContext: msg,
      }));
    } catch (e) {
      process.stdout.write(JSON.stringify({}));
    }
  });

  setTimeout(() => {
    if (handled) return;
    handled = true;
    process.stdout.write(JSON.stringify({}));
    process.exit(0);
  }, 7000);
}

main();
