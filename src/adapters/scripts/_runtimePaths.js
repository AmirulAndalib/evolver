// _runtimePaths.js
// Shared path resolution for evolver hook scripts.
//
// Two responsibilities:
//   1. Locate the evolver package root, supporting:
//      - $EVOLVER_ROOT explicit override
//      - The "scripts colocated with src" layout used during dev (../../..)
//      - The npm-global install layout, where the hook script lives under
//        `<prefix>/lib/node_modules/<host>/.../hooks/` and `..` walks lead
//        somewhere outside the evolver package. We resolve via
//        `require.resolve('@evomap/evolver/package.json')` instead.
//      - The `~/skills/evolver` fallback (some users symlink there).
//
//   2. Locate (or pick a writable default for) the evolution memory graph,
//      so that hook scripts in environments without an evolver-managed
//      project directory still record outcomes somewhere instead of
//      reporting "nowhere (no Hub or local path)" (#536).

const fs = require('fs');
const path = require('path');
const os = require('os');

function isEvolverPackageJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(raw);
    return pkg && (pkg.name === '@evomap/evolver' || pkg.name === 'evolver');
  } catch {
    return false;
  }
}

function findEvolverRoot() {
  if (process.env.EVOLVER_ROOT) {
    const explicit = process.env.EVOLVER_ROOT;
    if (fs.existsSync(path.join(explicit, 'package.json')) &&
        isEvolverPackageJson(path.join(explicit, 'package.json'))) {
      return explicit;
    }
  }

  // Dev/repo layout: this file lives at src/adapters/scripts/_runtimePaths.js,
  // so `../../..` is the package root.
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(repoRoot, 'package.json')) &&
      isEvolverPackageJson(path.join(repoRoot, 'package.json'))) {
    return repoRoot;
  }

  // npm-global / npm-local install layout. The hook script may have been
  // copied out of the package into `.claude/hooks/` etc., breaking relative
  // walks. Use require.resolve to find the installed package authoritatively.
  //
  // SECURITY: do NOT include `process.cwd()` here. A hostile workspace can
  // place its own `node_modules/@evomap/evolver/package.json`, which would
  // be selected here and control `findMemoryGraph()` -> the memory graph
  // contents become attacker-controlled prompt-injection material in
  // `evolver-session-start.js`'s `additionalContext`. Restrict to trusted,
  // user/system-scoped install roots.
  try {
    const pkgJson = require.resolve('@evomap/evolver/package.json', {
      paths: [
        path.join(os.homedir(), '.npm-global', 'lib', 'node_modules'),
        path.join(os.homedir(), '.local', 'lib', 'node_modules'),
        '/usr/lib/node_modules',
        '/usr/local/lib/node_modules',
      ],
    });
    if (pkgJson && isEvolverPackageJson(pkgJson)) {
      return path.dirname(pkgJson);
    }
  } catch { /* not installed via npm */ }

  const homeSkills = path.join(os.homedir(), 'skills', 'evolver');
  if (fs.existsSync(path.join(homeSkills, 'package.json')) &&
      isEvolverPackageJson(path.join(homeSkills, 'package.json'))) {
    return homeSkills;
  }

  return null;
}

// Returns a path to the evolution memory graph, or a fallback location that
// is guaranteed to be writable. Never returns null — when no evolver root is
// available, we fall back to `~/.evolver/memory/evolution/memory_graph.jsonl`
// so npm-global installs without a project-local evolver still capture
// outcomes (#536). Callers that need a "does the file already exist" check
// should use `fs.existsSync()` separately.
function findMemoryGraph(evolverRoot) {
  if (process.env.MEMORY_GRAPH_PATH) {
    return process.env.MEMORY_GRAPH_PATH;
  }
  if (evolverRoot) {
    const lower = path.join(evolverRoot, 'memory', 'evolution', 'memory_graph.jsonl');
    if (fs.existsSync(lower)) return lower;
    const upper = path.join(evolverRoot, 'MEMORY', 'evolution', 'memory_graph.jsonl');
    if (fs.existsSync(upper)) return upper;
    // Neither exists yet — prefer lowercase under the evolver root if the
    // root itself is writable (dev/local install case).
    try {
      fs.accessSync(evolverRoot, fs.constants.W_OK);
      const dir = path.dirname(lower);
      try { fs.mkdirSync(dir, { recursive: true }); } catch { /* fall through */ }
      return lower;
    } catch { /* not writable, fall through to user-level */ }
  }

  // User-level fallback. Always writable, consistent across platforms.
  const userDir = path.join(os.homedir(), '.evolver', 'memory', 'evolution');
  try { fs.mkdirSync(userDir, { recursive: true }); } catch { /* best-effort */ }
  return path.join(userDir, 'memory_graph.jsonl');
}

module.exports = { findEvolverRoot, findMemoryGraph };
