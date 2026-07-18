/**
 * F085 Phase 4 — ActivityTracker
 * 平台级活跃时长追踪：per-user in-memory state, 5min gap detection.
 */
import type { BrakeCheckinResponse, BrakeSettings, BrakeState } from '@agent-studio/shared';

const GAP_THRESHOLD_MS = 5 * 60_000; // 5 minutes = break
const BYPASS_WINDOW_MS = 4 * 60 * 60_000; // 4h window for bypass escalation (AC13)

/** Internal state extends BrakeState with fields not exposed to frontend */
interface InternalState extends BrakeState {
  bypassTimestamps: number[];
  lastTriggeredLevel: 0 | 1 | 2 | 3;
}

function defaultState(): InternalState {
  return {
    activeWorkMs: 0,
    lastActivityTs: 0,
    triggerLevel: 0,
    bypassCount: 0,
    dismissed: false,
    dismissCooldownMs: 30 * 60_000,
    lastCheckinTs: 0,
    bypassTimestamps: [],
    lastTriggeredLevel: 0,
  };
}

export class ActivityTracker {
  private states = new Map<string, InternalState>();
  private settings = new Map<string, BrakeSettings>();

  private static defaultSettings(): BrakeSettings {
    return { enabled: true, thresholdMinutes: 90 };
  }

  getSettings(userId: string): BrakeSettings {
    return this.settings.get(userId) ?? ActivityTracker.defaultSettings();
  }

  updateSettings(userId: string, patch: Partial<BrakeSettings>): BrakeSettings | { error: string } {
    const current = { ...this.getSettings(userId) };
    if (patch.thresholdMinutes !== undefined) {
      if (typeof patch.thresholdMinutes !== 'number' || patch.thresholdMinutes < 30 || patch.thresholdMinutes > 240) {
        return { error: 'thresholdMinutes must be 30–240' };
      }
      current.thresholdMinutes = patch.thresholdMinutes;
    }
    if (patch.enabled !== undefined) {
      if (typeof patch.enabled !== 'boolean') {
        return { error: 'enabled must be a boolean' };
      }
      current.enabled = patch.enabled;
    }
    this.settings.set(userId, current);
    return current;
  }

  getState(userId: string): BrakeState {
    const s = this.states.get(userId);
    if (!s) return defaultState();
    // Return public BrakeState shape (strip internal fields)
    return {
      activeWorkMs: s.activeWorkMs,
      lastActivityTs: s.lastActivityTs,
      triggerLevel: s.triggerLevel,
      bypassCount: s.bypassCount,
      dismissed: s.dismissed,
      dismissCooldownMs: s.dismissCooldownMs,
      lastCheckinTs: s.lastCheckinTs,
    };
  }

  /**
   * Record a user activity event. Call on every API request.
   * @param nowMs - current timestamp in ms (injectable for testing)
   */
  recordActivity(userId: string, nowMs: number = Date.now()): void {
    let state = this.states.get(userId);
    if (!state) {
      state = defaultState();
      state.lastActivityTs = nowMs;
      this.states.set(userId, state);
      return;
    }

    const gap = nowMs - state.lastActivityTs;
    if (gap < GAP_THRESHOLD_MS && state.lastActivityTs > 0) {
      state.activeWorkMs += gap;
    }
    state.lastActivityTs = nowMs;

    // Auto-reset dismissed after cooldown
    if (state.dismissed && state.lastCheckinTs > 0) {
      const elapsed = nowMs - state.lastCheckinTs;
      if (elapsed >= state.dismissCooldownMs) {
        state.dismissed = false;
        // Reset dedup so same level can re-trigger after cooldown
        state.lastTriggeredLevel = 0;
      }
    }
  }

  /**
   * Check if brake should trigger for this user.
   * Returns 0 if dismissed OR if same level was already triggered (dedup).
   * @returns 0 = no trigger, 1/2/3 = L1/L2/L3
   */
  shouldTrigger(userId: string, thresholdMs?: number): 0 | 1 | 2 | 3 {
    const settings = this.getSettings(userId);
    if (!settings.enabled) return 0;

    const state = this.states.get(userId);
    if (!state || state.dismissed) return 0;

    if (thresholdMs === undefined) {
      thresholdMs = settings.thresholdMinutes * 60_000;
    }

    const ms = state.activeWorkMs;
    let level: 0 | 1 | 2 | 3 = 0;
    if (ms >= thresholdMs * 3) level = 3;
    else if (ms >= thresholdMs * 2) level = 2;
    else if (ms >= thresholdMs) level = 1;

    // P2 fix: dedup — don't re-trigger same level
    if (level > 0 && level <= state.lastTriggeredLevel) return 0;

    return level;
  }

  /**
   * Mark a trigger level as emitted (for dedup).
   * Call after successfully emitting brake:trigger event.
   */
  markTriggered(userId: string, level: 1 | 2 | 3): void {
    const state = this.states.get(userId);
    if (state) state.lastTriggeredLevel = level;
  }

  /**
   * Handle user check-in response.
   */
  handleCheckin(
    userId: string,
    choice: 'rest' | 'wrap_up' | 'continue',
    _reason?: string,
    nowMs: number = Date.now(),
  ): BrakeCheckinResponse {
    const state = this.states.get(userId);
    if (!state) return { ok: false, nextCheckMinutes: 0 };

    state.lastCheckinTs = nowMs;
    state.dismissed = true;

    switch (choice) {
      case 'rest':
        state.activeWorkMs = 0;
        state.triggerLevel = 0;
        state.lastTriggeredLevel = 0;
        state.dismissCooldownMs = 5 * 60_000;
        return { ok: true, nextCheckMinutes: 0 };

      case 'wrap_up':
        state.dismissCooldownMs = 10 * 60_000;
        return { ok: true, nextCheckMinutes: 10 };

      case 'continue': {
        // P1-1 fix: filter bypass timestamps within 4h window (AC13)
        state.bypassTimestamps = state.bypassTimestamps.filter((ts) => nowMs - ts < BYPASS_WINDOW_MS);
        state.bypassTimestamps.push(nowMs);
        state.bypassCount = state.bypassTimestamps.length;

        const cooldownMin = this.getBypassCooldown(state.bypassCount);
        if (cooldownMin === -1) {
          // 3rd+ bypass in 4h: don't dismiss — keep nagging
          state.dismissed = false;
          state.lastTriggeredLevel = 0; // Reset dedup so trigger fires again
          return { ok: true, nextCheckMinutes: -1, bypassDisabled: true };
        }
        state.dismissCooldownMs = cooldownMin * 60_000;
        return { ok: true, nextCheckMinutes: cooldownMin };
      }
    }
  }

  /** Test helper: manually set dismissed state */
  _setDismissed(userId: string, value: boolean): void {
    const state = this.states.get(userId);
    if (state) state.dismissed = value;
  }

  static isNightModeForHour(hour: number): boolean {
    return hour >= 23 || hour < 6;
  }

  static isNightMode(): boolean {
    return ActivityTracker.isNightModeForHour(new Date().getHours());
  }

  private getBypassCooldown(count: number): number {
    if (count <= 1) return 30;
    if (count === 2) return 45;
    return -1; // disabled
  }
}
