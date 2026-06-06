require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })

const supabase = require('../src/services/supabaseAdmin')

const CLIENTS = [
  ['AstraNova Technologies', 'Rohit Sinha', '9876501001', 'talent@astranova.in', 'Bangalore', 'Karnataka', 'Active'],
  ['BluePeak Consulting', 'Neha Kapoor', '9876501002', 'careers@bluepeakconsulting.com', 'Delhi', 'Delhi', 'Active'],
  ['Crestline Retail', 'Pooja Bhatia', '9876501003', 'hiring@crestlineretail.in', 'Mumbai', 'Maharashtra', 'Active'],
  ['Dhanvi Finance', 'Amit Arora', '9876501004', 'jobs@dhanvifinance.com', 'Mumbai', 'Maharashtra', 'Active'],
  ['EverSure Hospitals', 'Shweta Menon', '9876501005', 'recruitment@eversurehospitals.com', 'Chennai', 'Tamil Nadu', 'Active'],
  ['ForgeWorks Manufacturing', 'Karan Malhotra', '9876501006', 'careers@forgeworks.in', 'Pune', 'Maharashtra', 'Active'],
  ['GreenRoute Logistics', 'Deepak Yadav', '9876501007', 'people@greenroute.in', 'Gurgaon', 'Haryana', 'Active'],
  ['HexaGrid Systems', 'Priya Nair', '9876501008', 'hiring@hexagridsystems.com', 'Hyderabad', 'Telangana', 'Active'],
  ['IndusCare Pharma', 'Riya Saxena', '9876501009', 'talent@induscarepharma.com', 'Ahmedabad', 'Gujarat', 'Active'],
  ['Jupiter Advisory', 'Vikas Kohli', '9876501010', 'jobs@jupiteradvisory.in', 'Noida', 'Uttar Pradesh', 'Active'],
  ['Kaveri Digital', 'Anjali Rao', '9876501011', 'talent@kaveridigital.com', 'Bangalore', 'Karnataka', 'Active'],
  ['LatticePay Finserv', 'Sandeep Jain', '9876501012', 'hiring@latticepay.in', 'Delhi', 'Delhi', 'Active'],
  ['MetroMile Mobility', 'Sneha Das', '9876501013', 'careers@metromilemobility.com', 'Kolkata', 'West Bengal', 'Active'],
  ['NobleAxis Health', 'Harish Pillai', '9876501014', 'recruitment@nobleaxishealth.com', 'Hyderabad', 'Telangana', 'Active'],
  ['OptiChain Supply', 'Gayatri Singh', '9876501015', 'jobs@optichain.in', 'Chennai', 'Tamil Nadu', 'Active'],
  ['PrimeLedger Capital', 'Madhav Gupta', '9876501016', 'talent@primeledger.com', 'Mumbai', 'Maharashtra', 'Active'],
  ['QuantumNest Labs', 'Ishita Bose', '9876501017', 'hiring@quantumnestlabs.com', 'Pune', 'Maharashtra', 'Active'],
  ['Riverstone Retail', 'Nitin Verma', '9876501018', 'careers@riverstoneretail.in', 'Delhi', 'Delhi', 'Active'],
  ['Silverline Analytics', 'Kriti Sharma', '9876501019', 'jobs@silverlineanalytics.com', 'Noida', 'Uttar Pradesh', 'Active'],
  ['TruVista Consulting', 'Mohit Bansal', '9876501020', 'talent@truvista.in', 'Gurgaon', 'Haryana', 'Active'],
  ['UrbanKart Commerce', 'Simran Kaur', '9876501021', 'careers@urbankart.com', 'Ahmedabad', 'Gujarat', 'Active'],
  ['VectorMint Software', 'Arvind Narang', '9876501022', 'hiring@vectormintsoftware.com', 'Bangalore', 'Karnataka', 'Active'],
  ['WellSpring Diagnostics', 'Nisha Iyer', '9876501023', 'recruitment@wellspringdx.com', 'Chennai', 'Tamil Nadu', 'Active'],
  ['XenoPath Logistics', 'Tarun Bedi', '9876501024', 'jobs@xenopathlogistics.com', 'Kolkata', 'West Bengal', 'Active'],
  ['YieldBridge Ventures', 'Megha Suri', '9876501025', 'talent@yieldbridge.in', 'Mumbai', 'Maharashtra', 'Active'],
  ['Zenora Manufacturing', 'Rahul Tandon', '9876501026', 'careers@zenora.in', 'Pune', 'Maharashtra', 'Active'],
  ['ApexCare Clinics', 'Bhavna Kulkarni', '9876501027', 'hiring@apexcareclinics.com', 'Hyderabad', 'Telangana', 'Active'],
  ['Bharat Freight Systems', 'Lokesh Chawla', '9876501028', 'talent@bharatfreight.com', 'Gurgaon', 'Haryana', 'Active'],
  ['CoreVista Infotech', 'Sakshi Ghosh', '9876501029', 'jobs@corevista.in', 'Noida', 'Uttar Pradesh', 'Active'],
  ['DeltaMart Retail', 'Manish Dutta', '9876501030', 'careers@deltamart.in', 'Ahmedabad', 'Gujarat', 'Active']
]

const JOB_TITLES = [
  'React Developer', 'Node Developer', 'Full Stack Developer', 'Java Developer', 'Python Developer',
  'Data Analyst', 'Data Engineer', 'Business Analyst', 'Sales Manager', 'HR Executive',
  'Recruiter', 'Finance Manager', 'Project Manager', 'QA Engineer', 'DevOps Engineer',
  'UI/UX Designer', 'Product Manager', 'Operations Manager', 'Marketing Executive', 'Support Engineer'
]

const CONSULTANTS = ['Rajneesh', 'Amit', 'Priya', 'Rohit', 'Neha', 'Karan', 'Deepak', 'Shweta']
const STATES = ['Delhi', 'Haryana', 'Maharashtra', 'Karnataka', 'Telangana', 'Tamil Nadu', 'Gujarat', 'West Bengal']
const CITY_STATE = {
  Delhi: 'Delhi',
  Gurgaon: 'Haryana',
  Noida: 'Uttar Pradesh',
  Mumbai: 'Maharashtra',
  Pune: 'Maharashtra',
  Bangalore: 'Karnataka',
  Hyderabad: 'Telangana',
  Chennai: 'Tamil Nadu',
  Kolkata: 'West Bengal',
  Ahmedabad: 'Gujarat'
}
const CITIES = Object.keys(CITY_STATE)
const STATUSES = ['Interested', 'Not Interested', 'Offered', 'Hired', 'Rejected by Recruiter', 'Interview', 'Client Submission', 'Rejected by Client']
const NOTICE_PERIODS = [0, 15, 30, 60, 90]
const FIRST_NAMES = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Arjun', 'Kabir', 'Krish', 'Neel', 'Rohan', 'Siddharth', 'Ananya', 'Diya', 'Ira', 'Kiara', 'Meera', 'Myra', 'Naina', 'Riya', 'Sara', 'Tanvi']
const LAST_NAMES = ['Sharma', 'Verma', 'Gupta', 'Jain', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Das', 'Saxena', 'Bhatia', 'Kohli', 'Bose', 'Tandon', 'Sinha', 'Kapoor', 'Menon', 'Arora', 'Kulkarni', 'Chawla']
const COMPANY_NAMES = ['Infosys', 'TCS', 'Wipro', 'HCLTech', 'Tech Mahindra', 'Capgemini', 'Accenture', 'Cognizant', 'Mindtree', 'LTIMindtree', 'Flipkart', 'Paytm', 'Policybazaar', 'Apollo Health', 'Deloitte', 'EY', 'KPMG', 'PwC', 'Mahindra Logistics', 'Asian Paints']
const EDUCATION = ['B.Tech - Computer Science', 'MBA - Marketing', 'B.Com - Finance', 'B.E - Information Technology', 'MCA', 'B.Sc - Mathematics', 'M.Tech - Data Science', 'MBA - HR', 'BBA', 'B.Tech - Electronics']
const TITLE_SKILLS = {
  'React Developer': ['React', 'JavaScript', 'HTML', 'CSS'],
  'Node Developer': ['Node.js', 'Express', 'MongoDB', 'API'],
  'Full Stack Developer': ['React', 'Node.js', 'PostgreSQL', 'TypeScript'],
  'Java Developer': ['Java', 'Spring Boot', 'Microservices', 'SQL'],
  'Python Developer': ['Python', 'Django', 'Flask', 'REST'],
  'Data Analyst': ['SQL', 'Excel', 'Power BI', 'Tableau'],
  'Data Engineer': ['Python', 'ETL', 'Airflow', 'SQL'],
  'Business Analyst': ['Requirements Gathering', 'SQL', 'Documentation', 'Stakeholder Management'],
  'Sales Manager': ['B2B Sales', 'CRM', 'Negotiation', 'Forecasting'],
  'HR Executive': ['Recruitment', 'Onboarding', 'HR Operations', 'Coordination'],
  'Recruiter': ['Sourcing', 'Screening', 'Stakeholder Management', 'ATS'],
  'Finance Manager': ['Budgeting', 'MIS', 'Financial Planning', 'Reporting'],
  'Project Manager': ['Project Planning', 'Delivery', 'Risk Management', 'Agile'],
  'QA Engineer': ['Manual Testing', 'Automation', 'Selenium', 'Jira'],
  'DevOps Engineer': ['AWS', 'Docker', 'Kubernetes', 'CI/CD'],
  'UI/UX Designer': ['Figma', 'Wireframing', 'User Research', 'Prototyping'],
  'Product Manager': ['Product Strategy', 'Roadmap', 'Analytics', 'Discovery'],
  'Operations Manager': ['Operations', 'Process Improvement', 'MIS', 'Vendor Management'],
  'Marketing Executive': ['Campaigns', 'SEO', 'Content', 'Analytics'],
  'Support Engineer': ['Troubleshooting', 'Linux', 'Networking', 'Ticketing']
}

function assertSafeToRun() {
  if (process.env.ALLOW_DEMO_RESET !== 'true') {
    console.error('ALLOW_DEMO_RESET=true is required to run demo reset.')
    process.exit(1)
  }
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') {
    console.error('Demo reset is blocked in production.')
    process.exit(1)
  }
}

function salaryRangeForIndex(index) {
  const min = 400000 + ((index * 175000) % 2200000)
  return [min, min + 500000 + ((index % 5) * 150000)]
}

function buildJobs() {
  let jobId = 1
  return CLIENTS.flatMap((client, clientIndex) => {
    const [clientName, , , , city, state] = client
    const count = clientIndex < 10 ? 4 : 3
    return Array.from({ length: count }, (_, offset) => {
      const title = JOB_TITLES[(clientIndex * 3 + offset) % JOB_TITLES.length]
      const [salaryMin, salaryMax] = salaryRangeForIndex(jobId)
      const statuses = ['Open', 'Active', 'On Hold', 'Closed', 'Filled']
      const status = statuses[(clientIndex + offset) % statuses.length]
      const completion = status === 'Filled' || status === 'Closed' ? 100 : 22 + ((jobId * 9) % 69)
      return {
        id: jobId++,
        title,
        client: clientName,
        city,
        state,
        status,
        salaryMin,
        salaryMax,
        experienceLabel: ['1-3 years', '2-4 years', '3-5 years', '4-6 years', '5-8 years', '8-12 years'][(clientIndex + offset) % 6],
        experienceMin: [1, 2, 3, 4, 5, 8][(clientIndex + offset) % 6],
        completion,
        successCount: status === 'Filled' ? 1 + ((clientIndex + offset) % 3) : (jobId + clientIndex) % 2,
        rejectedByClient: (clientIndex + offset) % 5,
        openPositions: status === 'Filled' || status === 'Closed' ? 0 : 1 + ((clientIndex + offset) % 4),
        notes: `${title} mandate for ${clientName}.`
      }
    })
  })
}

function buildCandidates(jobs) {
  return Array.from({ length: 100 }, (_, index) => {
    const title = JOB_TITLES[index % JOB_TITLES.length]
    const city = CITIES[index % CITIES.length]
    const state = CITY_STATE[city] || STATES[index % STATES.length]
    const baseName = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[(index * 3) % LAST_NAMES.length]}`
    const fullName =
      index === 90 ? 'Rohan Sharma' :
      index === 91 ? 'Rohan Sharma' :
      index === 92 ? 'Priya Nair' :
      index === 93 ? 'Ananya Gupta' :
      baseName
    const mobile =
      index === 90 ? '9876612345' :
      index === 91 ? '9876612346' :
      index === 92 ? '9876623456' :
      index === 93 ? '9876623456' :
      `98${String(76000000 + index).padStart(8, '0')}`
    const emailLocal = fullName.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')
    const email =
      index % 11 === 0 ? null :
      index % 2 === 0 ? `${emailLocal}${index}@gmail.com` :
      `${emailLocal}${index}@outlook.com`
    const currentCompany = COMPANY_NAMES[index % COMPANY_NAMES.length]
    const experience = Number((0.5 + ((index * 0.75) % 19.5)).toFixed(1))
    const currentSalary = 200000 + ((index * 175000) % 5800000)
    const expectedSalary = Math.min(currentSalary + 250000 + ((index % 5) * 150000), 6000000)
    const job = jobs[index % jobs.length]
    const skills = [...new Set([...TITLE_SKILLS[title], ...(index % 3 === 0 ? ['Excel'] : []), ...(index % 4 === 0 ? ['SQL'] : [])])].slice(0, 6)
    return {
      full_name: fullName,
      email,
      mobile_number: mobile,
      city: index % 14 === 0 ? null : city,
      state: index % 17 === 0 ? null : state,
      location: index % 14 === 0 ? null : city,
      current_designation: index % 12 === 0 ? null : title,
      current_company: index % 15 === 0 ? null : currentCompany,
      current_organisation: index % 15 === 0 ? null : currentCompany,
      experience_years: experience,
      notice_period: NOTICE_PERIODS[index % NOTICE_PERIODS.length],
      open_to_relocate: index % 3 === 0,
      skills: index % 13 === 0 ? [] : skills,
      education: index % 10 === 0 ? null : EDUCATION[index % EDUCATION.length],
      cv_link: index % 8 === 0 ? null : `https://example.com/cv/demo-candidate-${index + 1}.pdf`,
      linkedin_url: index % 9 === 0 ? null : `https://www.linkedin.com/in/${emailLocal}${index}`,
      resume_url: `https://example.com/resume/demo-candidate-${index + 1}.pdf`,
      source: 'demo-seed',
      current_salary: currentSalary,
      expected_salary: expectedSalary,
      default_job: job
    }
  })
}

function buildAssignments(candidates, jobs) {
  const assignments = []
  let duplicateAssociations = 0

  // We want to make sure every job has exactly 2 candidates assigned to it.
  // We have jobs and candidates. Let's iterate over each job.
  jobs.forEach((job, jobIndex) => {
    // Assign 2 candidates to this job
    const candidateIndex1 = jobIndex % candidates.length
    const candidateIndex2 = (jobIndex + 37) % candidates.length

    const candidate1 = candidates[candidateIndex1]
    const candidate2 = candidates[candidateIndex2]

    assignments.push({
      candidateIndex: candidateIndex1,
      consultant_name: CONSULTANTS[jobIndex % CONSULTANTS.length],
      client_name: job.client,
      job_title: job.title,
      status: STATUSES[jobIndex % STATUSES.length],
      current_salary: candidate1.current_salary,
      expected_salary: candidate1.expected_salary,
      notes: `${job.title} discussion at ${job.client}.`,
    })

    assignments.push({
      candidateIndex: candidateIndex2,
      consultant_name: CONSULTANTS[(jobIndex + 1) % CONSULTANTS.length],
      client_name: job.client,
      job_title: job.title,
      status: STATUSES[(jobIndex + 3) % STATUSES.length],
      current_salary: candidate2.current_salary,
      expected_salary: candidate2.expected_salary,
      notes: `${job.title} screening for ${job.client}.`,
    })
  })

  // Duplicate associations check (keep the test cases)
  ;[90, 91, 92, 93].forEach((candidateIndex, offset) => {
    const job = jobs[(candidateIndex * 3) % jobs.length]
    assignments.push({
      candidateIndex,
      consultant_name: CONSULTANTS[offset % CONSULTANTS.length],
      client_name: job.client,
      job_title: job.title,
      status: STATUSES[(candidateIndex + offset) % STATUSES.length],
      current_salary: candidates[candidateIndex].current_salary,
      expected_salary: candidates[candidateIndex].expected_salary,
      notes: 'Duplicate profile coverage for ATS testing.',
    })
    duplicateAssociations += 1
  })

  return { assignments, duplicateAssociations }
}

async function clearExistingData() {
  const { error: assocError } = await supabase
    .from('candidate_associations')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (assocError) throw assocError

  const { error: candidateError } = await supabase
    .from('candidates')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (candidateError) throw candidateError

  const { error: jobsError } = await supabase
    .from('jobs')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (jobsError) throw jobsError

  const { error: clientsError } = await supabase
    .from('clients')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (clientsError) throw clientsError
}

async function insertBatch(table, rows, chunkSize = 200) {
  let inserted = 0
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize)
    const { error } = await supabase.from(table).insert(chunk)
    if (error) throw error
    inserted += chunk.length
  }
  return inserted
}

async function main() {
  assertSafeToRun()

  await clearExistingData()

  // 1. Insert Clients
  const clientRows = CLIENTS.map(([name, contact, phone, email, city, state, status]) => ({
    name,
    contact,
    phone,
    email,
    city,
    state,
    status
  }))
  await insertBatch('clients', clientRows)

  // Fetch clients to build name -> ID map
  const { data: insertedClients, error: clientsFetchError } = await supabase
    .from('clients')
    .select('id, name')
  if (clientsFetchError) throw clientsFetchError
  const clientMap = new Map(insertedClients.map((c) => [c.name, c.id]))

  // 2. Insert Jobs
  const jobs = buildJobs()
  const jobRows = jobs.map((j) => ({
    client_id: clientMap.get(j.client),
    title: j.title,
    city: j.city,
    state: j.state,
    status: j.status,
    salary_min: j.salaryMin,
    salary_max: j.salaryMax,
    experience_label: j.experienceLabel,
    experience_min: j.experienceMin,
    completion: j.completion,
    success_count: j.successCount,
    rejected_by_client: j.rejectedByClient,
    open_positions: j.openPositions,
    notes: j.notes
  }))
  await insertBatch('jobs', jobRows)

  // Fetch jobs to build (client_name__job_title) -> ID map
  const { data: insertedJobs, error: jobsFetchError } = await supabase
    .from('jobs')
    .select('id, title, client_id, clients(name)')
  if (jobsFetchError) throw jobsFetchError
  const jobMap = new Map(insertedJobs.map((j) => [`${j.clients?.name}__${j.title}`, j.id]))

  // 3. Insert Candidates
  const candidates = buildCandidates(jobs)
  const candidateRows = candidates.map((candidate) => ({
    full_name: candidate.full_name,
    email: candidate.email,
    mobile_number: candidate.mobile_number,
    city: candidate.city,
    state: candidate.state,
    location: candidate.location,
    current_designation: candidate.current_designation,
    current_company: candidate.current_company,
    current_organisation: candidate.current_organisation,
    experience_years: candidate.experience_years,
    notice_period: candidate.notice_period,
    open_to_relocate: candidate.open_to_relocate,
    skills: candidate.skills,
    education: candidate.education,
    linkedin_url: candidate.linkedin_url,
    resume_url: candidate.resume_url,
    source: candidate.source
  }))
  await insertBatch('candidates', candidateRows)

  // Fetch candidates to build (name__phone) -> ID map
  const { data: insertedCandidates, error: fetchError } = await supabase
    .from('candidates')
    .select('id, full_name, mobile_number')
    .eq('source', 'demo-seed')
  if (fetchError) throw fetchError
  const candidateMap = new Map(insertedCandidates.map((row) => [`${row.full_name}__${row.mobile_number}`, row.id]))

  // 4. Insert Assignments
  const { assignments, duplicateAssociations } = buildAssignments(candidates, jobs)
  const associationRows = assignments.map((assignment) => {
    const candidate = candidates[assignment.candidateIndex]
    const cId = assignment.client_name ? clientMap.get(assignment.client_name) : null
    const jId = (assignment.client_name && assignment.job_title) ? jobMap.get(`${assignment.client_name}__${assignment.job_title}`) : null
    return {
      candidate_id: candidateMap.get(`${candidate.full_name}__${candidate.mobile_number}`),
      consultant_name: assignment.consultant_name,
      client_name: assignment.client_name,
      job_title: assignment.job_title,
      client_id: cId,
      job_id: jId,
      status: assignment.status,
      current_salary: assignment.current_salary,
      expected_salary: assignment.expected_salary,
      notes: assignment.notes
    }
  }).filter((row) => row.candidate_id)

  await insertBatch('candidate_associations', associationRows)

  const logLines = [
    `Clients inserted: ${clientRows.length}`,
    `Jobs inserted: ${jobRows.length}`,
    `Candidates inserted: ${candidateRows.length}`,
    `Assignments inserted: ${associationRows.length}`,
    `Duplicate candidates created: ${duplicateAssociations}`,
    `Total records created: ${clientRows.length + jobRows.length + candidateRows.length + associationRows.length}`
  ]

  console.log(logLines.join('\n'))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
