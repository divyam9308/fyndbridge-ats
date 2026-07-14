export const CANDIDATE_STATUSES = [
  'Interested',
  'In Discussion',
  'Not Interested',
  'Interview',
  'Client Submission',
  'Offered',
  'Hired',
  'Offer Declined',
  'Dropout',
  'Rejected by Recruiter',
  'Rejected by Client'
]

export const MOCK_REPORT_DATE = '2026-07-15T11:30:00+05:30'

export const mockConsultants = [
  {
    key: 'consultant-ananya',
    initials: 'AM',
    name: 'Ananya Mehta',
    email: 'ananya.mehta@fyndbridge.com',
    employeeStatus: 'Active',
    employeeId: 'FB-1042',
    designation: 'Senior Consultant',
    department: 'Executive Search',
    reportingManager: 'Rhea Kapoor'
  },
  {
    key: 'consultant-vikram',
    initials: 'VS',
    name: 'Vikram Sethi',
    email: 'vikram.sethi@fyndbridge.com',
    employeeStatus: 'Active',
    employeeId: 'FB-1036',
    designation: 'Consultant',
    department: 'Technology Hiring',
    reportingManager: 'Rhea Kapoor'
  },
  {
    key: 'consultant-neha',
    initials: 'NR',
    name: 'Neha Rao',
    email: 'neha.rao@fyndbridge.com',
    employeeStatus: 'On Leave',
    employeeId: 'FB-1058',
    designation: 'Associate Consultant',
    department: 'Consumer & Retail',
    reportingManager: 'Vikram Sethi'
  }
]

const statusCounts = (values) => Object.fromEntries(CANDIDATE_STATUSES.map((status, index) => [status, values[index] || 0]))

const mandateRows = [
  {
    key: 'leadership-product', consultant: 'Ananya Mehta', teamLead: 'Rhea Kapoor', clientName: 'Northstar Digital', role: 'Head of Product', budget: '₹48–55 LPA', status: 'Completed', sector: 'SaaS', allocationDate: '2026-06-10',
    counts: statusCounts([3, 1, 1, 2, 4, 1, 1, 0, 0, 0, 0]), conversion: [5, 12, 24, 34]
  },
  {
    key: 'finance-controller', consultant: 'Ananya Mehta', teamLead: 'Rhea Kapoor', clientName: 'Asteria Capital', role: 'Financial Controller', budget: '₹32–38 LPA', status: 'Ongoing', sector: 'Financial Services', allocationDate: '2026-05-08',
    counts: statusCounts([5, 2, 0, 2, 3, 1, 0, 0, 0, 0, 0]), conversion: [9, 21, 48, null]
  },
  {
    key: 'operations-director', consultant: 'Ananya Mehta', teamLead: 'Karan Bahl', clientName: 'Veridian Foods', role: 'Director – Operations', budget: '₹40–46 LPA', status: 'Completed', sector: 'FMCG', allocationDate: '2026-05-01',
    counts: statusCounts([4, 1, 0, 2, 3, 1, 1, 0, 0, 0, 0]), conversion: [6, 14, 21, 29]
  },
  {
    key: 'retail-expansion', consultant: 'Vikram Sethi', teamLead: 'Karan Bahl', clientName: 'Urban Loom', role: 'Regional Expansion Lead', budget: '₹28–34 LPA', status: 'Scrapped', sector: 'Retail', allocationDate: '2026-04-18',
    counts: statusCounts([2, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1]), conversion: [18, null, null, null]
  },
  {
    key: 'engineering-manager', consultant: 'Ananya Mehta', teamLead: 'Rhea Kapoor', clientName: 'CloudPivot Labs', role: 'Engineering Manager', budget: '₹42–50 LPA', status: 'Ongoing', sector: 'Technology', allocationDate: '2026-06-20',
    counts: statusCounts([5, 2, 0, 3, 5, 1, 0, 1, 0, 0, 0]), conversion: [4, 11, 20, null]
  },
  {
    key: 'people-culture', consultant: 'Neha Rao', teamLead: 'Rhea Kapoor', clientName: 'Halo Health', role: 'VP – People & Culture', budget: '₹50–60 LPA', status: 'Completed', sector: 'Healthcare', allocationDate: '2026-03-12',
    counts: statusCounts([3, 1, 0, 2, 3, 1, 1, 0, 0, 0, 0]), conversion: [8, 19, 31, 42]
  },
  {
    key: 'supply-chain', consultant: 'Ananya Mehta', teamLead: 'Karan Bahl', clientName: 'Meridian Mobility', role: 'Supply Chain Lead', budget: '₹30–36 LPA', status: 'Ongoing', sector: 'Automotive', allocationDate: '2026-04-28',
    counts: statusCounts([5, 1, 1, 2, 2, 0, 0, 0, 0, 0, 0]), conversion: [12, 29, null, null]
  },
  {
    key: 'brand-strategy', consultant: 'Neha Rao', teamLead: 'Karan Bahl', clientName: 'Juniper Living', role: 'Brand Strategy Director', budget: '₹35–41 LPA', status: 'Completed', sector: 'Consumer', allocationDate: '2026-05-28',
    counts: statusCounts([3, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0]), conversion: [5, 10, 18, 24]
  }
]

export const mockMandates = mandateRows.map((row) => ({
  ...row,
  candidatesAssigned: Object.values(row.counts).reduce((total, value) => total + value, 0),
  mandateName: `${row.clientName} · ${row.role}`,
  firstClientSubmissionDays: row.conversion[0],
  firstInterviewDays: row.conversion[1],
  firstOfferDays: row.conversion[2],
  firstHireDays: row.conversion[3]
})).sort((left, right) => right.allocationDate.localeCompare(left.allocationDate))

export const candidateOverviewCounts = {
  Interested: 30,
  'In Discussion': 9,
  'Not Interested': 3,
  Interview: 14,
  'Client Submission': 22,
  Offered: 5,
  Hired: 4,
  'Offer Declined': 1,
  Dropout: 1,
  'Rejected by Recruiter': 0,
  'Rejected by Client': 1
}

export const candidateTotal = Object.values(candidateOverviewCounts).reduce((total, value) => total + value, 0)

export const conversionAverages = [
  { label: 'Mandate → First Client Submission', value: '8.4 days', tone: 'blue' },
  { label: 'Mandate → First Interview', value: '16.6 days', tone: 'purple' },
  { label: 'Mandate → First Offer', value: '27.0 days', tone: 'amber' },
  { label: 'Mandate → First Hire', value: '32.3 days', tone: 'green' }
]

export const exceptionMetrics = [
  { label: 'Mandates without candidates', value: 0, tone: 'neutral' },
  { label: 'Mandates with candidates but no Client Submission', value: 0, tone: 'blue' },
  { label: 'Mandates with Client Submission but no Interview', value: 1, tone: 'purple' },
  { label: 'Mandates where every candidate is Not Interested, Rejected by Recruiter or Rejected by Client', value: 0, tone: 'red' },
  { label: 'Ongoing mandates older than 45 days', value: 2, tone: 'amber' }
]

export const positiveOutcomeMetrics = [
  { label: 'Hired Candidates', value: 4, tone: 'green' },
  { label: 'Offered Candidates', value: 5, tone: 'amber' },
  { label: 'Completed Mandates', value: 4, tone: 'blue' },
  { label: 'Mandates with at least one Hire', value: 4, tone: 'teal' },
  { label: 'Total Client Submissions', value: 22, tone: 'cyan' },
  { label: 'Total Interviews', value: 14, tone: 'purple' }
]

export const attendanceMetrics = [
  { label: 'Working Days', value: '22', tone: 'blue' },
  { label: 'Present Days', value: '18', tone: 'green' },
  { label: 'Leave Days', value: '1', tone: 'purple' },
  { label: 'Half-Day Leave', value: '1', tone: 'amber' },
  { label: 'Absent Days', value: '0', tone: 'red' },
  { label: 'Corrected Attendance', value: '1', tone: 'cyan' },
  { label: 'Pending Corrections', value: '0', tone: 'amber' },
  { label: 'Late Days', value: '2', tone: 'orange' },
  { label: 'Total Worked Hours', value: '156h 40m', tone: 'navy' },
  { label: 'Leave Balance', value: '14.5 days', tone: 'teal' },
  { label: 'Attendance Percentage', value: '95%', tone: 'green' }
]

export const leaveBalances = [
  { type: 'Privilege Leave', entitled: 18, used: 5, balance: 13 },
  { type: 'Sick Leave', entitled: 6, used: 2, balance: 4 },
  { type: 'Casual Leave', entitled: 6, used: 3.5, balance: 2.5 }
]
