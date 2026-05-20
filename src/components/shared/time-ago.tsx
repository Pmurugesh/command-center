"use client"

import { useState, useEffect } from 'react'

function getTimeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSecs < 60) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays === 1) return 'yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`
  return date.toLocaleDateString()
}

interface TimeAgoProps {
  date: string | Date
  className?: string
}

export function TimeAgo({ date, className }: TimeAgoProps) {
  const [text, setText] = useState('')

  useEffect(() => {
    const d = typeof date === 'string' ? new Date(date) : date
    setText(getTimeAgo(d))
    const id = setInterval(() => setText(getTimeAgo(d)), 60_000)
    return () => clearInterval(id)
  }, [date])

  if (!text) return null

  return (
    <time
      dateTime={typeof date === 'string' ? date : date.toISOString()}
      className={className}
      title={typeof date === 'string' ? new Date(date).toLocaleString() : date.toLocaleString()}
    >
      {text}
    </time>
  )
}
