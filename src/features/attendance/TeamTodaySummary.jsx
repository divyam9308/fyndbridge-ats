import { CalendarDays, CheckCircle2, Clock3 } from 'lucide-react'
import { useState } from 'react'
import { dateLabel, initials } from './attendanceData'
import { Modal, StatusPill } from './AttendanceComponents'

const CATEGORY_META = {
  present: {
    label: 'Present',
    title: 'Present Employees',
    status: 'Present',
    Icon: CheckCircle2,
    aria: count => `View ${count} present employees`
  },
  leave: {
    label: 'Leave',
    title: 'Employees on Leave',
    status: 'Leave',
    Icon: CalendarDays,
    aria: count => `View ${count} employees on leave`
  },
  unmarked: {
    label: 'Unmarked',
    title: 'Unmarked Employees',
    status: 'Unmarked',
    Icon: Clock3,
    aria: count => `View ${count} unmarked employees`
  }
}

function PeopleList({ people, fallbackStatus }) {
  if (!people.length) return <div className="att-today-people-empty">No employees in this category today.</div>
  return <div className="att-today-people-list">{people.map(person => (
    <article key={person.user_id} className="att-today-person">
      {person.avatar_url
        ? <img src={person.avatar_url} alt="" />
        : <i aria-hidden="true">{initials(person.name || 'Employee')}</i>}
      <div><strong>{person.name || 'Employee'}</strong>{person.role && <small>{person.role}</small>}</div>
      <StatusPill status={person.status || fallbackStatus} />
    </article>
  ))}</div>
}

export default function TeamTodaySummary({ summary, loading, error }) {
  const [activeCategory, setActiveCategory] = useState('')
  const activeMeta = CATEGORY_META[activeCategory]
  const activePeople = activeCategory ? summary?.[activeCategory] || [] : []

  return <section className="att-team-today" aria-labelledby="att-team-today-title">
    <div className="att-team-today-head">
      <div><h2 id="att-team-today-title">Today's Attendance</h2>{summary?.date && <p>{dateLabel(summary.date)}</p>}</div>
    </div>
    {error ? <div className="att-team-today-error" role="alert">{error}</div> : (
      <div className={`att-team-today-cards${loading ? ' is-loading' : ''}`} aria-busy={loading}>
        {Object.entries(CATEGORY_META).map(([key, meta]) => {
          const count = summary?.[key]?.length || 0
          const Icon = meta.Icon
          return <article className={`att-team-today-card is-${key}`} key={key}>
            <div><span><Icon size={18} /></span><small>{meta.label}</small></div>
            {loading ? <i className="att-team-today-count-skeleton" /> : <button type="button" onClick={() => setActiveCategory(key)} aria-label={meta.aria(count)}>{count}</button>}
            <em>View employees</em>
          </article>
        })}
      </div>
    )}
    {activeMeta && <Modal title={`${activeMeta.title} (${activePeople.length})`} subtitle={summary?.date ? dateLabel(summary.date) : ''} onClose={() => setActiveCategory('')}>
      <PeopleList people={activePeople} fallbackStatus={activeMeta.status} />
    </Modal>}
  </section>
}
