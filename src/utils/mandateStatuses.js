export const MANDATE_STATUSES = ['Ongoing', 'Completed', 'Scrapped']

export const MANDATE_STATUS_OPTIONS = ['', ...MANDATE_STATUSES]

export const MANDATE_STATUS_BADGE_MAP = {
  Ongoing: 'badge-mandate-ongoing',
  Scrapped: 'badge-mandate-scrapped',
  Completed: 'badge-mandate-completed',
}

export const normalizeMandateStatus = (value) => {
  if (value === 'Completed') return 'Completed'
  if (value === 'Scrapped' || value === 'Scrap') return 'Scrapped'
  if (value === 'Ongoing') return 'Ongoing'
  return '-'
}
