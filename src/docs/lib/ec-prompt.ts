// Expressive Code plugin for terminal blocks: lines starting with `$ ` are commands. The `$` is
// drawn by CSS and the copy button copies the commands only, without output lines.
import { definePlugin, type ExpressiveCodeBlock } from '@expressive-code/core'
import type { Element, ElementContent } from 'hast'
import { displayHtml } from './display.ts'

const SHELL = new Set(['sh', 'bash', 'shell', 'zsh', 'shellscript', 'powershell', 'ps1'])
const commands = new WeakMap<ExpressiveCodeBlock, Set<number>>()

const isTerminal = (block: ExpressiveCodeBlock): boolean => {
  // `frame` is a prop of the frames plugin, typed there.
  const frame = (block.props as { frame?: string }).frame
  return frame === 'terminal' || (frame !== 'code' && SHELL.has(block.language))
}

function findCopyButton(node: Element | ElementContent): Element | undefined {
  if (node.type !== 'element') return undefined
  if (node.tagName === 'button' && node.properties?.dataCode !== undefined) return node
  for (const child of node.children) {
    const found = findCopyButton(child)
    if (found) return found
  }
  return undefined
}

export function pluginPrompt() {
  return definePlugin({
    name: 'dio-prompt',
    baseStyles: `
      .ec-line.dio-cmd .code::before { content: '$ '; opacity: 0.55; user-select: none; }
      .ec-line.dio-out .code { opacity: 0.8; }
    `,
    hooks: {
      preprocessCode: ({ codeBlock }) => {
        if (!isTerminal(codeBlock)) return
        const lines = codeBlock.getLines()
        if (!lines.some((line) => line.text.startsWith('$ '))) return
        const set = new Set<number>()
        lines.forEach((line, index) => {
          if (!line.text.startsWith('$ ')) return
          line.editText(0, 2, '')
          set.add(index)
        })
        commands.set(codeBlock, set)
      },
      postprocessRenderedLine: ({ codeBlock, lineIndex, renderData }) => {
        const set = commands.get(codeBlock)
        if (!set) return
        const ast = renderData.lineAst
        const names = ast.properties.className
        const list = Array.isArray(names) ? names : []
        ast.properties.className = [...list, set.has(lineIndex) ? 'dio-cmd' : 'dio-out']
      },
      postprocessRenderedBlock: ({ codeBlock, renderData }) => {
        const set = commands.get(codeBlock)
        if (!set) return
        const button = findCopyButton(renderData.blockAst)
        if (!button) return
        const text = codeBlock
          .getLines()
          .filter((_, index) => set.has(index))
          .map((line) => line.text)
          .join('\x7f')
        button.properties.dataCode = text
      },
    },
  })
}

/** Code counts less than prose in search. */
export function pluginPagefindWeight() {
  return definePlugin({
    name: 'dio-pagefind-weight',
    hooks: {
      postprocessRenderedBlock: ({ renderData }) => {
        renderData.blockAst.properties.dataPagefindWeight = '0.25'
      },
    },
  })
}

/**
 * HTML blocks drop alt text and break long start tags one attribute per line, and Twoslash hover
 * types keep the layout display.ts gives them.
 */
export function pluginDisplayHtml() {
  return definePlugin({
    name: 'dio-display-html',
    // Hover types are laid out over lines (display.ts): keep their indent, which the wrapped-line
    // indent of the popup's code otherwise cancels, and show the whole type.
    baseStyles: `
      .twoslash-popup-code-type .frame .ec-line .code { text-indent: 0 !important; }
      .twoslash-popup-container .twoslash-popup-code { max-height: min(60vh, 480px) !important; }
    `,
    hooks: {
      preprocessCode: ({ codeBlock }) => {
        if (codeBlock.language !== 'html') return
        const shown = displayHtml(codeBlock.code)
        if (shown === codeBlock.code) return
        const count = codeBlock.getLines().length
        codeBlock.insertLines(count, shown.split('\n'))
        codeBlock.deleteLines([...Array(count).keys()])
      },
    },
  })
}
