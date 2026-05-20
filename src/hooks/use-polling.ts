"use client"

import { useState, useEffect, useCallback, useRef } from 'react'

interface UsePollingOptions {
  enabled?: boolean
}

interface UsePollingResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

export function usePolling<T>(
  url: string,
  intervalMs: number,
  options: UsePollingOptions = {}
): UsePollingResult<T> {
  const { enabled = true } = options
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const json = await res.json()
      if (mountedRef.current) {
        setData(json)
        setError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      }
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [url])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) return

    fetchData()
    const id = setInterval(fetchData, intervalMs)

    return () => {
      mountedRef.current = false
      clearInterval(id)
    }
  }, [fetchData, intervalMs, enabled])

  return { data, error, loading, refresh: fetchData }
}
