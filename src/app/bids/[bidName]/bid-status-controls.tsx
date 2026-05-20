"use client"

import { useState } from 'react'
import { BID_STATUSES, ENTITIES, type BidStatus, type Entity } from '@/lib/config'

interface BidStatusControlsProps {
  bidName: string
  initialStatus?: BidStatus
  initialEntity?: Entity
}

export function BidStatusControls({ bidName, initialStatus, initialEntity }: BidStatusControlsProps) {
  const [status, setStatus] = useState<BidStatus>(initialStatus || 'Discovered')
  const [entity, setEntity] = useState<Entity>(initialEntity || 'Infinite Solutions')
  const [saving, setSaving] = useState(false)

  const handleStatusChange = async (newStatus: BidStatus) => {
    setStatus(newStatus)
    setSaving(true)
    try {
      await fetch(`/api/bids/${encodeURIComponent(bidName)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
    } catch (err) {
      console.error('Failed to save status:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleEntityChange = async (newEntity: Entity) => {
    setEntity(newEntity)
    setSaving(true)
    try {
      await fetch(`/api/bids/${encodeURIComponent(bidName)}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: newEntity }),
      })
    } catch (err) {
      console.error('Failed to save entity:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={status}
        onChange={(e) => handleStatusChange(e.target.value as BidStatus)}
        disabled={saving}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {BID_STATUSES.map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select
        value={entity}
        onChange={(e) => handleEntityChange(e.target.value as Entity)}
        disabled={saving}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {ENTITIES.map(e => (
          <option key={e} value={e}>{e}</option>
        ))}
      </select>
    </div>
  )
}
