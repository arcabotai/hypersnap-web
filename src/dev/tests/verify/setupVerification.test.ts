import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  dependencyPath,
  DEPENDENCY_BASE_REF,
  ensureDependencyBase,
  parseOptions,
  prepareRootLinks,
  readManifest,
  runCommand,
  setupVerification,
  validateBuildArtifacts,
  validateDependencyCheckout,
  validateRootLinks,
} from '../../../../scripts/setup-verification.mjs';

const ROOT = resolve(__dirname, '../../../..');
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temp() {
  const directory = mkdtempSync(join(tmpdir(), 'opencaster-verify-setup-'));
  temporary.push(directory);
  return directory;
}

function git(directory: string, ...args: string[]) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}

function writeJson(file: string, data: unknown) {
  mkdirSync(resolve(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function createSource(directory: string) {
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, 'package.json'), {
    name: '@quilibrium/quorum-shared', version: '2.1.0-45', scripts: { build: 'echo fixture' },
  });
  writeFileSync(join(directory, '.gitignore'), 'dist/\nnode_modules/\n');
  git(directory, 'init', '--quiet');
  git(directory, 'add', 'package.json', '.gitignore');
  git(directory, '-c', 'user.name=Verification fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '--quiet', '-m', 'fixture');
  git(directory, 'remote', 'add', 'origin', 'https://github.com/QuilibriumNetwork/quorum-shared.git');
  return git(directory, 'rev-parse', 'HEAD');
}

function fixture({ missing = false } = {}) {
  const root = temp();
  const seed = missing ? join(temp(), 'source') : join(root, '.quorum-deps/quorum-shared');
  const commit = createSource(seed);
  const dep = {
    name: '@quilibrium/quorum-shared', directory: 'quorum-shared',
    repository: 'https://github.com/QuilibriumNetwork/quorum-shared.git',
    commit, version: '2.1.0-45', buildArtifacts: ['dist/index.mjs', 'dist/index.d.ts'],
  };
  git(seed, 'update-ref', DEPENDENCY_BASE_REF, commit);
  writeJson(join(root, 'scripts/verification-dependencies.json'), { schemaVersion: 1, dependencies: [dep] });
  writeJson(join(root, 'package.json'), {
    dependencies: { [dep.name]: 'link:./.quorum-deps/quorum-shared' },
  });
  mkdirSync(join(root, 'hypersnap'));
  return { root, dep, seed, target: dependencyPath(root, dep) };
}

function artifacts(target: string, paths: string[]) {
  for (const artifact of paths) {
    mkdirSync(resolve(target, artifact, '..'), { recursive: true });
    writeFileSync(join(target, artifact), 'fixture');
  }
}

function link(root: string, name: string, target: string) {
  mkdirSync(resolve(root, 'node_modules', name, '..'), { recursive: true });
  symlinkSync(target, join(root, 'node_modules', name), 'dir');
}

describe('pinned verification source setup', () => {
  it('records the exact upstream sources used by the retained messenger gate', () => {
    expect(readManifest(ROOT).dependencies.map(({ name, commit, version }: Record<string, string>) =>
      ({ name, commit, version }))).toEqual([
      { name: '@quilibrium/quorum-shared', commit: 'c00c61e099fe9e682c982bc952b4e712c7a4a576', version: '2.1.0-45' },
      { name: '@quilibrium/quilibrium-js-sdk-channels', commit: '882d8e1b520fc97c73be964013b06a57ca4f4a63', version: '2.1.1' },
    ]);
  });

  it('rejects floating revisions and paths outside the local dependency cache', () => {
    const { root, dep } = fixture();
    for (const override of [{ commit: 'main' }, { directory: '../outside' }, { buildArtifacts: ['dist/../../outside'] }]) {
      writeJson(join(root, 'scripts/verification-dependencies.json'), {
        schemaVersion: 1, dependencies: [{ ...dep, ...override }],
      });
      expect(() => readManifest(root)).toThrow('Invalid, unpinned');
    }
  });

  it('checks an existing exact source without changing its revision', () => {
    const { root, dep, target } = fixture();
    expect(validateDependencyCheckout(root, dep)).toBe(target);
    expect(git(target, 'rev-parse', 'HEAD')).toBe(dep.commit);
    expect(git(target, 'status', '--porcelain')).toBe('');
  });

  it.each(['tracked', 'untracked'])('refuses %s local work before any install, preserving it', (kind) => {
    const { root, dep, target } = fixture();
    const file = join(target, kind === 'tracked' ? 'package.json' : 'unsaved-work.txt');
    writeFileSync(file, 'keep this work');
    const commands: string[] = [];
    const run = (command: string, args: string[], cwd: string, capture?: boolean) => {
      commands.push(command);
      return runCommand(command, args, cwd, capture);
    };
    expect(() => setupVerification({ root, run, log: () => {} })).toThrow('local changes or untracked files');
    expect(commands).not.toContain('yarn');
    expect(readFileSync(file, 'utf8')).toBe('keep this work');
    expect(git(target, 'rev-parse', 'HEAD')).toBe(dep.commit);
  });

  it('refuses a different revision instead of checking out or resetting it', () => {
    const { root, dep, target } = fixture();
    expect(() => validateDependencyCheckout(root, { ...dep, commit: '0'.repeat(40) })).toThrow('different revision');
    expect(git(target, 'rev-parse', 'HEAD')).toBe(dep.commit);
  });

  it('rejects unexpected source origins without echoing possible credentials', () => {
    const { root, dep, target } = fixture();
    git(target, 'remote', 'set-url', 'origin', 'https://secret-token@example.invalid/other.git');
    try {
      validateDependencyCheckout(root, dep);
      throw new Error('expected rejection');
    } catch (error) {
      expect(String(error)).toContain('unexpected origin');
      expect(String(error)).not.toContain('secret-token');
    }
    expect(git(target, 'remote', 'get-url', 'origin')).toContain('secret-token');
  });

  it('checks package identity and version in addition to the Git commit', () => {
    const { root, dep } = fixture();
    expect(() => validateDependencyCheckout(root, { ...dep, version: '2.1.0-44' })).toThrow('unexpected package metadata');
    expect(() => validateDependencyCheckout(root, { ...dep, name: '@quilibrium/wrong' })).toThrow('unexpected package metadata');
  });

  it('records a missing immutable comparison base without moving HEAD, and refuses an existing different base', () => {
    const { root, dep, target } = fixture();
    git(target, 'update-ref', '-d', DEPENDENCY_BASE_REF);
    expect(() => ensureDependencyBase(root, dep, { check: true })).toThrow('no pinned comparison base');
    ensureDependencyBase(root, dep);
    expect(git(target, 'rev-parse', DEPENDENCY_BASE_REF)).toBe(dep.commit);
    expect(git(target, 'rev-parse', 'HEAD')).toBe(dep.commit);
    const other = git(target, '-c', 'user.name=Verification fixture', '-c', 'user.email=fixture@example.invalid',
      'commit-tree', `${dep.commit}^{tree}`, '-p', dep.commit, '-m', 'different comparison base');
    git(target, 'update-ref', DEPENDENCY_BASE_REF, other);
    expect(() => ensureDependencyBase(root, dep)).toThrow('different refs/verify/dependency-base');
    expect(git(target, 'rev-parse', DEPENDENCY_BASE_REF)).toBe(other);
  });

  it('removes only the historical dangling module link, preserving other existing links', () => {
    const { root, dep } = fixture();
    const modulePath = join(root, 'node_modules', dep.name);
    const oldSibling = resolve(root, '..', dep.directory);
    link(root, dep.name, oldSibling);
    prepareRootLinks(root, [dep]);
    expect(() => lstatSync(modulePath)).toThrow();
    const outside = join(temp(), 'another-checkout');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep');
    link(root, dep.name, outside);
    expect(() => prepareRootLinks(root, [dep])).toThrow('already links to a different checkout');
    expect(readFileSync(join(modulePath, 'keep.txt'), 'utf8')).toBe('keep');
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('keep');
  });

  it('keeps --check read-only and reports a missing source without fetching', () => {
    const { root, target } = fixture({ missing: true });
    const commands: string[] = [];
    expect(() => setupVerification({ root, options: { check: true }, run: (command: string) => {
      commands.push(command); return '';
    } })).toThrow('is missing');
    expect(commands).toEqual([]);
    expect(existsSync(target)).toBe(false);
  });

  it('requires built artifacts and exact root module links for --check', () => {
    const { root, dep, target } = fixture();
    expect(() => validateBuildArtifacts(root, dep)).toThrow('dist/index.mjs is missing');
    artifacts(target, dep.buildArtifacts);
    expect(() => validateRootLinks(root, [dep])).toThrow('does not resolve');
    link(root, dep.name, target);
    const mutations: string[] = [];
    setupVerification({ root, options: { check: true }, run: (command: string, args: string[], cwd: string, capture?: boolean) => {
      if (command !== 'git') mutations.push(command);
      return runCommand(command, args, cwd, capture);
    }, log: () => {} });
    expect(mutations).toEqual([]);
  });

  it('fetches only the manifest commit and installs frozen dependency locks without app installs in --deps-only', () => {
    const { root, dep, target, seed } = fixture({ missing: true });
    const commands: { command: string; args: string[]; cwd: string }[] = [];
    const run = (command: string, args: string[], cwd: string, capture?: boolean) => {
      commands.push({ command, args, cwd });
      if (command === 'yarn') {
        if (args[0] === '--version') return '1.22.22';
        if (args[0] === 'build') artifacts(target, dep.buildArtifacts);
        return '';
      }
      // All Git operations are real, but the fixed remote fetch is replaced by
      // an equivalent fetch from the local fixture. No network is used.
      if (args[0] === 'fetch') return runCommand(command, ['fetch', '--depth=1', seed, dep.commit], cwd, capture);
      return runCommand(command, args, cwd, capture);
    };
    setupVerification({ root, options: { depsOnly: true }, run, log: () => {} });
    expect(commands.filter(({ args }) => args[0] === 'fetch')).toEqual([
      { command: 'git', args: ['fetch', '--depth=1', 'origin', dep.commit], cwd: target },
    ]);
    expect(commands.filter(({ command }) => command === 'yarn')).toEqual([
      { command: 'yarn', args: ['--version'], cwd: root },
      { command: 'yarn', args: ['install', '--frozen-lockfile'], cwd: target },
      { command: 'yarn', args: ['build'], cwd: target },
    ]);
    expect(commands.some(({ args }) => args.includes('reset') || args.includes('pull') || args.includes('link'))).toBe(false);
    expect(git(target, 'rev-parse', 'HEAD')).toBe(dep.commit);
    expect(git(target, 'rev-parse', DEPENDENCY_BASE_REF)).toBe(dep.commit);
  });

  it('installs the root and standalone app locks after validating the dependency build', () => {
    const { root, dep, target } = fixture();
    const installs: string[] = [];
    const run = (command: string, args: string[], cwd: string, capture?: boolean) => {
      if (command !== 'yarn') return runCommand(command, args, cwd, capture);
      if (args[0] === '--version') return '1.22.22';
      if (args[0] === 'build') artifacts(target, dep.buildArtifacts);
      if (args[0] === 'install') {
        expect(args).toEqual(['install', '--frozen-lockfile']);
        installs.push(cwd);
        if (cwd === root) link(root, dep.name, target);
      }
      return '';
    };
    setupVerification({ root, run, log: () => {} });
    expect(installs).toEqual([target, root, join(root, 'hypersnap')]);
  });

  it('rejects unsupported flags instead of accepting commands or minting options', () => {
    expect(parseOptions(['--check'])).toEqual({ check: true, depsOnly: false, help: false });
    expect(() => parseOptions(['--live-allow-minting'])).toThrow('Unknown option');
  });
});
