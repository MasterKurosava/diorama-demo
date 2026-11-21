// Plain tsc has no Astro language service, so .astro imports in .ts files need a type. Astro's own
// check (`astro check`) types the components themselves.
declare module '*.astro' {
  const Component: (props: Record<string, unknown>) => unknown
  export default Component
}
