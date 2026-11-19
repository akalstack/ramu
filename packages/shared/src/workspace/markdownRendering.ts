import { defaultUrlTransform, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkFrontmatter from 'remark-frontmatter'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

export const previewRemarkPlugins: Options['remarkPlugins'] = [remarkGfm, [remarkFrontmatter, ['yaml', 'toml']]]
export const previewRehypePlugins: Options['rehypePlugins'] = [
  rehypeRaw,
  [
    rehypeSanitize,
    {
      ...defaultSchema,
      tagNames: [...(defaultSchema.tagNames ?? []), 'picture', 'source'],
      attributes: {
        ...defaultSchema.attributes,
        details: [...(defaultSchema.attributes?.details ?? []), ['className', 'md-frontmatter']],
        source: ['srcSet', 'media', 'type', 'sizes'],
        img: [...(defaultSchema.attributes?.img ?? []), 'srcSet', 'sizes'],
      },
    },
  ],
]

const frontmatter: NonNullable<NonNullable<NonNullable<Options['remarkRehypeOptions']>['handlers']>['yaml']> = (
  _state,
  node,
) => ({
  type: 'element',
  tagName: 'details',
  properties: { className: ['md-frontmatter'] },
  children: [
    { type: 'element', tagName: 'summary', properties: {}, children: [{ type: 'text', value: 'Frontmatter' }] },
    {
      type: 'element',
      tagName: 'pre',
      properties: {},
      children: [{ type: 'text', value: 'value' in node ? String(node.value) : '' }],
    },
  ],
})
const frontmatterHandlers = { yaml: frontmatter, toml: frontmatter }
export const previewRemarkRehypeOptions: Options['remarkRehypeOptions'] = { handlers: frontmatterHandlers }

export const previewUrlTransform = (url: string) => defaultUrlTransform(url)
