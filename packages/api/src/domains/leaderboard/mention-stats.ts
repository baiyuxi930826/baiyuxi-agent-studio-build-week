/**
 * F075 — Mention stats computation
 * Pure functions: input messages → output ranked stats
 */
import type { MentionStats, RankedAgent, StreakAgent } from '@agent-studio/shared';

export interface MessageLike {
  id: string;
  mentions: readonly string[];
  timestamp: number;
  agentId: string | null;
  content: string;
  source?: { connector?: string };
}

function isNightHour(ts: number): boolean {
  const h = new Date(ts).getUTCHours();
  return h >= 0 && h < 6;
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

/** Epoch ms → YYYY-MM-DD (UTC) */
function toDateKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function computeStreaks(dateSets: Map<string, Set<string>>, agentNames: Record<string, string>): StreakAgent[] {
  const results: StreakAgent[] = [];

  for (const [agentId, dates] of dateSets) {
    const sorted = [...dates].sort().reverse(); // newest first
    if (sorted.length === 0) continue;

    let currentStreak = 1;
    let maxStreak = 1;
    let streak = 1;

    for (let i = 1; i < sorted.length; i++) {
      const prevDate = sorted[i - 1];
      const currDate = sorted[i];
      if (!prevDate || !currDate) continue;
      const diffDays = (new Date(prevDate).getTime() - new Date(currDate).getTime()) / 86_400_000;

      if (Math.abs(diffDays - 1) < 0.01) {
        streak++;
      } else {
        streak = 1;
      }
      maxStreak = Math.max(maxStreak, streak);
    }

    // currentStreak = streak from the most recent date going backwards
    currentStreak = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prevDate = sorted[i - 1];
      const currDate = sorted[i];
      if (!prevDate || !currDate) break;
      const diffDays = (new Date(prevDate).getTime() - new Date(currDate).getTime()) / 86_400_000;
      if (Math.abs(diffDays - 1) < 0.01) {
        currentStreak++;
      } else {
        break;
      }
    }

    maxStreak = Math.max(maxStreak, currentStreak);

    results.push({
      agentId,
      displayName: agentNames[agentId] ?? agentId,
      currentStreak,
      maxStreak,
      rank: 0, // assigned below
    });
  }

  results.sort((a, b) => b.currentStreak - a.currentStreak);
  for (let i = 0; i < results.length; i++) {
    const entry = results[i];
    if (entry) entry.rank = i + 1;
  }

  return results;
}

export function computeMentionStats(
  messages: MessageLike[],
  agentNames: Record<string, string>,
  _range: string,
): MentionStats {
  const mentionCount = new Map<string, number>();
  const nightCount = new Map<string, number>();
  const chattyCount = new Map<string, number>();
  const dateSets = new Map<string, Set<string>>(); // agentId → set of date keys

  for (const msg of messages) {
    // Mention-based rankings should reflect co-creator/owner mentions only.
    // Exclude agent-authored messages AND connector-sourced messages (agentId is also null).
    if (!msg.agentId && !msg.source?.connector) {
      for (const agentId of msg.mentions) {
        mentionCount.set(agentId, (mentionCount.get(agentId) ?? 0) + 1);

        if (isNightHour(msg.timestamp)) {
          nightCount.set(agentId, (nightCount.get(agentId) ?? 0) + 1);
        }

        // Track dates for streak
        let dates = dateSets.get(agentId);
        if (!dates) {
          dates = new Set();
          dateSets.set(agentId, dates);
        }
        dates.add(toDateKey(msg.timestamp));
      }
    }

    // Chatty = messages sent BY a agent
    if (msg.agentId) {
      chattyCount.set(msg.agentId, (chattyCount.get(msg.agentId) ?? 0) + 1);
    }
  }

  return {
    favoriteAgent: toRanked(mentionCount, agentNames),
    nightOwl: toRanked(nightCount, agentNames),
    chatty: toRanked(chattyCount, agentNames),
    streak: computeStreaks(dateSets, agentNames),
  };
}
