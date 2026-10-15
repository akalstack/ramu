import { ElicitRequestFormParamsSchema } from '@modelcontextprotocol/sdk/types.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import type { JsonSchemaType } from '@modelcontextprotocol/sdk/validation/types'
import type { AgentElicitation, ElicitationField } from '@ramu/shared/types'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a form object.')
  return value as ObjectValue
}

export function elicitationRequest(requestId: string, input: unknown): AgentElicitation {
  const p = object(input)
  if (typeof p.serverName !== 'string' || typeof p.message !== 'string')
    throw new Error('Missing server name or request message.')
  if (p.mode === 'url') {
    if (typeof p.url !== 'string' || typeof p.elicitationId !== 'string')
      throw new Error('Missing link request details.')
    const url = new URL(p.url)
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('This request uses an unsupported link protocol.')
    return { requestId, serverName: p.serverName, message: p.message, mode: 'url', url: url.href, fields: [] }
  }
  if (p.mode !== undefined && !['form', 'openai/form', 'openaiForm'].includes(String(p.mode)))
    throw new Error('This request uses an unsupported input mode.')
  const raw = object(p.requestedSchema)
  if (Object.keys(raw).some((key) => !['$schema', 'type', 'properties', 'required'].includes(key)))
    throw new Error('This request uses unsupported form constraints.')
  const parsed = ElicitRequestFormParamsSchema.parse({
    mode: 'form',
    message: p.message,
    requestedSchema: raw,
  }).requestedSchema
  const properties = object(raw.properties)
  if (Object.keys(properties).length > 100) throw new Error('This form has too many fields.')
  if (parsed.required?.some((key) => !Object.hasOwn(properties, key)))
    throw new Error('The form requires an unknown field.')
  const fields: ElicitationField[] = Object.entries(properties).map(([id, value]) => {
    const original = object(value)
    const field = object(parsed.properties[id])
    if (Object.keys(original).some((key) => !Object.hasOwn(field, key)))
      throw new Error(`Unsupported constraints for ${id}.`)
    const originalChoices = field.type === 'array' ? object(original.items) : original
    const alternatives = originalChoices.oneOf ?? originalChoices.anyOf
    if (
      Array.isArray(alternatives) &&
      alternatives.some((entry) =>
        Object.keys(object(entry)).some((key) => !['const', 'title', 'description'].includes(key)),
      )
    )
      throw new Error(`Unsupported choices for ${id}.`)
    const enumSource = field.type === 'array' ? object(field.items) : field
    const options = Array.isArray(enumSource.enum)
      ? enumSource.enum.map((value, index) => ({
          value: String(value),
          label: Array.isArray(enumSource.enumNames) ? String(enumSource.enumNames[index] ?? value) : String(value),
        }))
      : Array.isArray(enumSource.oneOf ?? enumSource.anyOf)
        ? ((enumSource.oneOf ?? enumSource.anyOf) as unknown[]).map((value) => {
            const entry = object(value)
            return { value: String(entry.const), label: String(entry.title ?? entry.const) }
          })
        : []
    if (field.type === 'array' && !options.length) throw new Error('Only arrays of predefined choices are supported.')
    if (original.items && Object.keys(object(original.items)).some((key) => !Object.hasOwn(object(field.items), key)))
      throw new Error(`Unsupported choices for ${id}.`)
    return {
      id,
      label: typeof field.title === 'string' ? field.title : id,
      description: typeof field.description === 'string' ? field.description : undefined,
      type: field.type as ElicitationField['type'],
      required: parsed.required?.includes(id) ?? false,
      options,
      ...(field.default !== undefined
        ? { defaultValue: field.type === 'array' ? JSON.stringify(field.default) : String(field.default) }
        : {}),
    }
  })
  // Strip schema-dialect hints: this restricted MCP schema uses only primitive draft-7-compatible constraints.
  const schema = {
    type: 'object',
    properties: parsed.properties,
    required: parsed.required ?? [],
    additionalProperties: false,
  }
  new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType)
  return { requestId, serverName: p.serverName, message: p.message, mode: 'form', fields, schema }
}

export function elicitationContent(
  request: AgentElicitation,
  answers: Record<string, string>,
): Record<string, unknown> | null {
  if (request.mode === 'url') return null
  const content: Record<string, unknown> = Object.create(null)
  if (Object.keys(answers).some((key) => !request.fields.some((field) => field.id === key)))
    throw new Error('The answer contains an unknown field.')
  for (const field of request.fields) {
    if (field.required && !Object.hasOwn(answers, field.id)) throw new Error(`Enter a value for ${field.label}.`)
    const text = answers[field.id] ?? ''
    if (!text.length && !field.required) continue
    if (field.type === 'boolean') {
      if (!['true', 'false'].includes(text)) throw new Error(`Choose Yes or No for ${field.label}.`)
      content[field.id] = text === 'true'
    } else if (field.type === 'number' || field.type === 'integer') {
      if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`Enter a valid number for ${field.label}.`)
      content[field.id] = Number(text)
    } else if (field.type === 'array') {
      try {
        const value: unknown = JSON.parse(text || '[]')
        if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) throw new Error()
        content[field.id] = value
      } catch {
        throw new Error(`Select valid choices for ${field.label}.`)
      }
    } else content[field.id] = text
  }
  const result = new AjvJsonSchemaValidator().getValidator(request.schema as JsonSchemaType)(content)
  if (!result.valid) {
    const explanation = result.errorMessage.replace(/data\/([^\s,]+)/g, (_match, path: string) => {
      const key = path.split('/')[0]!.replace(/~1/g, '/').replace(/~0/g, '~')
      return request.fields.find((field) => field.id === key)?.label ?? key
    })
    throw new Error(`Check the form: ${explanation}`)
  }
  return content
}
