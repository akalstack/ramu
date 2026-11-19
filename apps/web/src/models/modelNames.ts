/** A model's name as Ramu shows it: GPT names capitalized as OpenAI writes them, and no provider said twice. */
export const modelDisplayName = (name: string) =>
  name
    // OpenCode can name a model with its provider repeated, as "9router/9Router Auto"; once is enough. A prefix that
    // says something else ("opencode/Tidepool Alpha") stays, since it tells routes apart.
    .replace(/^([^/\s]+)\/(?=\1)/i, '')
    .replace(/^gpt-/i, 'GPT-')
    .replace(
      /-(sol|luna|astra|terra)\b/gi,
      (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}`,
    )
