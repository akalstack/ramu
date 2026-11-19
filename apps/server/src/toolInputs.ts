import { z } from 'zod'

// Keep discovery, memory search and conversation recall consistent without increasing default output sizes.
export const toolQuery = z.string().max(4000).describe('Search keywords, up to 4,000 characters.')
export const toolResultLimit = z.number().int().min(1).max(100).describe('Number of results, from 1 to 100.')
