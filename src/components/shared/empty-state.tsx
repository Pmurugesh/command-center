import { Card, CardContent } from '@/components/ui/card'
import { FolderOpen, type LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
}

export function EmptyState({ icon: Icon = FolderOpen, title, description }: EmptyStateProps) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center py-12 text-center">
        <Icon className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-md">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}
