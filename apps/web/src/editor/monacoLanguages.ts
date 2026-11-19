// Syntax grammars load on demand. No language workers, formatters or LSP clients.
import 'monaco-editor/languages/definitions/abap/register.js'
import 'monaco-editor/languages/definitions/apex/register.js'
import 'monaco-editor/languages/definitions/azcli/register.js'
import 'monaco-editor/languages/definitions/bat/register.js'
import 'monaco-editor/languages/definitions/bicep/register.js'
import 'monaco-editor/languages/definitions/cameligo/register.js'
import 'monaco-editor/languages/definitions/clojure/register.js'
import 'monaco-editor/languages/definitions/coffee/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/csharp/register.js'
import 'monaco-editor/languages/definitions/csp/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/cypher/register.js'
import 'monaco-editor/languages/definitions/dart/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/ecl/register.js'
import 'monaco-editor/languages/definitions/elixir/register.js'
import 'monaco-editor/languages/definitions/flow9/register.js'
import 'monaco-editor/languages/definitions/fsharp/register.js'
import 'monaco-editor/languages/definitions/freemarker2/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/graphql/register.js'
import 'monaco-editor/languages/definitions/handlebars/register.js'
import 'monaco-editor/languages/definitions/hcl/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/definitions/julia/register.js'
import 'monaco-editor/languages/definitions/kotlin/register.js'
import 'monaco-editor/languages/definitions/less/register.js'
import 'monaco-editor/languages/definitions/lexon/register.js'
import 'monaco-editor/languages/definitions/lua/register.js'
import 'monaco-editor/languages/definitions/liquid/register.js'
import 'monaco-editor/languages/definitions/m3/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/mdx/register.js'
import 'monaco-editor/languages/definitions/mips/register.js'
import 'monaco-editor/languages/definitions/msdax/register.js'
import 'monaco-editor/languages/definitions/mysql/register.js'
import 'monaco-editor/languages/definitions/objective-c/register.js'
import 'monaco-editor/languages/definitions/pascal/register.js'
import 'monaco-editor/languages/definitions/pascaligo/register.js'
import 'monaco-editor/languages/definitions/perl/register.js'
import 'monaco-editor/languages/definitions/pgsql/register.js'
import 'monaco-editor/languages/definitions/php/register.js'
import 'monaco-editor/languages/definitions/pla/register.js'
import 'monaco-editor/languages/definitions/postiats/register.js'
import 'monaco-editor/languages/definitions/powerquery/register.js'
import 'monaco-editor/languages/definitions/powershell/register.js'
import 'monaco-editor/languages/definitions/protobuf/register.js'
import 'monaco-editor/languages/definitions/pug/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/qsharp/register.js'
import 'monaco-editor/languages/definitions/r/register.js'
import 'monaco-editor/languages/definitions/razor/register.js'
import 'monaco-editor/languages/definitions/redis/register.js'
import 'monaco-editor/languages/definitions/redshift/register.js'
import 'monaco-editor/languages/definitions/restructuredtext/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/sb/register.js'
import 'monaco-editor/languages/definitions/scala/register.js'
import 'monaco-editor/languages/definitions/scheme/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/solidity/register.js'
import 'monaco-editor/languages/definitions/sophia/register.js'
import 'monaco-editor/languages/definitions/sparql/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/st/register.js'
import 'monaco-editor/languages/definitions/swift/register.js'
import 'monaco-editor/languages/definitions/systemverilog/register.js'
import 'monaco-editor/languages/definitions/tcl/register.js'
import 'monaco-editor/languages/definitions/twig/register.js'
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/typespec/register.js'
import 'monaco-editor/languages/definitions/vb/register.js'
import 'monaco-editor/languages/definitions/wgsl/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
import { editor, languages } from 'monaco-editor/editor/editor.api.js'

// JSON has no basic-language registration in Monaco; keep its highlighting local.
languages.register({
  id: 'json',
  extensions: ['.json', '.jsonc', '.jsonl', '.bowerrc', '.jshintrc', '.jscsrc', '.eslintrc', '.babelrc'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json'],
})
languages.setLanguageConfiguration('json', {
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
})
languages.setMonarchTokensProvider('json', {
  tokenizer: {
    root: [
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
      [/"(?:[^"\\]|\\.)*"/, 'string.value'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
    ],
    comment: [
      [/[^*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/\*/, 'comment'],
    ],
  },
})

// Monaco files .tsx and .jsx under typescript and javascript, whose TextMate grammars read `<button>` as a type
// assertion. Separate React languages take those extensions (the later registration wins) and share the Monarch
// configuration and fallback tokenizer, so only Shiki's tsx and jsx grammars color them.
const REACT = {
  typescriptreact: [
    '.tsx',
    ['TypeScript React', 'tsx'],
    () => import('monaco-editor/languages/definitions/typescript/typescript.js'),
  ],
  javascriptreact: [
    '.jsx',
    ['JavaScript React', 'jsx'],
    () => import('monaco-editor/languages/definitions/javascript/javascript.js'),
  ],
} as const
const reactReady = new Map<string, Promise<void>>()
const loadReact = (id: keyof typeof REACT) => {
  let ready = reactReady.get(id)
  if (!ready) {
    ready = REACT[id][2]().then(({ conf, language }) => {
      languages.setLanguageConfiguration(id, conf)
      languages.setMonarchTokensProvider(id, language)
    })
    reactReady.set(id, ready)
  }
  return ready
}
for (const id of Object.keys(REACT) as (keyof typeof REACT)[]) {
  languages.register({ id, extensions: [REACT[id][0]], aliases: [...REACT[id][1]] })
  languages.onLanguage(id, () => void loadReact(id))
}

/**
 * Resolves once Monaco has installed the language's own tokenizer. Monaco registers it lazily, after anything set
 * before then, so a replacement tokenizer has to wait for it.
 */
export async function monarchReady(id: string) {
  if (id in REACT) await loadReact(id as keyof typeof REACT)
  else await editor.colorize('', id, {})
}
