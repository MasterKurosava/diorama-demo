// Expressive Code options live here so the <Code> component gets the same pipeline as Markdown.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginCollapsibleSections } from '@expressive-code/plugin-collapsible-sections'
import { defineEcConfig } from 'astro-expressive-code'
import ecTwoSlash from 'expressive-code-twoslash'
import { formatHover } from './src/docs/lib/display.ts'
import { pluginDisplayHtml, pluginPagefindWeight, pluginPrompt } from './src/docs/lib/ec-prompt.ts'
import dawn from './src/docs/styles/shiki/dio-dawn.json' with { type: 'json' }
import night from './src/docs/styles/shiki/dio-night.json' with { type: 'json' }

const lenient = !process.argv.includes('build') || process.env.DOCS_TYPE_ERRORS === 'show'

export default defineEcConfig({
  themes: [dawn, night],
  useDarkModeMediaQuery: true,
  themeCssSelector: (theme) => `[data-theme='${theme.type}']`,
  plugins: [
    pluginCollapsibleSections(),
    pluginPrompt(),
    pluginDisplayHtml(),
    pluginPagefindWeight(),
    ecTwoSlash({
      tsConfigPath: join(process.cwd(), 'tsconfig.json'),
      // tsconfig.json only gives the lib folder: the ambient `?shader`, `?effect` and `?entry`
      // modules of the glsl plugin join every sample as a file.
      twoslashOptions: {
        // Type errors without `@errors` fail `astro build`. In dev they show under the line
        // instead of failing the page; DOCS_TYPE_ERRORS=show does the same in a build.
        handbookOptions: { noErrorValidation: lenient },
        // Hover types are laid out over lines here: the plugin has no hook of its own for it.
        filterNode: (node) => {
          if (node.type === 'hover' || node.type === 'query') node.text = formatHover(node.text)
          return true
        },
        extraFiles: {
          'glsl-client.d.ts': readFileSync(
            join(process.cwd(), 'node_modules/@dioramajs/glsl/client.d.ts'),
            'utf8',
          ),
        },
      },
    }),
  ],
  styleOverrides: {
    borderRadius: '14px',
    codeFontFamily: "'JetBrains Mono', ui-monospace, monospace",
    codeFontSize: 'var(--code-size)',
    codeLineHeight: '1.6',
    uiFontFamily: "'Archivo', system-ui, sans-serif",
    borderColor: 'var(--border)',
    frames: {
      shadowColor: 'transparent',
      // Tab bars and the terminal title bar in the paper and night tones instead of grey.
      editorTabBarBackground: ({ theme }) => (theme.type === 'dark' ? '#0f0a1d' : '#dfc9ad'),
      editorTabBarBorderBottomColor: 'transparent',
      editorActiveTabBackground: ({ theme }) => theme.colors['editor.background'],
      editorActiveTabIndicatorTopColor: 'transparent',
      editorActiveTabIndicatorBottomColor: 'transparent',
      editorActiveTabForeground: ({ theme }) => theme.colors['editor.foreground'],
      terminalTitlebarBackground: ({ theme }) => (theme.type === 'dark' ? '#0f0a1d' : '#dfc9ad'),
      terminalTitlebarBorderBottomColor: 'transparent',
      terminalTitlebarDotsForeground: ({ theme }) =>
        theme.type === 'dark' ? '#5b4a6e' : '#b39376',
      terminalBackground: ({ theme }) => theme.colors['editor.background'],
      inlineButtonForeground: ({ theme }) => theme.colors['editor.foreground'],
    },
    scrollbarThumbColor: 'var(--scroll-thumb)',
    scrollbarThumbHoverColor: 'var(--scroll-thumb-hover)',
  },
  // Long lines wrap with their indent kept, so nothing is cut off and no block scrolls sideways.
  defaultProps: {
    wrap: true,
    preserveIndent: true,
    overridesByLang: { 'sh,bash': { frame: 'terminal' } },
  },
})
