import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDevLog, needsReleaseNote, parseDevLog } from './check-devlog.mjs';

const LOG = 'hypersnap/src/lib/devLog.ts';
const ZERO = '0'.repeat(40);
const URL_PREFIX = 'https://github.com/arcacomputer/opencaster/commit/';
const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function repository() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'arca-devlog-guard-')); directories.push(cwd);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, 'no-global-config'), GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_CONFIG_COUNT']) delete env[name];
  const git = (...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--initial-branch=main'); git('config', 'user.name', 'Isolated Dev Log Test'); git('config', 'user.email', 'devlog-test@example.invalid'); git('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(cwd, '.git', 'isolated-empty-hooks')); git('config', 'core.hooksPath', path.join(cwd, '.git', 'isolated-empty-hooks'));
  const write = (file, contents) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), contents); };
  const commit = (message, date = '2026-10-19T12:00:00-03:00') => {
    git('add', '--all');
    execFileSync('git', ['commit', '--quiet', '-m', message], { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, stdio: ['ignore', 'pipe', 'pipe'] });
    return git('rev-parse', 'HEAD');
  };
  const log = entries => write(LOG, `export const DEV_LOG = ${JSON.stringify(entries, null, 2)};\n`);
  return { cwd, git, write, commit, log };
}
function milestone(id, commit, date = '2026-10-19') {
  return { id, date, title: `Milestone ${id}`, summary: `Public progress for ${id}.`, changes: ['A concrete isolated test improvement.'], commit: `${URL_PREFIX}${commit}`, tag: 'Reliability' };
}
function seeded() {
  const repo = repository(); repo.write('hypersnap/src/App.tsx', 'export const version = 1;\n');
  const source = repo.commit('Initial synthetic implementation');
  const old = [milestone('original-detail', source), milestone('original-launch', source)];
  repo.log(old); const base = repo.commit('Record original public history');
  return { ...repo, source, old, base };
}
function productChange(repo, file = 'hypersnap/src/App.tsx') {
  repo.write(file, 'export const version = 2;\n'); return repo.commit('Implement isolated product improvement', '2026-10-20T08:00:00-03:00');
}
function recordedRelease(repo, entries, source = productChange(repo)) {
  const note = milestone('new-release', source, '2026-10-20');
  repo.log(entries ?? [note, ...repo.old]); const head = repo.commit('Document the implemented release', '2026-10-20T09:00:00-03:00');
  return { head, note, source };
}

describe('release-note guard against real isolated Git history', () => {
  it('rejects a product change without an added milestone, including edits or same-day reordering of old notes', () => {
    const repo = seeded(); productChange(repo);
    for (const notes of [repo.old, [{ ...repo.old[0], title: 'Corrected old title' }, repo.old[1]], [...repo.old].reverse()]) {
      repo.log(notes);
      expect(() => checkDevLog({ base: repo.base, cwd: repo.cwd })).toThrow('without a new dev log milestone');
    }
  });

  it('accepts a new note pointing to a verified ancestor implementation and permits old-note corrections alongside it', () => {
    const repo = seeded(); const source = productChange(repo);
    const note = milestone('new-release', source, '2026-10-20');
    const release = recordedRelease(repo, [note, { ...repo.old[0], title: 'A factual correction' }, repo.old[1]], source);
    const result = checkDevLog({ base: repo.base, head: release.head, cwd: repo.cwd });
    expect(result).toMatchObject({ baseSha: repo.base, headSha: release.head, productFiles: ['hypersnap/src/App.tsx'], addedIds: ['new-release'] });
  });

  it('checks a transferred release against historical owner URLs and permits canonical source links without losing milestones', () => {
    const repo = seeded();
    repo.log(repo.old.map((note, index) => ({ ...note, commit: note.commit.replace('/arcacomputer/opencaster/', index ? '/arcabotai/hypersnap-web/' : '/arcabotai/opencaster/') })));
    const historicalBase = repo.commit('Preserve the previous owner’s published source links');
    const release = recordedRelease(repo);
    expect(checkDevLog({ base: historicalBase, head: release.head, cwd: repo.cwd })).toMatchObject({ productFiles: ['hypersnap/src/App.tsx'], addedIds: ['new-release'] });
  });

  it.each(['nonexistent', 'nonancestor', 'wrong-date'])('rejects a new milestone whose source is %s', failure => {
    const repo = seeded(); let reference;
    if (failure === 'nonancestor') {
      repo.git('checkout', '-b', 'unrelated-source'); repo.write('hypersnap/src/other.ts', 'export const unrelated = true;'); reference = repo.commit('Unrelated branch implementation', '2026-10-20T07:00:00-03:00'); repo.git('checkout', 'main');
    }
    const source = productChange(repo); const note = milestone('new-release', failure === 'nonexistent' ? 'f'.repeat(40) : reference ?? source, failure === 'wrong-date' ? '2026-10-21' : '2026-10-20');
    repo.log([note, ...repo.old]); const head = repo.commit('Add unverified source note', '2026-10-21T09:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toThrow('existing implementation commit in this history');
  });

  it('rejects deleting either an old milestone or the entire public history', () => {
    const repo = seeded(); const source = productChange(repo); repo.log([milestone('new-release', source, '2026-10-20'), repo.old[0]]);
    const head = repo.commit('Incorrectly drop an existing note', '2026-10-20T09:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toThrow('Preserve existing');
    rmSync(path.join(repo.cwd, LOG)); const removed = repo.commit('Incorrectly remove public log', '2026-10-20T10:00:00-03:00');
    expect(() => checkDevLog({ base: repo.base, head: removed, cwd: repo.cwd })).toThrow('must not be removed');
  });

  it('allows docs, test, fixture, license and development E2E changes without inventing a product milestone', () => {
    const repo = seeded();
    for (const file of ['hypersnap/README.md', 'hypersnap/src/Example.test.tsx', 'hypersnap/scripts/e2e-fixture.mjs', 'hypersnap/licenses/NOTICE.txt', 'hypersnap/src/lib/protocol/message-golden.json']) repo.write(file, 'isolated development material');
    repo.log([{ ...repo.old[0], summary: 'Correct an old typo without claiming a release.' }, repo.old[1]]);
    const head = repo.commit('Development-only edits');
    expect(checkDevLog({ base: repo.base, head, cwd: repo.cwd })).toMatchObject({ productFiles: [], addedIds: [] });
  });

  it('catches untracked shipped files in working-tree mode', () => {
    const repo = seeded(); repo.write('hypersnap/worker/untracked-runtime.ts', 'export const handler = true;');
    expect(() => checkDevLog({ base: repo.base, cwd: repo.cwd })).toThrow('hypersnap/worker/untracked-runtime.ts');
  });

  it('checks only the named head when dirty and untracked working-tree files disagree with it', () => {
    const repo = seeded(); const release = recordedRelease(repo);
    repo.write('hypersnap/src/App.tsx', 'uncommitted product version'); repo.write('hypersnap/worker/untracked.ts', 'untracked product code'); repo.write(LOG, 'this dirty dev log is not valid data');
    expect(checkDevLog({ base: repo.base, head: release.head, cwd: repo.cwd })).toMatchObject({ productFiles: ['hypersnap/src/App.tsx'], addedIds: ['new-release'] });
  });

  it('fails closed when the requested base revision has not been fetched', () => {
    const repo = seeded(); expect(() => checkDevLog({ base: 'refs/heads/not-fetched', head: repo.base, cwd: repo.cwd })).toThrow('Fetch the base and full history');
  });

  it('uses the merge base so a target branch’s unrelated note is neither required nor counted as a feature note', () => {
    const repo = seeded(); repo.git('branch', 'feature');
    const targetSource = productChange(repo, 'hypersnap/src/target-only.ts'); repo.log([milestone('target-only-release', targetSource, '2026-10-20'), ...repo.old]); const target = repo.commit('Target branch release', '2026-10-20T09:00:00-03:00');
    repo.git('checkout', 'feature'); const source = productChange(repo, 'hypersnap/src/feature-only.ts');
    expect(() => checkDevLog({ base: target, head: source, mergeBase: true, cwd: repo.cwd })).toThrow('without a new dev log milestone');
    const note = milestone('feature-release', source, '2026-10-20'); repo.log([note, ...repo.old]); const head = repo.commit('Feature release note', '2026-10-20T10:00:00-03:00');
    expect(checkDevLog({ base: target, head, mergeBase: true, cwd: repo.cwd })).toMatchObject({ baseSha: repo.base, productFiles: ['hypersnap/src/feature-only.ts'], addedIds: ['feature-release'] });
  });

  it.each([true, false])('bootstraps an initial zero-SHA push without relying on an empty-tree object (explicit head: %s)', explicit => {
    const repo = seeded();
    const result = checkDevLog({ base: ZERO, ...(explicit ? { head: repo.base } : {}), cwd: repo.cwd });
    expect(result.productFiles).toEqual(['hypersnap/src/App.tsx']); expect(result.addedIds).toEqual(repo.old.map(note => note.id));
  });
});

describe('release policy and static data validation', () => {
  it('accepts the organization’s repository and exact historical source URLs while rejecting other owners, repos and lookalikes', () => {
    const current = milestone('organization-release', 'a'.repeat(40));
    const renamed = { ...current, id: 'renamed-release', commit: current.commit.replace('/arcacomputer/', '/arcabotai/') };
    const original = { ...current, id: 'original-release', commit: current.commit.replace('/arcacomputer/opencaster/', '/arcabotai/hypersnap-web/') };
    expect(parseDevLog(`export const DEV_LOG = ${JSON.stringify([current, renamed, original])};`)).toEqual([current, renamed, original]);
    for (const commit of [current.commit.replace('/arcacomputer/', '/someone-else/'), current.commit.replace('/opencaster/', '/other/'), current.commit.replace('/opencaster/', '/hypersnap-web/'), renamed.commit.replace('/opencaster/', '/other/'), current.commit.replace('github.com/', 'github.com.evil.invalid/'), current.commit.replace('/arcacomputer/', '/arcacomputer-evil/')]) {
      expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([{ ...current, commit }])};`)).toThrow('implementation commit URL');
    }
  });

  it('requires a note for shipped dependencies, styles, workers, signer code, assets, build scripts and unknown product paths', () => {
    const paths = ['hypersnap/package.json', 'hypersnap/yarn.lock', 'hypersnap/src/App.tsx', 'hypersnap/src/style.scss', 'hypersnap/worker/index.ts', 'hypersnap/signer/main.ts', 'hypersnap/public/quorum-symbol.svg', 'hypersnap/public/InterVariable.ttf', 'hypersnap/scripts/build-signer.mjs', 'hypersnap/wrangler.toml', 'hypersnap/vite.config.ts', 'hypersnap/unknown-runtime.config', 'hypersnap/scripts/e2e-helpers/runtime.mjs'];
    expect(paths.filter(needsReleaseNote)).toEqual(paths);
  });
  it('exempts only development/docs/license paths and the dev-log data itself', () => {
    const paths = ['src/App.tsx', 'package.json', LOG, 'hypersnap/AGENTS.md', 'hypersnap/README.md', 'hypersnap/licenses/LICENSE.md', 'hypersnap/public/licenses/NOTICE.txt', 'hypersnap/public/THIRD_PARTY_DEPENDENCY_LICENSES.txt', 'hypersnap/src/Example.test.tsx', 'hypersnap/worker/index.spec.ts', 'hypersnap/signer/approve.test.ts', 'hypersnap/scripts/check-devlog.test.mjs', 'hypersnap/scripts/check-devlog.mjs', 'hypersnap/scripts/e2e-feature-checks.ts', 'hypersnap/src/lib/protocol/keyadd-golden.json'];
    expect(paths.filter(needsReleaseNote)).toEqual([]);
  });
  it('reads literal data without evaluating expressions, spread properties or computed keys', () => {
    const note = milestone('release', 'a'.repeat(40)); const encoded = JSON.stringify(note);
    expect(parseDevLog(`export const DEV_LOG = [${encoded}];`)).toEqual([note]);
    for (const source of [`export const DEV_LOG = (() => { throw new Error('executed'); })();`, `export const DEV_LOG = [{ ...${encoded} }];`, `export const DEV_LOG = [{ ['id']: 'release' }];`, `export const DEV_LOG = [${encoded}].map(entry => entry);`]) expect(() => parseDevLog(source)).toThrow(/literal/);
  });
  it('rejects duplicate milestone IDs, invalid calendar dates and newest-first ordering errors', () => {
    const first = milestone('first', 'a'.repeat(40), '2026-10-20'); const second = milestone('second', 'b'.repeat(40), '2026-10-19');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([first, first])};`)).toThrow('unique');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([{ ...first, date: '2026-02-30' }])};`)).toThrow('Invalid milestone date');
    expect(() => parseDevLog(`export const DEV_LOG = ${JSON.stringify([second, first])};`)).toThrow('ordered newest first');
  });
});
