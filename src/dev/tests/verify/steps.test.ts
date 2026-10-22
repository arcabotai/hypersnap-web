import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('root lint scope', () => {
  it('excludes generated output and pinned dependencies while retaining application source', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
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
