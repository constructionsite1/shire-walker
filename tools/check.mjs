/* ============================================================
   tools/check.mjs — the gate.

   Eight groups of checks, so a broken build fails loudly rather
   than quietly serving a white page. No dependencies: node only.
   Run with:  node tools/check.mjs
   ============================================================ */

import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve, relative, extname, basename, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
let group = '';
const fail = (msg) => problems.push(`[${group}] ${msg}`);

function startGroup(name) { group = name; }

const SCOPE = [
  'index.html', 'styles.css', 'README.md',
  'src/main.js', 'src/constants.js', 'src/noise.js', 'src/textures.js',
  'src/terrain.js', 'src/water.js', 'src/sky.js', 'src/vegetation.js',
  'src/buildings.js', 'src/locations.js', 'src/props.js', 'src/creatures.js',
  'src/player.js', 'src/audio.js', 'src/postfx.js', 'src/ui.js', 'src/save.js',
  'tools/check.mjs'
];

const BINARY_EXT = ['.glb', '.gltf', '.hdr', '.exr', '.png', '.jpg', '.jpeg', '.webp',
  '.mp3', '.ogg', '.wav', '.ttf', '.otf', '.woff', '.woff2', '.ktx2', '.bin', '.dds', '.mp4'];

const ALLOWED_ADDONS = new Set([
  'controls/PointerLockControls.js',
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/OutputPass.js',
  'shaders/CopyShader.js',
  'shaders/LuminosityHighPassShader.js',
  'shaders/FXAAShader.js',
  'math/ImprovedNoise.js'
]);

const THREE_URL = './vendor/three/build/three.module.js';
const ADDONS_URL = './vendor/three/examples/jsm/';

/* The files we keep a copy of, so the page never needs the network. */
const VENDORED = [
  'vendor/three/build/three.module.js',
  'vendor/three/examples/jsm/postprocessing/EffectComposer.js',
  'vendor/three/examples/jsm/postprocessing/Pass.js',
  'vendor/three/examples/jsm/postprocessing/RenderPass.js',
  'vendor/three/examples/jsm/postprocessing/ShaderPass.js',
  'vendor/three/examples/jsm/postprocessing/MaskPass.js',
  'vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js',
  'vendor/three/examples/jsm/postprocessing/OutputPass.js',
  'vendor/three/examples/jsm/shaders/CopyShader.js',
  'vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js',
  'vendor/three/examples/jsm/shaders/OutputShader.js',
  'vendor/three/examples/jsm/shaders/FXAAShader.js'
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === '.verify') continue;
    // three.js is vendored verbatim under vendor/; it is not our code
    // to lint, scope or silence, so the build's own eyes skip it
    if (name === 'vendor') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(/[\\/]/).join(posix.sep);

/* ------------------------------------------------------------
   1. Every module parses
   ------------------------------------------------------------ */
startGroup('syntax');
const allFiles = walk(ROOT);
const jsFiles = allFiles.filter(f => extname(f) === '.js' || extname(f) === '.mjs');
/* `node --check` on a bare .js file does not reliably parse it as an
   ES module, and will happily wave through a duplicate `let`. So we
   check a .mjs copy: identical bytes, unambiguous goal. */
const scratch = mkdtempSync(join(tmpdir(), 'shire-check-'));
let n = 0;
for (const f of jsFiles) {
  const asModule = join(scratch, `m${n++}.mjs`);
  writeFileSync(asModule, readFileSync(f));
  try {
    execFileSync(process.execPath, ['--check', asModule], { stdio: 'pipe' });
  } catch (e) {
    const msg = (e.stderr || '').toString().split('\n').slice(0, 8).join('\n');
    fail(`${rel(f)} does not parse:\n${msg}`);
  }
}
rmSync(scratch, { recursive: true, force: true });
if (!jsFiles.length) fail('no JavaScript found');

/* ------------------------------------------------------------
   2. The import map pins three@0.169.0 from unpkg
   ------------------------------------------------------------ */
startGroup('importmap');
const htmlPath = join(ROOT, 'index.html');
if (!existsSync(htmlPath)) {
  fail('index.html is missing');
} else {
  const html = readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) {
    fail('no import map found in index.html');
  } else {
    let map = null;
    try { map = JSON.parse(m[1]); } catch (e) { fail(`import map is not valid JSON: ${e.message}`); }
    if (map) {
      const imports = map.imports || {};
      if (imports.three !== THREE_URL) fail(`"three" must map to ${THREE_URL}, got ${imports.three}`);
      if (imports['three/addons/'] !== ADDONS_URL) {
        fail(`"three/addons/" must map to ${ADDONS_URL}, got ${imports['three/addons/']}`);
      }
      for (const k of Object.keys(imports)) {
        if (k !== 'three' && k !== 'three/addons/') fail(`unexpected import map key "${k}"`);
      }
      // and the county fetches nothing at runtime from anyone else
      const html = readFileSync(htmlPath, 'utf8');
      for (const u of html.matchAll(/https?:\/\/[^"'\s)]+/g)) {
        if (!/^https?:\/\/(www\.)?(w3\.org|github\.com|constructionsite1)/.test(u[0])) {
          fail(`index.html reaches out to ${u[0]} at runtime; the county should be self-contained`);
        }
      }
    }
  }
}

/* ------------------------------------------------------------
   2b. three.js is vendored, and actually there. A build that
   depends on a CDN is a build whose visitors wait on somebody
   else's server, and whose addons can change under it.
   ------------------------------------------------------------ */
startGroup('vendored');
for (const f of VENDORED) {
  if (!existsSync(join(ROOT, f))) fail(`vendored file missing: ${f}`);
}

/* ------------------------------------------------------------
   3. Relative imports resolve
   ------------------------------------------------------------ */
startGroup('relative-imports');
const IMPORT_RE = /(?:^|[\s;{}()=])(?:import|export)\s+(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let hit;
    while ((hit = re.exec(src)) !== null) {
      const spec = hit[1];
      if (!spec.startsWith('.')) continue;
      if (!spec.endsWith('.js')) fail(`${rel(f)} imports "${spec}" without a .js extension`);
      const target = resolve(dirname(f), spec);
      if (!existsSync(target)) fail(`${rel(f)} imports "${spec}" which does not exist`);
    }
  }
}

/* ------------------------------------------------------------
   4. Bare imports are only three, and only allowed addons
   ------------------------------------------------------------ */
startGroup('bare-imports');
for (const f of jsFiles) {
  if (rel(f) === 'tools/check.mjs') continue;
  const src = readFileSync(f, 'utf8');
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let hit;
    while ((hit = re.exec(src)) !== null) {
      const spec = hit[1];
      if (spec.startsWith('.') || spec.startsWith('/')) continue;
      if (spec === 'three') continue;
      if (spec.startsWith('three/addons/')) {
        const sub = spec.slice('three/addons/'.length);
        if (!ALLOWED_ADDONS.has(sub)) {
          fail(`${rel(f)} imports "${spec}" which is not on the allowed list`);
        }
        continue;
      }
      fail(`${rel(f)} imports "${spec}"; only "three" and "three/addons/..." are allowed`);
    }
  }
}

/* ------------------------------------------------------------
   5. index.html is wired up
   ------------------------------------------------------------ */
startGroup('html');
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, 'utf8');
  if (!/<canvas[^>]*id=["']scene["']/i.test(html)) fail('index.html has no <canvas id="scene">');
  if (!/<link[^>]*rel=["']stylesheet["'][^>]*href=["']styles\.css["']/i.test(html)) {
    fail('index.html does not link styles.css');
  }
  if (!/<script[^>]*type=["']module["'][^>]*src=["']src\/main\.js["']/i.test(html)) {
    fail('index.html does not load src/main.js as a module');
  }
  if (!/viewport/i.test(html)) fail('index.html has no viewport meta tag');
}

/* ------------------------------------------------------------
   6. No binary assets on disk
   ------------------------------------------------------------ */
startGroup('no-binaries');
for (const f of allFiles) {
  const e = extname(f).toLowerCase();
  if (BINARY_EXT.includes(e)) fail(`${rel(f)} is a binary asset; the Shire ships no files`);
}

/* ------------------------------------------------------------
   7. No binary assets referenced
   ------------------------------------------------------------ */
startGroup('no-binary-refs');
const REF_RE = new RegExp(`["'\`]([^"'\`\\s]*\\.(?:${BINARY_EXT.map(x => x.slice(1)).join('|')}))(?=["'\`?#])`, 'gi');
for (const f of allFiles) {
  if (extname(f) === '.png' || extname(f) === '.jpg') continue;
  // the checker itself names every extension, so it is not evidence
  if (rel(f) === 'tools/check.mjs') continue;
  const src = readFileSync(f, 'utf8');
  REF_RE.lastIndex = 0;
  let hit;
  while ((hit = REF_RE.exec(src)) !== null) {
    if (/^data:/i.test(hit[1])) continue;
    fail(`${rel(f)} references the asset "${hit[1]}"`);
  }
}

/* ------------------------------------------------------------
   8. Scope, and every file is non-empty
   ------------------------------------------------------------ */
startGroup('scope');
for (const f of SCOPE) {
  const p = join(ROOT, f);
  if (!existsSync(p)) { fail(`missing required file ${f}`); continue; }
  if (statSync(p).size === 0) fail(`${f} is empty`);
}
const allowed = new Set(SCOPE.map(s => s.toLowerCase()));
allowed.add('.gitignore');
for (const f of allFiles) {
  const r = rel(f);
  if (r.startsWith('.git/')) continue;
  if (!allowed.has(r.toLowerCase())) {
    fail(`${r} is outside the declared scope of the build`);
  }
}

/* ------------------------------------------------------------
   Also worth knowing: a stray `console.log` in the render loop
   ------------------------------------------------------------ */
startGroup('hygiene');
for (const f of jsFiles) {
  const src = readFileSync(f, 'utf8');
  const logs = src.match(/console\.(log|debug|table)\s*\(/g);
  if (logs && logs.length > 3) {
    fail(`${rel(f)} has ${logs.length} console.log calls; keep the console quiet`);
  }
}

/* ------------------------------------------------------------ */
if (problems.length) {
  console.error(`\n${problems.length} problem${problems.length > 1 ? 's' : ''} found:\n`);
  for (const p of problems) console.error('  - ' + p);
  console.error('');
  process.exit(1);
}
console.log('CHECKS PASSED');
process.exit(0);
