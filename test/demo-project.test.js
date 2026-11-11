'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, buildSync } = require('esbuild');
const yaml = require('js-yaml');
const picomatch = require('picomatch');
const repo = path.resolve(__dirname, '..');
const root = path.join(repo, 'examples/demo-project');
// Bundle the real app resolver, including its normal Markdown dependencies, in memory.
const resolverModule = buildSync({ entryPoints: [path.join(repo, 'src/app/core/utils/wiki-links.utils.ts')], bundle: true, platform: 'node', format: 'esm', write: false }).outputFiles[0].text;
const resolver = import('data:text/javascript;base64,' + Buffer.from(resolverModule).toString('base64'));
const esm = file => import('data:text/javascript;base64,' + Buffer.from(buildSync({ entryPoints: [path.join(repo, file)], bundle: true, platform: 'node', format: 'esm', write: false }).outputFiles[0].text).toString('base64'));
// The app's own discovery and serialization rules, so the demo is checked the way the app reads it.
const characterPaths = esm('src/app/core/utils/character-path.utils.ts');
const castPinboard = esm('src/app/core/utils/cast-pinboard.utils.ts');
const promptFiles = esm('src/app/core/utils/prompt-file.utils.ts');
// PlotBoardService with Angular and its injected services stubbed (parseFile/generateFile are pure).
const plotBoardService = build({
  entryPoints: [path.join(repo, 'src/app/core/services/plot-board.service.ts')], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'error',
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /^@angular\// }, a => ({ path: a.path, namespace: 'stub' }));
    b.onResolve({ filter: /\.service$/ }, a => (a.importer.endsWith('plot-board.service.ts') ? { path: a.path, namespace: 'stub' } : undefined));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: 'export const Injectable = () => c => c; export class ElectronService {} export class ProjectService {} export class LoggingService {}' }));
  } }],
}).then(r => { const m = { exports: {} }; new Function('module', 'exports', 'require', r.outputFiles[0].text)(m, m.exports, require); return Object.create(m.exports.PlotBoardService.prototype); });
/** Files under `folder` whose name matches `glob`, as `readDirectoryRecursive` scans them (basename match, .ensemble-trash skipped). */
function scan(folder, glob) { const isMatch = picomatch(glob, { dot: true }); return files(path.join(root, folder)).filter(f => !f.includes('.ensemble-trash') && isMatch(path.basename(f))); }
const forbidden = ['StarCraft', 'Warcraft', 'Apple', 'Windows XP', 'Windows 95', 'Windows 11', 'Microsoft Windows', 'Microsoft', 'MS-DOS', 'MSDOS', 'Mac OS', 'Macintosh', 'Blizzard', 'Nintendo', 'Pokémon', 'Pokemon', 'Harry Potter', 'Dragon Ball', 'Disney', 'OpenAI', 'ChatGPT', 'Midjourney', 'Stable Diffusion'];
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function parse(file) {
  const raw = read(file), match = raw.match(/^---\n([\s\S]*?)\n---\n/);
  return { file, raw, fm: match ? yaml.load(match[1]) : {}, body: match ? raw.slice(match[0].length) : raw };
}
function ids(items, label) {
  const values = items.map(e => e.id);
  for (const id of values) assert.ok(typeof id === 'string' && id.trim(), `${label}: missing ID`);
  assert.equal(new Set(values).size, values.length, `${label}: duplicate IDs`);
  return new Set(values);
}
function references(values, valid, label) { assert.ok(Array.isArray(values), `${label}: expected list`); for (const value of values) assert.ok(valid.has(value), `${label}: dangling ID ${value}`); }
function image(ref, local) {
  assert.equal(typeof ref, 'string');
  const raw = ref.replace(/^\[\[([^|\]]+)(?:\|[^\]]*)?\]\]$/, '$1');
  const full = path.resolve(raw.includes('/') ? root : path.dirname(local), raw);
  assert.ok(full.startsWith(root + path.sep), `Image outside demo: ${ref}`);
  assert.ok(fs.existsSync(full), `Missing image: ${ref}`);
  assert.match(full, /\.(png|webp|jpe?g)$/i);
}

test('Lantern Coast demo has complete, resolvable canonical project data', async () => {
  const { resolveWikiLinkTarget } = await resolver;
  const { parseCharacterMainFileLocation } = await characterPaths;
  const { reconcileCastPinboard } = await castPinboard;
  const plotBoards = await plotBoardService;
  const all = files(root), markdown = all.filter(f => f.endsWith('.md')).map(parse);
  for (const file of all.filter(f => /\.(md|json)$/.test(f))) {
    const text = read(file);
    for (const brand of forbidden) assert.ok(!new RegExp(`\\b${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text), `${file}: forbidden brand ${brand}`);
    // Lowercase architectural windows in an illustration prompt are ordinary nouns.
    assert.doesNotMatch(text, /\bWindows\b/, `${file}: forbidden brand Windows`);
    assert.doesNotMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, `${file}: email address`);
  }
  const project = JSON.parse(read(path.join(root, 'ensemble.json')));
  assert.equal(read(path.join(root, 'ensemble.json')), JSON.stringify(project, null, 2), 'Canonical JSON serialization');
  assert.equal(project.projectName, 'The Lantern Coast');
  assert.equal(project.settings.theme, 'blue-gold'); assert.equal(project.settings.skin, 'classic');
  assert.deepEqual(project.settings.characterStyles, [{ id: 'default', name: 'Default' }]);
  assert.deepEqual(project.categories.map(c => c.id), ['main-character', 'supporting', 'antagonist', 'minor']);
  assert.equal(project.tags.length, 6); assert.equal(project.books.length, 2); assert.equal(project.series.length, 1);
  const bookIds = ids(project.books, 'books'), seriesIds = ids(project.series, 'series');
  const categoryIds = ids(project.categories, 'categories'), tagIds = ids(project.tags, 'tags');
  // Same discovery as CharacterService (`*.md` + main-file rule), LocationService (`_*.md`) and HouseService (`*.md` with `type: house`).
  const chars = scan('characters', '*.md').filter(f => parseCharacterMainFileLocation(path.relative(path.join(root, 'characters'), f).replaceAll(path.sep, '/'))).map(parse);
  const locations = scan('locations', '_*.md').map(parse);
  const houses = scan('houses', '*.md').map(parse).filter(m => m.fm.type === 'house');
  const active = chars.filter(m => !m.fm.lore && !m.file.includes('/@drafts/'));
  assert.equal(active.length, 10); assert.equal(chars.filter(m => m.fm.lore).length, 2); assert.equal(chars.filter(m => m.file.includes('/@drafts/')).length, 1);
  assert.equal(locations.length, 6, 'LocationService finds 6 locations (`_*.md` under locations/)'); assert.equal(houses.length, 2);
  assert.deepEqual(new Set(locations.map(m => m.fm.type)), new Set(['region', 'settlement', 'district', 'building', 'natural-feature', 'plane']));
  ids([...chars, ...locations, ...houses].map(m => m.fm), 'frontmatter');
  const charIds = new Set(chars.map(m => m.fm.id)), locIds = new Set(locations.map(m => m.fm.id));
  for (const m of [...active, ...locations]) references(m.fm.books, bookIds, m.file);
  for (const m of chars) {
    if (m.fm.books) references(m.fm.books, bookIds, m.file);
    for (const ref of Object.values(m.fm.thumbnails || {})) image(ref, m.file);
  }
  for (const m of active) {
    references([m.fm.category], categoryIds, m.file); references(m.fm.tags, tagIds, m.file);
    assert.ok(m.fm.thumbnails?.default, `${m.file}: missing portrait`);
    for (const ref of Object.values(m.fm.thumbnails || {})) image(ref, m.file);
    for (const [book, category] of Object.entries(m.fm.bookCategories || {})) { references([book], bookIds, m.file); references([category], categoryIds, m.file); }
    for (const [book, tags] of Object.entries(m.fm.bookTags || {})) { references([book], bookIds, m.file); references(tags, tagIds, m.file); }
    for (const [book, map] of Object.entries(m.fm.bookThumbnails || {})) { references([book], bookIds, m.file); for (const ref of Object.values(map)) { image(ref, m.file); assert.notEqual(ref, m.fm.thumbnails.default); } }
  }
  assert.ok(active.some(m => Array.isArray(m.fm.aliases))); assert.ok(active.some(m => typeof m.fm.aliases === 'string'));
  for (const field of ['bookCategories', 'bookTags', 'bookThumbnails']) assert.ok(active.some(m => Object.keys(m.fm[field] || {}).length), `Missing example: ${field}`);
  const withBookPages = active.filter(m => project.books.every(b => fs.existsSync(m.file.replace(/\.md$/, `.${b.code}.md`))));
  assert.ok(withBookPages.length >= 3);
  for (const m of locations) { assert.ok(m.fm.thumbnail); image(m.fm.thumbnail, m.file); }
  let joint = false, interrupted = false;
  for (const m of houses) {
    const h = m.fm; references(h.characterIds, charIds, m.file); references([h.seatId], locIds, m.file); image(h.thumbnail, m.file);
    const reignIds = ids(h.leadership, m.file); if (h.currentLeadershipId) references([h.currentLeadershipId], reignIds, m.file);
    const seen = new Set(); let prior = new Set();
    for (const reign of h.leadership) {
      references(reign.characterIds, new Set(h.characterIds), m.file); references(reign.books, bookIds, m.file);
      joint ||= reign.characterIds.length > 1;
      for (const id of reign.characterIds) { if (seen.has(id) && !prior.has(id)) interrupted = true; seen.add(id); }
      prior = new Set(reign.characterIds);
    }
  }
  assert.ok(joint && interrupted); assert.equal(houses.filter(m => m.fm.currentLeadershipId).length, 1);
  assert.ok(houses[0].fm.characterIds.some(id => houses[1].fm.characterIds.includes(id)));
  for (const b of project.books) { references(b.povCharacterIds, charIds, b.id); references([b.seriesId], seriesIds, b.id); if (b.plan) assert.ok(fs.existsSync(path.join(root, b.plan.path))); }
  assert.equal(project.books.find(b => b.id === 'lc1').status, 'published');
  assert.ok(!project.books.find(b => b.id === 'lc1').isbn);
  assert.equal(project.books.find(b => b.id === 'lc2').status, 'in-progress');
  const boardIds = ids(project.pinboards, 'pinboards'); assert.equal(project.pinboards.length, 2);
  references([project.lastSession.lastPinboardId], boardIds, 'lastSession');
  for (const board of project.pinboards) {
    references(board.nodes.map(n => n.id), charIds, board.id);
    const nodeIds = ids(board.nodes, board.id); ids(board.edges, board.id);
    for (const e of board.edges) { references([e.source, e.target], nodeIds, board.id); assert.ok(e.label && e.color); }
  }
  const castsJson = read(path.join(root, 'characters/casts/casts.json')), castIndex = JSON.parse(castsJson);
  assert.equal(castsJson, JSON.stringify(castIndex, null, 2), 'Canonical casts.json serialization');
  assert.equal(castIndex.version, 1); assert.equal(castIndex.casts.length, 2); ids(castIndex.casts, 'casts');
  const castFolders = fs.readdirSync(path.join(root, 'characters/casts'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(root, 'characters/casts', e.name));
  assert.equal(castFolders.length, castIndex.casts.length, 'One folder per cast');
  for (const cast of castIndex.casts) {
    references(cast.characterIds, charIds, cast.name); references([cast.pinboardId], boardIds, cast.name);
    const folder = castFolders.find(f => fs.existsSync(path.join(f, '.castid')) && read(path.join(f, '.castid')) === cast.id);
    assert.ok(folder, `${cast.name}: no folder with .castid ${cast.id}`); assert.ok(read(path.join(folder, 'description.md')).trim());
    // Opening must not rewrite the cast's pinboard (CastService.syncCastPinboard).
    const board = project.pinboards.find(b => b.id === cast.pinboardId);
    assert.equal(JSON.stringify(reconcileCastPinboard(cast, board)), JSON.stringify(board), `${cast.name}: pinboard differs from its cast; opening would rewrite it`);
  }
  // Opening must not create casts (CastService.migratePinboards turns every pinboard without a cast into one).
  for (const board of project.pinboards) assert.ok(castIndex.casts.some(c => c.pinboardId === board.id), `Pinboard ${board.id} has no cast; opening would create one`);
  const plot = parse(path.join(root, 'lantern-coast.pinboard.md'));
  // Exactly what PlotBoardService writes, so opening (id remap, autosave) never rewrites it.
  assert.equal(plot.raw, plotBoards.generateFile(plotBoards.parseFile(plot.raw)), 'Plot board is not in the form the app writes');
  assert.equal(plot.fm.threads.length, 3); assert.equal(plotBoards.parseFile(plot.raw).rows.length, 6); assert.ok(Object.keys(plot.fm.cellMeta).length >= 2);
  const threadIds = ids(plot.fm.threads, 'plot threads');
  for (const t of plot.fm.threads) references(t.characters, charIds, t.name);
  for (const [row, cells] of Object.entries(plot.fm.cellMeta)) { assert.ok(Number(row) < 6); references(Object.keys(cells), threadIds, 'cellMeta'); }
  assert.equal(plot.body.trim().split('\n').length, 8);
  const plan = read(path.join(root, 'books/lc2/lc2.plan.md'));
  assert.equal([...plan.matchAll(/^## \S+ - /gm)].length, 6);
  for (const pov of plan.matchAll(/^PoV:\s+(\S+)\s+(.+)$/gm)) { references([pov[1]], charIds, 'PoV'); assert.equal(chars.find(m => m.fm.id === pov[1]).fm.name, pov[2]); }
  assert.equal([...plan.matchAll(/^PoV:/gm)].length, 6); assert.match(plan, /^### /m); assert.match(plan, /TODO/);
  const collections = [['characters', chars.filter(m => !m.file.includes('/@drafts/'))], ['locations', locations], ['houses', houses]].map(([folder, records]) => ({folder, route: folder, singular: folder, targets: records.map(m => ({...m.fm, relativePath: path.relative(path.join(root, folder), m.file).replaceAll(path.sep, '/')}))}));
  for (const m of markdown) for (const match of m.body.matchAll(/(?<!!)\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g)) {
    assert.equal(resolveWikiLinkTarget(match[1], collections).state, 'resolved', `${path.relative(root, m.file)}: broken, ambiguous or alias-only link [[${match[1]}]]`);
  }
  // Unique aliases also resolve to their canonical records.
  for (const alias of ['Gull', 'The Lamplighter']) assert.equal(resolveWikiLinkTarget(alias, collections).state, 'resolved');
  assert.equal(all.filter(f => f.endsWith('.webp')).length, 19, 'Eleven portraits, six locations and two crests');
  const bytes = all.reduce((n, f) => n + fs.statSync(f).size, 0); assert.ok(bytes < 2.5 * 1024 * 1024, `Demo too large: ${bytes}`);
  assert.ok(!all.some(f => f.includes('.ensemble-trash')));
});

test('demo prompts use linked files without triggering character-frontmatter migration', async () => {
  const { parseCharacterMainFileLocation } = await characterPaths;
  const { parsePromptFile, serializePromptFile, promptVariants } = await promptFiles;
  // Include Lore and Drawer drafts: PromptService migrates all three collections on load.
  const chars = scan('characters', '*.md')
    .filter(f => parseCharacterMainFileLocation(path.relative(path.join(root, 'characters'), f).replaceAll(path.sep, '/')))
    .map(parse);
  for (const character of chars) {
    assert.ok(!Object.hasOwn(character.fm, 'prompts'), `${character.file}: legacy prompts would be migrated on opening`);
  }
  const project = JSON.parse(read(path.join(root, 'ensemble.json')));
  const prompts = scan(project.settings.promptsFolder || 'prompts', '*.md').map(file => {
    const raw = read(file), data = parsePromptFile(raw);
    assert.equal(serializePromptFile(data), raw, `${file}: prompt is not in the format the app writes`);
    references(data.characters, new Set(chars.map(c => c.fm.id)), file);
    references(data.locations, new Set(scan('locations', '_*.md').map(f => parse(f).fm.id)), file);
    return { file, data };
  });
  const mara = chars.find(c => c.fm.name === 'Mara Vell');
  const linked = prompts.filter(p => p.data.characters.includes(mara.fm.id));
  assert.equal(linked.length, 1, 'Mara retains one linked portrait prompt file');
  assert.equal(path.relative(root, linked[0].file).replaceAll(path.sep, '/'), 'prompts/characters/Mara Vell.md');
  assert.deepEqual(promptVariants(linked[0].data).map(({ name, prompt, negative }) => ({ name, prompt, negative })), [{
    name: 'Keeper portrait',
    prompt: 'Illustrated maritime fantasy keeper, blue coat, gold lantern, sea mist',
    negative: 'Text, logos, modern objects',
  }]);
});

test('electron-builder file filters exclude every demo file', () => {
  const { getFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const config = JSON.parse(read(path.join(repo, 'package.json'))).build;
  const matchers = getFileMatchers(config, 'files', '/tmp/ensemble-demo-package-filter', { defaultSrc: repo, globalOutDir: path.join(repo, 'release'), customBuildOptions: {}, macroExpander: value => value });
  for (const file of files(root)) {
    for (const matcher of matchers) assert.equal(matcher.createFilter()(file, fs.statSync(file)), false, `Packaged demo file: ${file}`);
  }
  // Guard against an accidentally vacuous check: real application files are included.
  assert.ok(matchers.some(m => m.createFilter()(path.join(repo, 'main.js'), fs.statSync(path.join(repo, 'main.js')))));
});
