/**
 * User Preferences (F166)
 * UI-level preferences persisted to .agent-studio/user-preferences.json.
 * Separate from agent-catalog.json (configuration, not preference).
 */

export interface UserPreferences {
  /** F166: Custom display order of agents. agentIds not in this list fall back to agent-template.json order. */
  agentOrder?: string[];
}
