// Inline head script and CSS: theme, framework and package manager are set on <html> before the
// first paint, and carried over when ClientRouter swaps the document.
import { FRAMEWORKS, MANAGERS } from './commands.ts'

export const HEAD_SCRIPT = `(()=>{var d=document.documentElement,s=localStorage,k=[['data-theme','dio.theme',''],['data-framework','dio.framework','vite'],['data-pm','dio.pm','npm']];function a(e){k.forEach(function(x){var v;try{v=s.getItem(x[1])}catch(_){}v=v||x[2];if(v)e.setAttribute(x[0],v);else e.removeAttribute(x[0])})}a(d);document.addEventListener('astro:before-swap',function(e){a(e.newDocument.documentElement)})})()`

function rules(attr: string, sync: string, values: readonly string[]): string {
  return values
    .map((v) => {
      const has = `html[${attr}="${v}"] .tabs[data-sync="${sync}"]:has(> .tab-panels > [data-value="${v}"])`
      return `${has} > .tab-panels > [role=tabpanel]{display:none}${has} > .tab-panels > [data-value="${v}"]{display:block}`
    })
    .join('')
}

/** Without JS the first panel shows; with a stored choice the matching panel shows at once. */
export const TABS_CSS = `.tabs > .tab-panels > [role=tabpanel]:not(:first-child){display:none}${rules(
  'data-framework',
  'framework',
  FRAMEWORKS.map((f) => f.value),
)}${rules(
  'data-pm',
  'pm',
  MANAGERS.map((m) => m.value),
)}.tabs[data-ready] > .tab-panels > [role=tabpanel]:not([hidden]){display:block}.tabs[data-ready] > .tab-panels > [role=tabpanel][hidden]{display:none}`
