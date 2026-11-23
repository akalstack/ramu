import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname } from 'node:path'
import { z } from 'zod'

const MAX_NAME = 60

/** The computer's own name, without the `.local` a Mac adds; a cloud machine's can be a long internal address. */
export const systemHostName = () => hostname().replace(/\.local$/i, '') || 'Ramu host'

/** A name a person typed: one line, no control characters, bounded; empty means none. */
export const cleanHostName = (name: string) =>
  name
    .replace(/\s+/g, ' ')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME)

export const hostNameInput = z.string().max(200).nullable()

/**
 * What this host is called wherever it names itself: to devices that pair or find it nearby, on the Ramu account, and
 * to hosts that start threads here. The person may choose it; without a choice it is the computer's own name.
 */
export class HostName {
  private chosen: string | null | undefined

  constructor(private readonly path: string) {}

  custom(): string | null {
    if (this.chosen !== undefined) return this.chosen
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8')) as { name?: unknown }
      this.chosen = typeof saved.name === 'string' && cleanHostName(saved.name) ? cleanHostName(saved.name) : null
    } catch {
      this.chosen = null
    }
    return this.chosen
  }

  display(): string {
    return this.custom() ?? systemHostName()
  }

  /** Chooses a name, or with `null` (or nothing but spaces) goes back to the computer's own. */
  set(name: string | null): void {
    const next = name === null ? null : cleanHostName(name) || null
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    writeFileSync(this.path, JSON.stringify({ name: next }), { mode: 0o600 })
    this.chosen = next
  }

  info(): { name: string; systemName: string; custom: boolean } {
    return { name: this.display(), systemName: systemHostName(), custom: this.custom() !== null }
  }
}

let current: HostName | null = null

/** Makes `names` the host's name for the whole service; done once at startup. */
export function useHostName(names: HostName): void {
  current = names
}

/** What this host is called, for services that name it to other hosts. */
export const hostDisplayName = () => current?.display() ?? systemHostName()
