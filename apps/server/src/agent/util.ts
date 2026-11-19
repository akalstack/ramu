/** Non-empty string, else undefined. */
export const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Rejects with `message` when `promise` has not settled within `ms`. */
export async function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
