/**
 * The two WorkBuddy desktop apps this extension serves.
 *
 * Both are the same client framework in different regions and write their
 * sign-in into the *same* shared `CodeBuddyExtension` auth directory; they
 * differ by auth-file basename, endpoint, catalog identity, and display name.
 * Everything that varies is collected here so no module carries its own
 * `if (international)` branch.
 *
 * @module pi-workbuddy-connect/variants
 */

/** Upstream region, decided by the credential's login domain. */
export type WorkBuddyRegion = 'cn' | 'global'

/** One WorkBuddy product variant. */
export interface WorkBuddyVariant {
  /** Provider id registered with Pi: `workbuddy` or `workbuddy-ai`. */
  id: string
  /** Model-group heading and status title. */
  displayName: string
  /** Desktop app name as users know it, for diagnostics and error copy. */
  appName: string
  /** Which region this variant's credentials must belong to. */
  region: WorkBuddyRegion
  /** Env var overriding the desktop auth-file location. */
  authFileEnv: string
  /** Env var naming an explicit Electron binary for this product. */
  electronEnv: string
  /** Basename of the desktop app's own auth file. */
  desktopFilename: string
  /** Basename of the plugin-owned credential copy under the agent dir. */
  ownFilename: string
  /** macOS App bundle and the Electron binary inside it. */
  macOS: {
    bundle: string
    electronPath: string
  }
}

/** CN WorkBuddy first: the existing provider id and paths. */
export const CN_VARIANT: WorkBuddyVariant = {
  id: 'workbuddy',
  displayName: 'WorkBuddy',
  appName: 'WorkBuddy',
  region: 'cn',
  authFileEnv: 'WORKBUDDY_AUTH_FILE',
  electronEnv: 'WORKBUDDY_ELECTRON_BIN',
  desktopFilename: 'workbuddy-desktop.info',
  ownFilename: '.workbuddy-auth.json',
  macOS: {
    bundle: '/Applications/WorkBuddy.app',
    electronPath: '/Applications/WorkBuddy.app/Contents/MacOS/Electron',
  },
}

/** International WorkBuddy AI. */
export const AI_VARIANT: WorkBuddyVariant = {
  id: 'workbuddy-ai',
  displayName: 'WorkBuddy AI',
  appName: 'WorkBuddy AI',
  region: 'global',
  authFileEnv: 'WORKBUDDY_AI_AUTH_FILE',
  electronEnv: 'WORKBUDDY_AI_ELECTRON_BIN',
  desktopFilename: 'workbuddy-desktop-ai.info',
  ownFilename: '.workbuddy-ai-auth.json',
  macOS: {
    bundle: '/Applications/WorkBuddy AI.app',
    electronPath: '/Applications/WorkBuddy AI.app/Contents/MacOS/Electron',
  },
}

/** Both variants, CN first. */
export const WORKBUDDY_VARIANTS = [CN_VARIANT, AI_VARIANT] as const

/** Region implied by a login domain; empty means CN, matching upstream tooling. */
export function regionOf(domain: string): WorkBuddyRegion {
  const lowered = domain.trim().toLowerCase()
  return lowered === 'workbuddy.ai' || lowered.endsWith('.workbuddy.ai') ? 'global' : 'cn'
}
