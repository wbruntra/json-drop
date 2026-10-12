import { useEffect, useState } from 'preact/hooks'

// Hash routes (#/projects/abc/keys) so deep links work with nginx's static
// try_files and need no server-side routing.
function parse(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
}

export function useRoute(): string[] {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function href(...parts: string[]): string {
  return '#/' + parts.map(encodeURIComponent).join('/')
}

export function navigate(...parts: string[]): void {
  location.hash = href(...parts)
}
