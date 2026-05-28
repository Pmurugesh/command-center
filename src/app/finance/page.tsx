import { ComingSoon } from '@/components/shared/coming-soon'
import { DollarSign } from 'lucide-react'

export default function FinancePage() {
  return (
    <ComingSoon
      title="Finance Alerts"
      description="Cash position, runway, and budget notifications"
      icon={DollarSign}
      willInclude={[
        'Current cash position and monthly burn rate',
        'Runway projection with alert thresholds',
        'Outstanding invoices and AR aging',
        'Budget vs actual by category',
      ]}
      dataSource="~/repos/operations/finance/"
    />
  )
}
