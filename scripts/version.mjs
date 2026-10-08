// Works out the app version from git: the latest vX.Y.Z tag, bumped by the conventional commits since it.
//   fix: / perf:          → patch
//   feat:                 → minor
//   type!: or BREAKING CHANGE in the body → major
// Other types (chore, ci, docs, test, …) don't release. With no tag yet, package.json's version is the first release.
//
// Usage: node scripts/version.mjs [--notes <file>]   prints the version; --notes writes its release notes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const BUMPS = ['patch', 'minor', 'major'];
const SECTIONS = { major: 'Breaking changes', minor: 'Features', patch: 'Fixes' };

const git = (...args) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();

function packageVersion() {
  return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

function latestTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*');
  } catch {
    return null;
  }
}

/** Each non-merge commit in `range` with the version bump it asks for, or null. */
function commits(range) {
  const log = git('log', '--no-merges', '--format=%h%x1f%s%x1f%b%x1e', ...(range ? [range] : []));
  return log.split('\x1e').map(entry => entry.trim()).filter(Boolean).map(entry => {
    const [hash, subject, body = ''] = entry.split('\x1f');
    const match = subject.match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
    if (!match) return { hash, subject, bump: null };
    const [, type, scope, bang, description] = match;
    const bump = bang || /^BREAKING[ -]CHANGE:/m.test(body) ? 'major'
      : type === 'feat' ? 'minor'
      : type === 'fix' || type === 'perf' ? 'patch'
      : null;
    return { hash, subject: scope ? `**${scope}:** ${description}` : description, bump };
  });
}

function bumped(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** The version this commit ships as, and the notes for what changed since the last release. */
function release() {
  try {
    git('rev-parse', '--git-dir');
  } catch {
    return { version: packageVersion(), notes: '' }; // No repo, e.g. a Docker build.
  }
  const tag = latestTag();
  const changes = commits(tag ? `${tag}..HEAD` : null).filter(commit => commit.bump);
  const bump = changes.reduce((top, { bump }) => BUMPS.indexOf(bump) > BUMPS.indexOf(top) ? bump : top, null);
  const version = !tag ? packageVersion() : bump ? bumped(tag.slice(1), bump) : tag.slice(1);
  const notes = [...BUMPS].reverse().map(level => {
    const lines = changes.filter(commit => commit.bump === level).map(commit => `- ${commit.subject} (${commit.hash})`);
    return lines.length ? `### ${SECTIONS[level]}\n${lines.join('\n')}\n` : '';
  }).filter(Boolean).join('\n');
  return { version, notes };
}

const { version, notes } = release();
const notesIndex = process.argv.indexOf('--notes');
if (notesIndex !== -1) writeFileSync(process.argv[notesIndex + 1], notes);
console.log(version);
