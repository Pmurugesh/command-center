import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface DataCardProps {
  label: string
  value: string | number
  subtitle?: string
  valueColor?: string
  className?: string
}

export function DataCard({ label, value, subtitle, valueColor, className }: DataCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className={cn('text-4xl font-mono tabular-nums tracking-tight', valueColor)}>{value}</CardTitle>
      </CardHeader>
      {subtitle && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </CardContent>
      )}
    </Card>
  )
}
