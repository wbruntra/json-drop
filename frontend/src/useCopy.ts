import { useState, useCallback } from 'preact/hooks'

export function useCopy(timeout = 2000) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copy = useCallback(
    (text: string, id: string) => {
      navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), timeout)
    },
    [timeout],
  )
  return { copiedId, copy }
}
