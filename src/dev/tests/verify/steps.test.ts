import { afterEach, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ESLint } from 'eslint';
import { stepsFor } from '../../../../scripts/verify/steps.mjs';
import { runStep } from '../../../../scripts/verify/runner.mjs';
import { verdictOf } from '../../../../scripts/verify/report.mjs';
import { branchBaseRef, changedPaths, planFromPaths, resolveSharedRepo } from '../../../../scripts/verify/routing.mjs';

const fixtureRoots: string[] = [];
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function childGateFixture(exitCode: number) {
  // A root script that always fails catches accidentally invoking the parent
  // gate again. Real Yarn and a tiny child script exercise cwd/script dispatch
  // without loading either application or touching any network/account state.
  const root = mkdtempSync(join(tmpdir(), 'opencaster verify '));
  fixtureRoots.push(root);
  const child = join(root, 'hypersnap');
  mkdirSync(child);
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    private: true,
    scripts: { verify: 'node -e "process.exit(91)"' },
  }));
  writeFileSync(join(child, 'package.json'), JSON.stringify({
    private: true,
    scripts: { verify: 'node verify.cjs' },
  }));
  writeFileSync(join(child, 'verify.cjs'), `
    if (process.cwd() !== __dirname) process.exit(92);
    process.exit(${exitCode});
  `);
  return { root, child };
}

function repositoryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'opencaster comparison '));
  fixtureRoots.push(root);
  const hooks = join(root, 'no-hooks');
  mkdirSync(hooks);
  const git = (args: string[]) => execFileSync('git', [
    '-c', `core.hooksPath=${hooks}`, '-c', 'user.name=Verification fixture',
    '-c', 'user.email=verify@example.invalid', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--initial-branch=main']);
  const execGit = (_cwd: string, args: string[]) => {
    try { return git(args); } catch { return null; }
  };
  return { root, git, execGit };
}

describe('standalone Hypersnap gate integration', () => {
  it('checks pinned dependencies before running application checks', () => {
    const fixture = resolve('/fixture');
    expect(stepsFor('desktop', fixture, 'fast')[0]).toMatchObject({
      id: 'desktop:dependencies', cmd: 'yarn', args: ['setup:verify', '--check'], cwd: fixture,
    });
  });

  it('runs the existing child gate from its package directory', async () => {
    const { root, child } = childGateFixture(0);
    const steps = stepsFor('desktop', root, 'fast');
    const childStep = steps.find((step: { id: string }) => step.id === 'desktop:hypersnap');
    expect(childStep).toMatchObject({
      label: 'hypersnap', repo: 'desktop', tier: 'fast',
      cmd: 'yarn', args: ['verify'], cwd: child,
    });
    expect(steps.filter((step: { id: string }) => step.id === 'desktop:hypersnap')).toHaveLength(1);
    expect((await runStep(childStep)).status).toBe('PASS');
  });

  it('fails the parent verdict when the child gate fails', async () => {
    const { root } = childGateFixture(17);
    const childStep = stepsFor('desktop', root, 'fast')
      .find((step: { id: string }) => step.id === 'desktop:hypersnap');
    const result = await runStep(childStep);
    expect(result.status).toBe('FAIL');
    expect(verdictOf([result], { repos: ['desktop'], live: false, skipped: [] })).toBe('FAIL');
  });
});

describe('installed shared repository discovery', () => {
  it('follows the installed source checkout rather than a different sibling', () => {
    const desktop = resolve('/fixture/desktop');
    const installed = join(desktop, '.quorum-deps/quorum-shared');
    expect(resolveSharedRepo(desktop, installed, () => `${installed}\n`)).toBe(installed);
  });

  it('preserves an explicit sibling-root override even when the dependency is installed', () => {
    const override = resolve('/fixture/override');
    expect(resolveSharedRepo('/fixture/desktop', '/fixture/installed', () => {
      throw new Error('An explicit override must not inspect the installed checkout');
    }, override)).toBe(join(override, 'quorum-shared'));
  });

  it('does not treat a published package inside desktop as its own Git checkout', () => {
    const desktop = resolve('/fixture/desktop');
    const execGit = (_cwd: string, args: string[]) => args.includes('--show-toplevel') ? desktop : '.git\n';
    expect(resolveSharedRepo(desktop, join(desktop, 'node_modules/@quilibrium/quorum-shared'), execGit))
      .toBe(resolve('/fixture/quorum-shared'));
  });

  it('keeps the sibling fallback when the installed source cannot be resolved', () => {
    const desktop = resolve('/fixture/desktop');
    expect(resolveSharedRepo(desktop, null, () => '.git\n')).toBe(resolve('/fixture/quorum-shared'));
    expect(resolveSharedRepo(desktop, '/fixture/unreadable', () => null)).toBe(resolve('/fixture/quorum-shared'));
  });
});

describe('pinned dependency comparison baseline', () => {
  it('detects committed and dirty shared changes after local main advances', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencaster baseline '));
    fixtureRoots.push(root);
    const hooks = join(root, 'no-hooks');
    mkdirSync(hooks);
    const git = (args: string[]) => execFileSync('git', [
      '-c', `core.hooksPath=${hooks}`, '-c', 'user.name=Verification fixture',
      '-c', 'user.email=verify@example.invalid', '-c', 'commit.gpgsign=false', ...args,
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(['init', '--initial-branch=main']);
    writeFileSync(join(root, 'baseline.ts'), 'export const baseline = 1;\n');
    git(['add', 'baseline.ts']);
    git(['commit', '-m', 'Fixture baseline']);
    const baseline = git(['rev-parse', 'HEAD']);
    git(['update-ref', 'refs/verify/dependency-base', baseline]);
    writeFileSync(join(root, 'committed.ts'), 'export const added = true;\n');
    git(['add', 'committed.ts']);
    git(['commit', '-m', 'Fixture committed change']);
    writeFileSync(join(root, 'baseline.ts'), 'export const baseline = 2;\n');
    const execGit = (_cwd: string, args: string[]) => {
      try { return git(args); } catch { return null; }
    };
    expect(branchBaseRef(root, execGit)).toBe('refs/verify/dependency-base');
    expect(git(['rev-parse', 'main'])).not.toBe(baseline);
    const paths = changedPaths('shared', root, execGit);
    expect(paths.sort()).toEqual(['shared/baseline.ts', 'shared/committed.ts']);
    expect(planFromPaths(paths)).toMatchObject({ repos: ['shared', 'desktop', 'mobile'], live: true });
  });
});

describe('explicit CI comparison baseline', () => {
  it('routes a clean main push from its event SHA after origin/main has advanced to HEAD', () => {
    const { root, git } = repositoryFixture();
    const scripts = join(root, 'scripts/verify');
    mkdirSync(scripts, { recursive: true });
    for (const file of readdirSync(join(PROJECT_ROOT, 'scripts/verify')).filter((file) => file.endsWith('.mjs'))) {
      copyFileSync(join(PROJECT_ROOT, 'scripts/verify', file), join(scripts, file));
    }
    writeFileSync(join(root, 'source.ts'), 'export const value = 1;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture before push']);
    const before = git(['rev-parse', 'HEAD']);
    writeFileSync(join(root, 'source.ts'), 'export const value = 2;\n');
    git(['add', 'source.ts']);
    git(['commit', '-m', 'Fixture pushed change']);
    git(['update-ref', 'refs/remotes/origin/main', git(['rev-parse', 'HEAD'])]);
    git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    const explain = (...args: string[]) => execFileSync(process.execPath, [
      join(scripts, 'index.mjs'), '--explain', `--repos-root=${join(root, 'missing-dependencies')}`, ...args,
    ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(explain()).toMatch(/TIER\s+fast\n/);
    const explicit = explain(`--base=${before}`);
    expect(explicit).toMatch(/TIER\s+fast \+ live/);
    expect(explicit).toContain('desktop/source.ts');
    for (const args of [['--base='], ['--base'], ['--base=not-a-sha'], [`--base=${'0'.repeat(40)}`]]) {
      const unknown = explain(...args);
      expect(unknown).toMatch(/TIER\s+fast \+ live/);
      expect(unknown).toMatch(/invalid explicit base|unresolvable explicit base/);
    }
  });

  it('unions committed, staged, unstaged and untracked paths against an explicit before SHA', () => {
    const { root, git, execGit } = repositoryFixture();
    writeFileSync(join(root, 'existing.ts'), 'export const value = 1;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture before']);
    const before = git(['rev-parse', 'HEAD']);
    writeFileSync(join(root, 'committed.ts'), 'export const committed = true;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture after']);
    writeFileSync(join(root, 'existing.ts'), 'export const value = 2;\n');
    writeFileSync(join(root, 'staged.ts'), 'export const staged = true;\n');
    git(['add', 'staged.ts']);
    writeFileSync(join(root, 'untracked.ts'), 'export const untracked = true;\n');
    expect(changedPaths('desktop', root, execGit, before).sort()).toEqual([
      'desktop/committed.ts', 'desktop/existing.ts', 'desktop/staged.ts', 'desktop/untracked.ts',
    ]);
    for (const invalid of ['', 'main', 'a'.repeat(39), '0'.repeat(40), 'f'.repeat(40)]) {
      const paths = changedPaths('desktop', root, execGit, invalid);
      expect(paths).toHaveLength(1);
      expect(planFromPaths(paths).live).toBe(true);
    }
  });

  it('includes removals from the actual previous tree when a push replaces divergent history', () => {
    const { root, git, execGit } = repositoryFixture();
    writeFileSync(join(root, 'anchor.ts'), 'export const anchor = true;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture common ancestor']);
    const ancestor = git(['rev-parse', 'HEAD']);
    writeFileSync(join(root, 'removed.ts'), 'export const removed = true;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture previous branch']);
    const before = git(['rev-parse', 'HEAD']);
    git(['reset', '--hard', ancestor]);
    writeFileSync(join(root, 'added.ts'), 'export const added = true;\n');
    git(['add', '.']);
    git(['commit', '-m', 'Fixture replacement branch']);
    expect(changedPaths('desktop', root, execGit, before).sort()).toEqual([
      'desktop/added.ts', 'desktop/removed.ts',
    ]);
  });
});

describe('Vitest result details', () => {
  const detail = stepsFor('desktop', '/fixture', 'fast')
    .find((step: { id: string }) => step.id === 'desktop:unit').detail;

  it('reads the colored summary instead of incidental Tests text in a stack', () => {
    const output = [
      '    at getActiveTests (vitest/dist/runtime.js:1:1)',
      '\u001b[32m      Tests\u001b[39m  \u001b[32m1891 passed\u001b[39m (1891)',
    ].join('\n');
    expect(detail(output)).toBe('1891 passed (1891)');
  });

  it('leaves the detail blank when output has no Vitest summary', () => {
    expect(detail('at getActiveTests (vitest.js:1:1)\nTests: 1 passed, 1 total\n')).toBe('');
  });
});

describe('root lint scope', () => {
  // This uses the real ESLint config/plugins, not a mock or a startup benchmark.
  // The full suite measured 6,504 ms under contention; keep all path assertions
  // and give only this integration case room for configuration loading.
  it('excludes generated output and pinned dependencies while retaining application source', { timeout: 15_000 }, async () => {
    const root = PROJECT_ROOT;
    const eslint = new ESLint({ cwd: root, overrideConfigFile: join(root, 'eslint.config.js') });
    for (const path of [
      'hypersnap/dist/assets/browser.js',
      'hypersnap/dist-signer/main.cjs',
      'hypersnap/release/Arca Signer.app/Contents/Resources/example.js',
      'hypersnap/.wrangler/tmp/worker.js',
      '.quorum-deps/quorum-shared/src/index.ts',
    ]) expect(await eslint.isPathIgnored(path), path).toBe(true);
    for (const path of [
      'src/App.tsx',
      'hypersnap/src/App.tsx',
      'hypersnap/worker/index.ts',
      'hypersnap/signer/main.ts',
      'hypersnap/scripts/build-signer.mjs',
    ]) expect(await eslint.isPathIgnored(path), path).toBe(false);
  });
});
