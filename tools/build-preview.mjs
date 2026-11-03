// Baut eine einzelne HTML-Datei (alles eingebettet) für die Vorschau als Claude-Artifact.
//   node tools/build-preview.mjs [pfad/zur/data.json]
// Mit data.json werden die aufbereiteten Trainingsdaten als Startdaten eingebettet
// (ohne Profil, Zahlungen und Social-Posts). Ausgabe: dist/preview.html
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFile(join(root, p), 'utf8');
const between = (s, a, b) => s.slice(s.indexOf(a) + a.length, s.indexOf(b));

const index = await read('index.html');
const head = between(index, '<!-- HEAD:START -->', '<!-- HEAD:END -->')
  .replace(/<meta charset[^>]*>\s*/, '').replace(/<meta name="viewport"[^>]*>\s*/, '');
const body = between(index, '<!-- BODY:START -->', '<!-- BODY:END -->');
const css = await read('css/app.css');
const js = ['js/i18n.js', 'js/proc.js', 'js/unzip.js', 'js/app.js'];
const scripts = (await Promise.all(js.map(read))).map((s) => `<script>\n${s}\n</script>`).join('\n');

let seed = '';
const dataPath = process.argv[2];
if (dataPath) {
  const { processExport } = require(join(root, 'js/proc.js'));
  const model = processExport(JSON.parse(await readFile(dataPath, 'utf8')));
  seed = `<script type="application/json" id="seed">${JSON.stringify(model).replace(/<\//g, '<\\/')}</script>\n`;
  console.log(`Startdaten: ${model.s.w.length} Trainings eingebettet`);
}

const out = `${head.trim()}\n<style>\n${css}</style>\n${body.trim()}\n<script>window.TA_PREVIEW = true;</script>\n${seed}${scripts}\n`;
await mkdir(join(root, 'dist'), { recursive: true });
await writeFile(join(root, 'dist/preview.html'), out);
console.log(`dist/preview.html geschrieben (${(out.length / 1e6).toFixed(2)} MB)`);
