import { dashboardFilterEntries } from '../utils/dashboardDrilldown'

export default function DashboardFilterBanner({ filters, onClear }) {
  if (!filters) return null
  return (
    <div className="dashboard-filter-banner" role="status">
      <span>Dashboard filter: {dashboardFilterEntries(filters).map(([label, value]) => `${label} = ${value}`).join(', ')}</span>
      <button type="button" onClick={onClear}>Clear dashboard filter</button>
    </div>
  )
}
