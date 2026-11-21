import { app } from '../../docs/diorama.ts'

// The docs page has its app already; on a builder site this is start() from the CDN script.
export default () => {
  const ripple = app.attach('#rec123456789 img', 'ripple', {
    strength: 2,
  })
  return () => ripple()
}
