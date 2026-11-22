/* reviewFilters.js — name search, size and type filters and Shift-click ranges for the
   Review page. Plain functions with no page state, so they can be unit tested. */

const ReviewFilters = (() => {
  function baseName(p) { return String(p || '').split(/[\\/]/).pop(); }

  // jpeg and jpg are one type to the person filtering
  function extOf(path) {
    const name = baseName(path);
    const dot = name.lastIndexOf('.');
    if (dot <= 0) return '';
    const ext = name.slice(dot + 1).toLowerCase();
    return ext === 'jpeg' ? 'jpg' : ext;
  }

  // Plain text: a part of the file name. * and ? work as wildcards, still anywhere in the name.
  function nameMatches(path, query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    const name = baseName(path).toLowerCase();
    if (!/[*?]/.test(q)) return name.includes(q);
    const re = q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(re).test(name);
  }

  function emptyFilters() {
    return { name: '', sizeMin: null, sizeMax: null, sizeMode: 'any', types: new Set(), typeMode: 'any' };
  }

  function isActive(f) {
    return !!(String(f.name || '').trim() || f.sizeMin != null || f.sizeMax != null || f.types.size);
  }

  function sizeIn(file, f) {
    const s = file.size || 0;
    if (f.sizeMin != null && s < f.sizeMin) return false;
    if (f.sizeMax != null && s > f.sizeMax) return false;
    return true;
  }

  // files: the group's files ({ path, size }). A group must pass every filter that is set.
  function groupPasses(files, f) {
    if (String(f.name || '').trim() && !files.some(x => nameMatches(x.path, f.name))) return false;
    if (f.sizeMin != null || f.sizeMax != null) {
      const ok = f.sizeMode === 'all' ? files.every(x => sizeIn(x, f)) : files.some(x => sizeIn(x, f));
      if (!ok) return false;
    }
    if (f.types.size) {
      const hit = x => f.types.has(extOf(x.path));
      const ok = f.typeMode === 'all' ? files.every(hit) : files.some(hit);
      if (!ok) return false;
    }
    return true;
  }

  // [[type, count], ...] over every file in the result, most common first
  function typeCounts(groupsFiles) {
    const counts = new Map();
    for (const files of groupsFiles) for (const x of files) {
      const e = extOf(x.path) || '?';
      counts.set(e, (counts.get(e) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  function parseSize(value, unit) {
    const n = parseFloat(value);
    if (String(value).trim() === '' || isNaN(n) || n < 0) return null;
    return Math.round(n * (unit === 'MB' ? 1048576 : 1024));
  }

  // The items from anchor to clicked, inclusive, in list order; just the clicked one when the
  // anchor is unset or not in the list (filtered away, or on another page).
  function rangeBetween(list, anchor, clicked) {
    const a = anchor == null ? -1 : list.indexOf(anchor);
    const b = list.indexOf(clicked);
    if (b < 0) return [];
    if (a < 0) return [clicked];
    return list.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  return { extOf, nameMatches, emptyFilters, isActive, groupPasses, typeCounts, parseSize, rangeBetween };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReviewFilters;
