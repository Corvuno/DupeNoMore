'use strict';
// Name search, size and type filters and Shift-click ranges on the Review page.
const RF = require('../../ui/js/reviewFilters');

const files = (...specs) => specs.map(([path, size]) => ({ path, size }));
const NONE = RF.emptyFilters();

describe('extOf', () => {
  test('lower-cased extension, jpeg counted as jpg', () => {
    expect(RF.extOf('C:\\a\\Photo.PNG')).toBe('png');
    expect(RF.extOf('/a/b.JPEG')).toBe('jpg');
    expect(RF.extOf('/a/noext')).toBe('');
    expect(RF.extOf('/a.dir/noext')).toBe('');
  });
});

describe('nameMatches', () => {
  test('plain text is a case-insensitive part of the file name', () => {
    expect(RF.nameMatches('C:\\x\\Holiday - Copy.jpg', 'copy')).toBe(true);
    expect(RF.nameMatches('C:\\x\\Holiday.jpg', 'copy')).toBe(false);
  });
  test('only the file name counts, not its folder', () => {
    expect(RF.nameMatches('C:\\Copy\\Holiday.jpg', 'copy')).toBe(false);
  });
  test('* and ? wildcards, anywhere in the name', () => {
    expect(RF.nameMatches('/a/IMG_1234 (2).jpg', 'img_*(?)')).toBe(true);
    expect(RF.nameMatches('/a/IMG_1234.jpg', 'img_*(?)')).toBe(false);
    expect(RF.nameMatches('/a/x.png', '*.png')).toBe(true);
  });
  test('empty search matches everything', () => {
    expect(RF.nameMatches('/a/x.png', '  ')).toBe(true);
  });
});

describe('groupPasses', () => {
  const g = files(['/a/big.jpg', 5000], ['/a/small - Copy.png', 100]);

  test('no filters: every group passes', () => {
    expect(RF.groupPasses(g, NONE)).toBe(true);
  });
  test('name search: a group passes when one of its files matches', () => {
    expect(RF.groupPasses(g, { ...NONE, name: 'copy' })).toBe(true);
    expect(RF.groupPasses(g, { ...NONE, name: 'nothere' })).toBe(false);
  });
  test('size, any file in range', () => {
    expect(RF.groupPasses(g, { ...NONE, sizeMax: 200, sizeMode: 'any' })).toBe(true);
    expect(RF.groupPasses(g, { ...NONE, sizeMax: 50, sizeMode: 'any' })).toBe(false);
  });
  test('size, every file in range', () => {
    expect(RF.groupPasses(g, { ...NONE, sizeMax: 200, sizeMode: 'all' })).toBe(false);
    expect(RF.groupPasses(g, { ...NONE, sizeMin: 50, sizeMode: 'all' })).toBe(true);
  });
  test('type, any file of a picked type', () => {
    expect(RF.groupPasses(g, { ...NONE, types: new Set(['png']), typeMode: 'any' })).toBe(true);
    expect(RF.groupPasses(g, { ...NONE, types: new Set(['webp']), typeMode: 'any' })).toBe(false);
  });
  test('type, every file of a picked type', () => {
    expect(RF.groupPasses(g, { ...NONE, types: new Set(['png']), typeMode: 'all' })).toBe(false);
    expect(RF.groupPasses(g, { ...NONE, types: new Set(['png', 'jpg']), typeMode: 'all' })).toBe(true);
  });
  test('filters combine: a group must pass all of them', () => {
    expect(RF.groupPasses(g, { ...NONE, name: 'copy', types: new Set(['webp']) })).toBe(false);
  });
});

describe('typeCounts', () => {
  test('counts files per type, most common first', () => {
    const groups = [files(['/a.jpg'], ['/b.jpeg'], ['/c.png']), files(['/d.jpg'])];
    expect(RF.typeCounts(groups)).toEqual([['jpg', 3], ['png', 1]]);
  });
});

describe('parseSize', () => {
  test('turns the box value and unit into bytes; blank is no limit', () => {
    expect(RF.parseSize('2', 'MB')).toBe(2 * 1048576);
    expect(RF.parseSize('50', 'KB')).toBe(50 * 1024);
    expect(RF.parseSize('', 'KB')).toBe(null);
    expect(RF.parseSize('abc', 'KB')).toBe(null);
  });
});

describe('rangeBetween', () => {
  const list = ['a', 'b', 'c', 'd', 'e'];
  test('everything from the anchor to the clicked item, either direction', () => {
    expect(RF.rangeBetween(list, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(RF.rangeBetween(list, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });
  test('no anchor, or the anchor is no longer shown: only the clicked item', () => {
    expect(RF.rangeBetween(list, null, 'c')).toEqual(['c']);
    expect(RF.rangeBetween(list, 'zz', 'c')).toEqual(['c']);
  });
});
