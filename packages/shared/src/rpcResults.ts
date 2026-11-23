// What a host may answer each RPC method with, generated from `RamuMethods` by `scripts/rpcResults.ts`. A client
// checks every result against it, so a host on another version that answers in a shape this app does not know fails
// with the method and the field named, instead of breaking a screen later.

/** One shape: object shapes are shared by index, so recursive and repeated types are written once. */
export type RpcShape =
  | { k: 'any' | 'string' | 'number' | 'boolean' | 'null' | 'undefined' }
  | { k: 'literal'; v: string | number | boolean }
  | { k: 'union' | 'tuple'; of: number[] }
  | { k: 'array'; of: number }
  | { k: 'object'; p: Record<string, [number, 0 | 1]>; rest?: number }

export interface RpcResultShapes {
  methods: Record<string, number>
  shapes: RpcShape[]
}

const describe = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'a list' : value === undefined ? 'nothing' : typeof value

/** Where `value` departs from shape `index`, as a field path and what was expected, or null when it fits. */
export function rpcMismatch(
  table: RpcResultShapes,
  index: number,
  value: unknown,
  path = 'result',
  depth = 0,
): string | null {
  const shape = table.shapes[index]
  if (!shape || depth > 60) return null
  switch (shape.k) {
    case 'any':
      return null
    case 'string':
    case 'number':
    case 'boolean':
      return typeof value === shape.k ? null : `${path}: expected a ${shape.k}, got ${describe(value)}`
    case 'null':
      return value === null ? null : `${path}: expected null, got ${describe(value)}`
    // JSON drops undefined, and a host may send null where a field is left out.
    case 'undefined':
      return value === undefined || value === null ? null : `${path}: expected nothing, got ${describe(value)}`
    case 'literal':
      return value === shape.v
        ? null
        : `${path}: expected ${JSON.stringify(shape.v)}, got ${JSON.stringify(value)?.slice(0, 60)}`
    case 'union': {
      const misses = shape.of.map((member) => rpcMismatch(table, member, value, path, depth + 1))
      if (misses.includes(null)) return null
      // A value that is there departs from the member it was meant to be, not from "nothing": name that field.
      const present = value !== undefined && value !== null
      const telling = misses.filter(
        (miss, index) => !present || !['undefined', 'null'].includes(table.shapes[shape.of[index]!]?.k ?? ''),
      )
      return (telling.length ? telling : misses).sort((a, b) => b!.length - a!.length)[0] ?? null
    }
    case 'array':
      if (!Array.isArray(value)) return `${path}: expected a list, got ${describe(value)}`
      for (let i = 0; i < value.length; i++) {
        const miss = rpcMismatch(table, shape.of, value[i], `${path}[${i}]`, depth + 1)
        if (miss) return miss
      }
      return null
    case 'tuple':
      if (!Array.isArray(value)) return `${path}: expected a list, got ${describe(value)}`
      for (const [i, item] of shape.of.entries()) {
        const miss = rpcMismatch(table, item, value[i], `${path}[${i}]`, depth + 1)
        if (miss) return miss
      }
      return null
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return `${path}: expected an object, got ${describe(value)}`
      const record = value as Record<string, unknown>
      for (const [name, [member, optional]] of Object.entries(shape.p)) {
        const field = record[name]
        // A field a newer host added is fine; one this app needs and did not get is not.
        if (field === undefined || (optional && field === null)) {
          if (optional) continue
          const miss = rpcMismatch(table, member, undefined, `${path}.${name}`, depth + 1)
          if (miss) return `${path}.${name}: missing`
          continue
        }
        const miss = rpcMismatch(table, member, field, `${path}.${name}`, depth + 1)
        if (miss) return miss
      }
      if (shape.rest !== undefined)
        for (const [name, field] of Object.entries(record)) {
          if (name in shape.p) continue
          const miss = rpcMismatch(table, shape.rest, field, `${path}.${name}`, depth + 1)
          if (miss) return miss
        }
      return null
    }
  }
}

/** Thrown for a host's answer whose shape this app does not know. */
export class RpcResultError extends Error {
  constructor(
    readonly method: string,
    readonly detail: string,
  ) {
    super(`The host answered ${method} in a shape this app does not know (${detail}). Update Ramu here or on the host.`)
  }
}

/** Checks one method's result; a method the table does not list (an older or newer one) is not checked. */
export function checkRpcResult(table: RpcResultShapes, method: string, value: unknown): void {
  const index = table.methods[method]
  if (index === undefined) return
  const miss = rpcMismatch(table, index, value)
  if (miss) throw new RpcResultError(method, miss)
}
