export const CRM_STATUSES = ['Outreach Sent', 'Follow-up Sent', 'DNP', 'CB', 'Meeting Scheduled', 'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'On Hold', 'Not Interested', 'Nurture / Long-term']
export const CRM_PROBABILITIES = ['<25%', '25-50%', '50-75%', '75-100%']
export const CRM_SOURCES = ['LinkedIn', 'Referral', 'Cold Email', 'Cold Call', 'Existing Client', 'Candidate', 'Other']
export const CRM_BADGES = {
  'Outreach Sent': 'badge-client-submission', 'Follow-up Sent': 'badge-in-discussion', DNP: 'badge-status-unset', CB: 'badge-offered',
  'Meeting Scheduled': 'badge-interview', 'Proposal Sent': 'badge-client-submission', Negotiation: 'badge-in-discussion', Won: 'badge-hired',
  Lost: 'badge-rejected-client', 'On Hold': 'badge-offer-declined', 'Not Interested': 'badge-not-interested', 'Nurture / Long-term': 'badge-interested',
  '<25%': 'crm-probability-low', '25-50%': 'crm-probability-medium', '50-75%': 'crm-probability-high', '75-100%': 'crm-probability-highest'
}
export const emptyContact = () => ({ name: '', mobile: '', email: '', designation: '', linkedin: '' })
export const followUpState = (date, today) => !date ? 'none' : date < today ? 'overdue' : date === today ? 'today' : 'upcoming'
export const commentDate = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : '-'
export function validLinkedIn(value) {
  if (!value) return true
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && /^(?:[a-z0-9-]+\.)?linkedin\.com$/i.test(url.hostname) } catch { return false }
}
export function validateCrm(form) {
  const errors = {}
  if (!String(form.organisation_name || '').trim()) errors.organisation_name = 'Organisation Name is required'
  form.contacts.forEach((contact, index) => {
    if (!String(contact.name || '').trim()) errors[`contacts.${index}.name`] = `Contact ${index + 1}: Contact Person is required`
    const email = String(contact.email || '').trim()
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors[`contacts.${index}.email`] = `Contact ${index + 1}: Enter a valid email`
    if (!validLinkedIn(String(contact.linkedin || '').trim())) errors[`contacts.${index}.linkedin`] = `Contact ${index + 1}: Enter a valid HTTPS LinkedIn profile URL`
  })
  return errors
}
