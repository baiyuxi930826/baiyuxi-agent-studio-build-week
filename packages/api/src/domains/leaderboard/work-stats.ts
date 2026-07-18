/**
 * F075 — Work stats computation from git log
 * Pure functions: git log output → ranked work stats
 */
import type { RankedAgent, WorkStats } from '@agent-studio/shared';

export interface GitLogEntry {
  hash: string;
  author: string;
  date: string;
  message: string;
  coAuthors: string;
}

/**
 * Parse pipe-delimited git log output.
 * Expected format: hash|author|date|message|co-authors
 * (from `git log --format='%H|%ae|%aI|%s|%(trailers:key=Co-authored-by,valueonly,separator=%0a)'`)
 */
export function parseGitLog(raw: string): GitLogEntry[] {
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split('|');
      return {
        hash: parts[0] ?? '',
        author: parts[1] ?? '',
        date: parts[2] ?? '',
        message: parts[3] ?? '',
        coAuthors: parts.slice(4).join('|'),
      };
    });
}

function classifyCommit(msg: string): 'bugfix' | 'review' | 'commit' {
  const lower = msg.toLowerCase();
  if (lower.startsWith('fix') || lower.includes('bug')) return 'bugfix';
  if (lower.startsWith('review') || lower.includes('review:')) return 'review';
  return 'commit';
}

function toRanked(counter: Map<string, number>, agentNames: Record<string, string>): RankedAgent[] {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([agentId, count], i) => ({
      agentId,
      displayName: agentNames[agentId] ?? agentId,
      count,
      rank: i + 1,
    }));
}

/**
 * Resolve which agent authored a commit.
 * Priority: Co-Authored-By containing known agent emails → author email → fallback to email
 */
function resolveAuthor(entry: GitLogEntry, authorMap: Record<string, string>): string {
  // Check Co-Authored-By for known agent identifiers
  const coAuthor = entry.coAuthors.toLowerCase();
  if (coAuthor.includes('opus') || coAuthor.includes('anthropic')) return authorMap['noreply@anthropic.com'] ?? 'opus';
  if (coAuthor.includes('codex') || coAuthor.includes('openai')) return authorMap['codex@openai.com'] ?? 'codex';
  if (coAuthor.includes('gemini') || coAuthor.includes('google')) return authorMap['gemini@google.com'] ?? 'gemini';

  // Fallback to author email map
  return authorMap[entry.author] ?? entry.author;
}

export function computeWorkStats(
  entries: GitLogEntry[],
  authorMap: Record<string, string>,
  agentNames: Record<string, string>,
): WorkStats {
  const commits = new Map<string, number>();
  const reviews = new Map<string, number>();
  const bugFixes = new Map<string, number>();

  for (const entry of entries) {
    const agentId = resolveAuthor(entry, authorMap);
    const kind = classifyCommit(entry.message);

    commits.set(agentId, (commits.get(agentId) ?? 0) + 1);
    if (kind === 'review') reviews.set(agentId, (reviews.get(agentId) ?? 0) + 1);
    if (kind === 'bugfix') bugFixes.set(agentId, (bugFixes.get(agentId) ?? 0) + 1);
  }

  return {
    commits: toRanked(commits, agentNames),
    reviews: toRanked(reviews, agentNames),
    bugFixes: toRanked(bugFixes, agentNames),
  };
}
