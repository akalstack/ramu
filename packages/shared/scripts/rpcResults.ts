// Writes `src/rpcResults.generated.ts`: the shape of every RPC method's declared result, read from `RamuMethods` with
// the TypeScript checker, so clients can check what a host answers. Run `pnpm --filter @ramu/shared rpc-results`
// after changing a method's result type; a test fails while the file is out of date.
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import type { RpcShape } from '../src/rpcResults'

/** Types a host and a client of different versions are expected to disagree on, by design. */
const SKEWED_TYPES = ['AppPreferences', 'ModelPreferences']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const RESULTS_FILE = join(root, 'src', 'rpcResults.generated.ts')

/** The shapes of every method's result, with object types shared by index. */
export function rpcResultShapes(): { methods: Record<string, number>; shapes: RpcShape[] } {
  const program = ts.createProgram([join(root, 'src', 'api.ts')], {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true,
  })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(join(root, 'src', 'api.ts'))!
  let methodsType: ts.Type | undefined
  ts.forEachChild(source, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'RamuMethods')
      methodsType = checker.getTypeAtLocation(node)
  })
  if (!methodsType) throw new Error('RamuMethods not found in api.ts')

  const shapes: RpcShape[] = []
  const keys = new Map<string, number>()
  const seen = new Map<ts.Type, number>()
  const any = add({ k: 'any' })

  function add(shape: RpcShape): number {
    const key = JSON.stringify(shape)
    const known = keys.get(key)
    if (known !== undefined) return known
    shapes.push(shape)
    keys.set(key, shapes.length - 1)
    return shapes.length - 1
  }

  function shapeOf(type: ts.Type, depth = 0): number {
    if (depth > 40) return any
    const flags = type.flags
    if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) return any
    if (flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return add({ k: 'undefined' })
    if (flags & ts.TypeFlags.Null) return add({ k: 'null' })
    if (flags & ts.TypeFlags.StringLiteral) return add({ k: 'literal', v: (type as ts.StringLiteralType).value })
    if (flags & ts.TypeFlags.NumberLiteral) return add({ k: 'literal', v: (type as ts.NumberLiteralType).value })
    if (flags & ts.TypeFlags.BooleanLiteral) return add({ k: 'literal', v: checker.typeToString(type) === 'true' })
    if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral | ts.TypeFlags.StringMapping))
      return add({ k: 'string' })
    if (flags & (ts.TypeFlags.Number | ts.TypeFlags.Enum | ts.TypeFlags.EnumLiteral)) return add({ k: 'number' })
    if (flags & ts.TypeFlags.Boolean) return add({ k: 'boolean' })
    if (flags & (ts.TypeFlags.BigInt | ts.TypeFlags.ESSymbol | ts.TypeFlags.UniqueESSymbol)) return any
    if (type.isUnion()) {
      const members = [...new Set(type.types.map((member) => shapeOf(member, depth + 1)))]
      return members.includes(any) ? any : members.length === 1 ? members[0]! : add({ k: 'union', of: members.sort() })
    }
    if (type.isIntersection()) return objectShape(type, depth)
    if (flags & ts.TypeFlags.Object) {
      if (checker.isTupleType(type)) {
        const items = checker.getTypeArguments(type as ts.TypeReference).map((item) => shapeOf(item, depth + 1))
        return add({ k: 'tuple', of: items })
      }
      if (checker.isArrayType(type)) {
        const item = checker.getTypeArguments(type as ts.TypeReference)[0]
        return add({ k: 'array', of: item ? shapeOf(item, depth + 1) : any })
      }
      const name = type.getSymbol()?.getName()
      // Values JSON cannot carry exactly, and functions, are not checked.
      if (name && ['Date', 'Map', 'Set', 'Promise', 'Buffer', 'Uint8Array', 'ArrayBuffer'].includes(name)) return any
      // Preferences gain fields every release and are read through the settings compatibility layer, which fills
      // what an older or newer host leaves out; checking them strictly would close Settings over one new field.
      if (name && SKEWED_TYPES.includes(name)) return any
      if (type.getCallSignatures().length) return any
      return objectShape(type, depth)
    }
    return any
  }

  function objectShape(type: ts.Type, depth: number): number {
    const placeholder = seen.get(type)
    if (placeholder !== undefined) return placeholder
    // A recursive type points at its own entry, filled in once its members are known.
    const index = shapes.push({ k: 'any' }) - 1
    seen.set(type, index)
    const properties: Record<string, [number, 0 | 1]> = {}
    for (const property of checker.getPropertiesOfType(type)) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0]
      const member = declaration
        ? checker.getTypeOfSymbolAtLocation(property, declaration)
        : checker.getTypeOfSymbol(property)
      if (member.getCallSignatures().length && !(member.flags & ts.TypeFlags.Union)) continue
      const optional = (property.flags & ts.SymbolFlags.Optional) !== 0
      properties[property.name] = [shapeOf(member, depth + 1), optional ? 1 : 0]
    }
    const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String)
    shapes[index] = {
      k: 'object',
      p: properties,
      ...(indexType ? { rest: shapeOf(indexType, depth + 1) } : {}),
    }
    return index
  }

  const methods: Record<string, number> = {}
  for (const property of checker.getPropertiesOfType(methodsType)) {
    const member = checker.getTypeOfSymbolAtLocation(property, source)
    const signature = member.getCallSignatures()[0]
    if (!signature) continue
    const returned = signature.getReturnType()
    const awaited = checker.getAwaitedType(returned) ?? returned
    methods[property.name] = shapeOf(awaited)
  }
  return { methods: Object.fromEntries(Object.entries(methods).sort(([a], [b]) => a.localeCompare(b))), shapes }
}

export const rpcResultsSource = () =>
  `// Generated by packages/shared/scripts/rpcResults.ts from RamuMethods. Do not edit.\nimport type { RpcResultShapes } from './rpcResults'\n\nexport const RPC_RESULTS: RpcResultShapes = JSON.parse(${JSON.stringify(JSON.stringify(rpcResultShapes()))})\n`

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(RESULTS_FILE, rpcResultsSource())
  console.log(`Wrote ${RESULTS_FILE}`)
}
