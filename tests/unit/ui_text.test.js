/**
 * Internal story / requirement codes (US-071, REQ-12 ...) belong in code
 * comments and docs, never in anything a person using the app can read.
 * This strips comments from the UI and the server routes (whose error
 * messages end up in toasts) and fails if a code is left in the rest.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CODE = /\b(?:US|REQ)-\d+/;

function filesIn(dir, exts) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return filesIn(p, exts);
    return exts.includes(path.extname(d.name)) ? [p] : [];
  });
}

function stripComments(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const files = [
  ...filesIn(path.join(ROOT, 'ui'), ['.js', '.html', '.css']),
  ...filesIn(path.join(ROOT, 'src', 'api'), ['.js']),
];

describe('No story codes in user-visible text', () => {
  test.each(files.map(f => [path.relative(ROOT, f), f]))('%s', (_rel, file) => {
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
    const hits = lines.map((l, i) => CODE.test(l) ? `line ${i + 1}: ${l.trim()}` : null).filter(Boolean);
    expect(hits).toEqual([]);
  });

  test('the check catches a code in a label', () => {
    expect(CODE.test(stripComments('<summary>Deselect filters (US-071)</summary>'))).toBe(true);
    expect(CODE.test(stripComments('/* US-071 */ // US-072\n<!-- US-073 -->'))).toBe(false);
  });
});
