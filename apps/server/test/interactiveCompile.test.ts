import { expect, it } from 'vitest'
import { compileInteractive } from '../src/interactive/compile'

it('bundles TSX, local modules, CSS, JSON and imported images without a runtime CDN', async () => {
  const html = await compileInteractive([
    { path: 'index.html', content: '<div id="root"></div><script type="module" src="./src/main.tsx"></script>' },
    {
      path: 'src/main.tsx',
      content: `import {createRoot} from 'react-dom/client'; import {value} from './value'; import './style.css'; import image from './image.svg'; createRoot(document.getElementById('root')!).render(<div><img src={image}/>{value}</div>)`,
    },
    { path: 'src/value.ts', content: `import data from './data.json'; export const value: number = data.value` },
    { path: 'src/data.json', content: '{"value":42}' },
    { path: 'src/style.css', content: 'div { color: red }' },
    { path: 'src/image.svg', content: '<svg xmlns="http://www.w3.org/2000/svg"/>' },
  ])
  expect(html).toContain('<style>')
  expect(html).toContain('data:image/svg+xml')
  expect(html).not.toMatch(/<script[^>]*src=/)
  expect(html).not.toContain('process.env')
  expect(html).not.toContain('type="module"')
})
it('bundles curated chart and diagram libraries', async () => {
  const html = await compileInteractive([
    { path: 'index.html', content: '<script type="module" src="./main.ts"></script>' },
    {
      path: 'main.ts',
      content: `import Chart from 'chart.js/auto'; import dagre from '@dagrejs/dagre'; window.example = [Chart, dagre.layout]`,
    },
  ])
  expect(html).toContain('<script>')
  expect(html.length).toBeGreaterThan(1000)
  expect(html).not.toContain('https://cdn.')
})
it.each(['node:fs', '/etc/passwd', '../../secret', 'https://cdn.example.com/app.js', 'unapproved-library'])(
  'rejects author-controlled imports outside the virtual project: %s',
  async (target) => {
    await expect(
      compileInteractive([
        { path: 'index.html', content: '<script type="module" src="./main.js"></script>' },
        { path: 'main.js', content: `import value from ${JSON.stringify(target)}; console.log(value)` },
      ]),
    ).rejects.toThrow()
  },
)

it('runs bundled React, charts and diagrams offline through the real isolated renderer', async () => {
  const { interactiveBrowserPath, previewInteractive } = await import('../src/interactive/preview')
  if (!interactiveBrowserPath()) return
  const html = await compileInteractive([
    {
      path: 'index.html',
      content:
        '<html><head><script type="module" src="./main.tsx"></script></head><body><div id="root"></div></body></html>',
    },
    {
      path: 'main.tsx',
      content: `
      import {useEffect, useRef, useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import Chart from 'chart.js/auto';
      import dagre from '@dagrejs/dagre';
      const graph = new dagre.graphlib.Graph().setGraph({}).setDefaultEdgeLabel(()=>({}));
      graph.setNode('start',{width:80,height:30}); graph.setNode('end',{width:80,height:30}); graph.setEdge('start','end'); dagre.layout(graph);
      function App(){const [count,setCount]=useState(2); const canvas=useRef(null);
        useEffect(()=>{const chart=new Chart(canvas.current,{type:'bar',data:{labels:['Capacity'],datasets:[{data:[count]}]},options:{responsive:false,animation:false}});return ()=>chart.destroy()},[count]);
        return <div><button onClick={()=>setCount(count+1)}>Add capacity</button><output>Capacity: {count}</output><canvas ref={canvas} width="250" height="160"/><svg width="250" height="120" role="img" aria-label="Start to end flow"><path d="M40 20 L40 90" stroke="currentColor"/></svg></div>}
      createRoot(document.getElementById('root')).render(<App/>);
    `,
    },
  ])
  const result = await previewInteractive(
    html,
    [{ action: 'click', label: 'Add capacity', expect: 'Capacity: 3' }],
    undefined,
    { resources: [], connect: [] },
  )
  expect(result.errors).toEqual([])
  expect(result.failedRequests).toEqual([])
  expect(result.checks[0]?.passed).toBe(true)
  expect(result.layouts?.every((layout) => !layout.overflow)).toBe(true)
  expect(result.lightScreenshot).toMatch(/^data:image\/png;base64,/)
}, 30_000)
