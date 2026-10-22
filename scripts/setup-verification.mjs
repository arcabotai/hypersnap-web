#!/usr/bin/env node
/**
 * Recreate the retained messenger's known dependency sources without global
 * yarn links, floating branches, or machine-specific sibling checkouts.
 *
 * Existing source trees are checked before anything is installed. A different
 * revision, repository, or working change is an error for the operator to
 * resolve; this script never resets or removes an existing checkout.
 *
 * yarn setup:verify              sources, dependency builds, both app installs
 * yarn setup:verify --deps-only  sources and dependency builds only
 * yarn setup:verify --check      inspect sources, artifacts and root links only
 *
 * This does not run tests or contact any production relay.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = '.quorum-deps';
export const DEPENDENCY_BASE_REF = 'refs/verify/dependency-base';

export function runCommand(command, args, cwd, capture = false) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })?.trim() ?? '';
}

export function readManifest(root = ROOT) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'scripts/verification-dependencies.json'), 'utf8')
  );
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.dependencies) || !manifest.dependencies.length) {
    throw new Error('Unsupported or empty verification dependency manifest.');
  }
  const names = new Set();
  const directories = new Set();
  for (const dep of manifest.dependencies) {
    if (
      !/^@quilibrium\/[a-z0-9-]+$/.test(dep.name ?? '') ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(dep.directory ?? '') ||
      !/^https:\/\/github\.com\/QuilibriumNetwork\/[a-z0-9-]+\.git$/.test(dep.repository ?? '') ||
      !/^[a-f0-9]{40}$/.test(dep.commit ?? '') ||
      typeof dep.version !== 'string' || !dep.version ||
      !Array.isArray(dep.buildArtifacts) || !dep.buildArtifacts.length ||
      dep.buildArtifacts.some((artifact) =>
        typeof artifact !== 'string' || !/^dist\/[a-zA-Z0-9./_-]+$/.test(artifact) ||
        artifact.split('/').some((part) => !part || part === '.' || part === '..')
      ) ||
      names.has(dep.name) || directories.has(dep.directory)
    ) {
      throw new Error('Invalid, unpinned, or duplicate verification dependency manifest entry.');
    }
    names.add(dep.name);
    directories.add(dep.directory);
  }
  return manifest;
}

function requireRealDirectory(directory) {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${directory} must be a real directory, not a symlink or another file.`);
  }
}

export function dependencyPath(root, dep) {
  return join(root, CACHE, dep.directory);
}

export function validateDependencyCheckout(root, dep, run = runCommand) {
  const target = dependencyPath(root, dep);
  if (!existsSync(target)) {
    throw new Error(`${dep.directory} is missing. Run yarn setup:verify to fetch the pinned source.`);
  }
  requireRealDirectory(join(root, CACHE));
  requireRealDirectory(target);
  const git = (...args) => run('git', args, target, true);
  let top;
  let origin;
  let head;
  let status;
  try {
    top = git('rev-parse', '--show-toplevel');
    origin = git('remote', 'get-url', 'origin');
    head = git('rev-parse', 'HEAD');
    status = git('status', '--porcelain', '--untracked-files=normal');
  } catch {
    throw new Error(`${dep.directory} is not a readable Git checkout. It was left untouched.`);
  }
  if (realpathSync(top) !== realpathSync(target)) {
    throw new Error(`${dep.directory} must be its own Git checkout. It was left untouched.`);
  }
  if (origin.replace(/\.git$/, '') !== dep.repository.replace(/\.git$/, '')) {
    // Do not echo an unexpected origin: it can contain embedded credentials.
    throw new Error(`${dep.directory} has an unexpected origin. Expected ${dep.repository}; it was left untouched.`);
  }
  if (head !== dep.commit) {
    throw new Error(`${dep.directory} is at a different revision. Expected ${dep.commit}; it was left untouched.`);
  }
  if (status !== '') {
    throw new Error(`${dep.directory} has local changes or untracked files. It was left untouched; save your work before continuing.`);
  }
  const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
  if (pkg.name !== dep.name || pkg.version !== dep.version) {
    throw new Error(`${dep.directory} has unexpected package metadata; expected ${dep.name}@${dep.version}. It was left untouched.`);
  }
  if (pkg.scripts?.build === undefined) {
    throw new Error(`${dep.directory} has no build script.`);
  }
  return target;
}

export function validateBuildArtifacts(root, dep) {
  const target = dependencyPath(root, dep);
  for (const artifact of dep.buildArtifacts) {
    if (!existsSync(join(target, artifact))) {
      throw new Error(`${dep.directory}/${artifact} is missing. Run yarn setup:verify to build the pinned source.`);
    }
  }
}

function dependencyBase(root, dep, run) {
  const refs = run('git', ['for-each-ref', '--format=%(refname) %(objectname)', DEPENDENCY_BASE_REF],
    dependencyPath(root, dep), true);
  const entry = refs.split('\n').find((line) => line.startsWith(`${DEPENDENCY_BASE_REF} `));
  const commit = entry?.slice(DEPENDENCY_BASE_REF.length + 1) ?? null;
  if (commit && commit !== dep.commit) {
    throw new Error(`${dep.directory} has a different ${DEPENDENCY_BASE_REF}. It was left untouched.`);
  }
  return commit;
}

export function ensureDependencyBase(root, dep, { check = false, run = runCommand } = {}) {
  if (dependencyBase(root, dep, run)) return;
  if (check) {
    throw new Error(`${dep.directory} has no pinned comparison base. Run yarn setup:verify to record it.`);
  }
  // An explicit local snapshot ref, not a fabricated remote/default branch.
  // The zero old-value means "create only": another ref can never be replaced.
  run('git', ['update-ref', DEPENDENCY_BASE_REF, dep.commit, '0'.repeat(40)], dependencyPath(root, dep));
}

export function prepareRootLinks(root, dependencies) {
  for (const dep of dependencies) {
    const modulePath = join(root, 'node_modules', dep.name);
    let stat;
    try {
      stat = lstatSync(modulePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    if (!stat.isSymbolicLink()) continue;
    const linkTarget = resolve(dirname(modulePath), readlinkSync(modulePath));
    if (linkTarget === dependencyPath(root, dep)) continue;
    const legacySibling = resolve(root, '..', dep.directory);
    if (linkTarget === legacySibling && !existsSync(modulePath)) {
      // Yarn 1 cannot replace this historical dangling link (EEXIST). Remove
      // only the link itself; the sibling/source is never touched.
      unlinkSync(modulePath);
    } else {
      throw new Error(`${dep.name} already links to a different checkout. It was left untouched; review that module link before installing.`);
    }
  }
}

export function validateRootLinks(root, dependencies) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of dependencies) {
    const expected = `link:./${CACHE}/${dep.directory}`;
    if (pkg.dependencies?.[dep.name] !== expected) {
      throw new Error(`package.json must declare ${dep.name} as ${expected}.`);
    }
    const modulePath = join(root, 'node_modules', dep.name);
    if (!existsSync(modulePath) || realpathSync(modulePath) !== realpathSync(dependencyPath(root, dep))) {
      throw new Error(`${dep.name} does not resolve to its pinned checkout. Run yarn setup:verify to install the root links.`);
    }
  }
}

export function parseOptions(args) {
  const known = new Set(['--check', '--deps-only', '--help']);
  for (const arg of args) {
    if (!known.has(arg)) throw new Error(`Unknown option: ${arg}`);
  }
  return {
    check: args.includes('--check'),
    depsOnly: args.includes('--deps-only'),
    help: args.includes('--help'),
  };
}

export function setupVerification({
  root = ROOT,
  options = {},
  run = runCommand,
  log = console.log,
} = {}) {
  const { dependencies } = readManifest(root);
  const cache = join(root, CACHE);
  if (existsSync(cache)) requireRealDirectory(cache);

  // Check every existing checkout before even fetching a missing one. A later
  // dependency with unsaved work must not trigger an earlier install/build.
  for (const dep of dependencies) {
    if (existsSync(dependencyPath(root, dep))) {
      validateDependencyCheckout(root, dep, run);
      dependencyBase(root, dep, run);
    }
    else if (options.check) {
      throw new Error(`${dep.directory} is missing. Run yarn setup:verify to fetch the pinned source.`);
    }
  }

  if (options.check) {
    for (const dep of dependencies) {
      ensureDependencyBase(root, dep, { check: true, run });
      validateBuildArtifacts(root, dep);
    }
    validateRootLinks(root, dependencies);
    log('setup-verification: pinned sources, built artifacts, and root links are present. No files changed.');
    return;
  }

  const yarnVersion = run('yarn', ['--version'], root, true);
  if (!/^1\.22\./.test(yarnVersion)) {
    throw new Error('This repository needs Yarn Classic 1.22.x. Select its packageManager version before running setup.');
  }
  mkdirSync(cache, { recursive: true });
  for (const dep of dependencies) {
    const target = dependencyPath(root, dep);
    if (!existsSync(target)) {
      log(`setup-verification: fetching ${dep.directory} at ${dep.commit}`);
      mkdirSync(target);
      // Fetch exactly the manifest commit, without cloning/following the latest
      // default branch. A failed fetch leaves the directory for inspection.
      run('git', ['init', '--quiet'], target);
      run('git', ['remote', 'add', 'origin', dep.repository], target);
      run('git', ['fetch', '--depth=1', 'origin', dep.commit], target);
      run('git', ['checkout', '--quiet', '--detach', dep.commit], target);
    }
    validateDependencyCheckout(root, dep, run);
    ensureDependencyBase(root, dep, { run });
  }
  for (const dep of dependencies) {
    const target = dependencyPath(root, dep);
    log(`setup-verification: installing and building ${dep.name}@${dep.version}`);
    run('yarn', ['install', '--frozen-lockfile'], target);
    run('yarn', ['build'], target);
    validateDependencyCheckout(root, dep, run);
    validateBuildArtifacts(root, dep);
  }
  if (!options.depsOnly) {
    prepareRootLinks(root, dependencies);
    run('yarn', ['install', '--frozen-lockfile'], root);
    validateRootLinks(root, dependencies);
    run('yarn', ['install', '--frozen-lockfile'], join(root, 'hypersnap'));
  }
  log(`setup-verification: complete${options.depsOnly ? ' (dependency sources and builds only)' : ''}.`);
  log('Run yarn verify, then cd hypersnap && yarn verify. Production account creation remains guarded.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) {
      console.log('Usage: yarn setup:verify [--check | --deps-only]');
      console.log('Fetch/build the pinned messenger dependencies and install both apps with frozen Yarn lockfiles.');
      console.log('--check inspects sources, artifacts and root links without changing files.');
      console.log('--deps-only fetches/builds dependency checkouts without installing the apps.');
    } else {
      setupVerification({ options });
    }
  } catch (error) {
    console.error(`setup-verification: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
