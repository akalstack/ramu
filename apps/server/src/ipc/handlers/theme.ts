import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DEFAULT_AGENT_SETTINGS, type ModelPreferences } from '@ramu/shared/types'
import { parseTheme, type ThemeIssue, type RamuTheme } from '@ramu/shared/theme'
import { NO_LOCKED_ROLES, readGeneratedTheme, themePrompt } from '@ramu/shared/themeGeneration'
import type { RegisterHandlers } from '../types'

/** One draft plus at most this many repair rounds; a draft that still fails is returned with its failures. */
const REPAIR_ROUNDS = 2

/** The directions `theme.candidates` asks for, so its drafts differ on purpose. */
const DIRECTIONS = [
  'Keep the wish faithful and balanced.',
  'Take the wish in a softer, lower-contrast-feeling direction (still readable).',
  'Take the wish in a bolder, more saturated direction.',
]

const roles = z.array(z.string().max(40)).max(40)
type LockedArg = { light: string[]; dark: string[] }

const brief = z.string().trim().min(1).max(2000)
const lockedRoles = z.object({ light: roles, dark: roles }).optional()
const references = z.array(z.string().min(1).max(100)).max(3).optional()
const GENERATE_ARGS = z.tuple([brief, z.unknown(), lockedRoles, z.string().max(2000).optional(), references])
const CANDIDATE_ARGS = z.tuple([brief, z.unknown(), lockedRoles, references])

/**
 * Theme drafts from the host's provider. This only makes candidate data: the device validates, previews and applies it,
 * and nothing here touches an installed theme or any file.
 */
export const registerThemeHandlers: RegisterHandlers = ({ workspace, agents, storedPreferences, attachmentStore }) => {
  const settings = () => {
    const modelPrefs = workspace.getAppState<ModelPreferences | null>('model-preferences', null)
    const step = modelPrefs?.sets
      .find((set) => set.id === modelPrefs.defaultSetId)
      ?.steps.find((s) => s.id === modelPrefs.defaultStepId)
    return {
      ...DEFAULT_AGENT_SETTINGS,
      ...(step ? { provider: step.provider, model: step.model, effort: step.effort } : {}),
      ...(storedPreferences().intelligence?.maintenanceModel ?? {}),
    }
  }

  const draft = async (
    brief: string,
    rawSeed: unknown,
    rawLocked?: LockedArg,
    feedback?: string,
    referenceIds: string[] = [],
  ) => {
    // Only images count: a reference is a picture to take a mood from, never a document to read instructions from.
    const images = attachmentStore.resolve(referenceIds).filter((file) => file.mimeType.startsWith('image/'))
    const seed = parseTheme(rawSeed)
    if (!seed.ok) throw new Error(seed.error)
    const locked = rawLocked ? (rawLocked as typeof NO_LOCKED_ROLES) : NO_LOCKED_ROLES
    const model = settings()
    const id = `ai-${randomUUID().slice(0, 8)}`
    let previous: RamuTheme | undefined
    let issues: ThemeIssue[] = []
    let last: { theme: RamuTheme; provider: string; model: string } | undefined
    for (let round = 0; round <= REPAIR_ROUNDS; round++) {
      const reply = await agents.analyze(
        themePrompt({ brief, seed: seed.theme, locked, feedback, previous, issues, images: images.length }),
        model,
        40_000,
        { timeoutMs: 90_000, defer: false, ...(images.length ? { attachments: images } : {}) },
      )
      const read = readGeneratedTheme(reply.message, seed.theme, locked, id)
      if (!read.ok) {
        if (round === REPAIR_ROUNDS) throw new Error(last ? 'The model stopped returning a usable theme.' : read.error)
        continue
      }
      last = { theme: read.theme, provider: reply.provider, model: reply.model }
      previous = read.theme
      issues = read.issues
      if (!issues.length) break
    }
    if (!last) throw new Error('The model did not return a theme.')
    return { ...last, issues }
  }

  return {
    'theme.generate': {
      args: GENERATE_ARGS,
      run: (brief: string, rawSeed: unknown, rawLocked?: LockedArg, feedback?: string, referenceIds?: string[]) =>
        draft(brief, rawSeed, rawLocked, feedback, referenceIds),
    },
    /** Three differently-directed drafts at once, to choose between. Each costs a draft's usage. */
    'theme.candidates': {
      args: CANDIDATE_ARGS,
      run: (brief: string, rawSeed: unknown, rawLocked?: LockedArg, referenceIds?: string[]) =>
        Promise.allSettled(
          DIRECTIONS.map((direction) => draft(brief, rawSeed, rawLocked, direction, referenceIds)),
        ).then((results) => results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))),
    },
  }
}
