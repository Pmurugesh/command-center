import Link from 'next/link'
import { Phone, Mail, ArrowRight } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'

interface OutreachItem {
  priority: number
  contact: string
  title: string
  agency: string
  product: string
  owner: string
  action: string
  status: string
}

export function PriorityOutreachCard({ items }: { items: OutreachItem[] }) {
  const pending = items.filter(i => i.status === 'pending')

  return (
    <Card className={pending.length > 0 ? 'border-amber-500/30 bg-amber-500/5' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Priority Outreach
          </CardTitle>
          <Link href="/agencies" className="text-sm text-blue-400 hover:underline flex items-center gap-1">
            All agencies <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {pending.slice(0, 5).map((item) => (
          <div key={item.priority} className="flex items-center justify-between rounded-md border border-border p-3 hover:bg-accent/30 transition-colors">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">#{item.priority}</span>
                <p className="text-sm font-medium truncate">{item.contact}</p>
              </div>
              <p className="text-xs text-muted-foreground truncate">{item.title} — {item.agency}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                item.product === 'AIHire' 
                  ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                  : item.product === 'PRRAI'
                  ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                  : 'bg-gray-500/10 text-gray-400 border border-gray-500/30'
              }`}>
                {item.product}
              </span>
              <span className="text-xs text-muted-foreground">{item.owner}</span>
            </div>
          </div>
        ))}
        {pending.length > 5 && (
          <Link href="/agencies" className="flex items-center justify-center rounded-md border border-dashed border-border p-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            +{pending.length - 5} more contacts
          </Link>
        )}
        {pending.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">All outreach completed ✅</p>
        )}
      </CardContent>
    </Card>
  )
}
