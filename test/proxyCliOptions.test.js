'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const {
  parseProxyCliPathOptions,
  prepareProxyCliEnvironment,
} = require('../cli-options');
const { EvoMapProxy } = require('../src/proxy');
const settings = require('../src/proxy/server/settings');

const ENV_KEYS = [
  'EVOMAP_DIR',
  'EVOLVER_HOME',
  'EVOMAP_HOME',
  'EVOLVER_SETTINGS_DIR',
  'EVOLVER_PROXY_STORE',
  'EVOLVER_PROXY_SETTINGS_FILE',
  'EVOMAP_PROXY_TRACE_FILE',
  'EVOLVER_ENV_FILE',
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('v1 proxy CLI path options', () => {
  it('derives every proxy-owned path from --home and overrides stale values', () => {
    const root = path.join(os.tmpdir(), 'v1-proxy-cli-home');
    const env = {
      EVOLVER_HOME: '/stale/home',
      EVOLVER_PROXY_STORE: '/stale/store',
      EVOLVER_PROXY_SETTINGS_FILE: '/stale/settings.json',
      EVOMAP_PROXY_TRACE_FILE: '/stale/traces.jsonl',
    };

    prepareProxyCliEnvironment(['run', '--home', root], env);

    assert.equal(env.EVOLVER_HOME, root);
    assert.equal(env.EVOMAP_HOME, root);
    assert.equal(env.EVOLVER_SETTINGS_DIR, root);
    assert.equal(env.EVOLVER_PROXY_STORE, path.join(root, 'mailbox'));
    assert.equal(env.EVOLVER_PROXY_SETTINGS_FILE, path.join(root, 'settings.json'));
    assert.equal(env.EVOMAP_PROXY_TRACE_FILE, path.join(root, 'proxy', 'traces', 'proxy-traces.jsonl'));
  });

  it('applies fine-grained paths after --home regardless of argument order', () => {
    const root = path.join(os.tmpdir(), 'v1-proxy-cli-home-specific');
    const store = path.join(os.tmpdir(), 'v1-proxy-store');
    const settingsFile = path.join(os.tmpdir(), 'v1-proxy-settings.json');
    const env = {};

    prepareProxyCliEnvironment([
      '--store', store,
      '--settings', settingsFile,
      '--home=' + root,
    ], env);

    assert.equal(env.EVOLVER_HOME, root);
    assert.equal(env.EVOLVER_PROXY_STORE, store);
    assert.equal(env.EVOLVER_PROXY_SETTINGS_FILE, settingsFile);
  });

  it('loads --env-file and then reapplies CLI path priority', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-proxy-cli-env-'));
    const envFile = path.join(dir, 'proxy.env');
    const root = path.join(dir, 'home');
    fs.writeFileSync(envFile, [
      'A2A_HUB_URL=https://selected.example',
      'EVOLVER_PROXY_STORE=/from/env/store',
      '',
    ].join('\n'));
    const env = {};

    try {
      const prepared = prepareProxyCliEnvironment(['--env-file', envFile, '--home', root], env);
      assert.equal(prepared.envFile.loaded, true);
      assert.equal(env.A2A_HUB_URL, 'https://selected.example');
      assert.equal(env.EVOLVER_ENV_FILE, envFile);
      assert.equal(env.EVOLVER_PROXY_STORE, path.join(root, 'mailbox'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loads the environment-selected EVOLVER_ENV_FILE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-proxy-env-var-'));
    const envFile = path.join(dir, 'proxy.env');
    fs.writeFileSync(envFile, 'A2A_HUB_URL=https://env-selected.example\n');
    const env = { EVOLVER_ENV_FILE: envFile };

    try {
      const prepared = prepareProxyCliEnvironment([], env);
      assert.equal(prepared.envFile.loaded, true);
      assert.equal(env.A2A_HUB_URL, 'https://env-selected.example');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing path values', () => {
    assert.throws(() => parseProxyCliPathOptions(['--home']), /--home requires a path/);
    assert.throws(() => parseProxyCliPathOptions(['--store', '--loop']), /--store requires a path/);
  });

  it('routes explicit store and settings paths into v1 proxy consumers', () => {
    const store = path.join(os.tmpdir(), 'v1-proxy-explicit-store');
    const settingsFile = path.join(os.tmpdir(), 'v1-proxy-explicit-settings.json');
    process.env.EVOLVER_PROXY_STORE = store;
    process.env.EVOLVER_PROXY_SETTINGS_FILE = settingsFile;

    const proxy = new EvoMapProxy();
    assert.equal(proxy.dataDir, store);
    assert.equal(settings.getSettingsFile(), settingsFile);
    assert.equal(settings.getSettingsDir(), path.dirname(settingsFile));
  });
});
