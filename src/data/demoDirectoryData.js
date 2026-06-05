const CLIENT_SEEDS = [
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
  'React Developer',
  'Node Developer',
  'Full Stack Developer',
  'Java Developer',
  'Python Developer',
  'Data Analyst',
  'Data Engineer',
  'Business Analyst',
  'Sales Manager',
  'HR Executive',
  'Recruiter',
  'Finance Manager',
  'Project Manager',
  'QA Engineer',
  'DevOps Engineer',
  'UI/UX Designer',
  'Product Manager',
  'Operations Manager',
  'Marketing Executive',
  'Support Engineer'
]

const JOB_STATUSES = ['Open', 'Active', 'On Hold', 'Closed', 'Filled']

const EXPERIENCE_RANGES = [
  '1-3 years',
  '2-4 years',
  '3-5 years',
  '4-6 years',
  '5-8 years',
  '8-12 years'
]

const TITLE_SKILLS = {
  'React Developer': ['React', 'JavaScript', 'CSS'],
  'Node Developer': ['Node.js', 'Express', 'API'],
  'Full Stack Developer': ['React', 'Node.js', 'SQL'],
  'Java Developer': ['Java', 'Spring Boot', 'Microservices'],
  'Python Developer': ['Python', 'Django', 'REST'],
  'Data Analyst': ['SQL', 'Excel', 'Power BI'],
  'Data Engineer': ['Python', 'ETL', 'SQL'],
  'Business Analyst': ['Requirements', 'Stakeholders', 'SQL'],
  'Sales Manager': ['B2B Sales', 'CRM', 'Negotiation'],
  'HR Executive': ['Recruitment', 'HR Ops', 'Coordination'],
  'Recruiter': ['Sourcing', 'Screening', 'ATS'],
  'Finance Manager': ['Financial Planning', 'MIS', 'Budgeting'],
  'Project Manager': ['Planning', 'Delivery', 'Risk'],
  'QA Engineer': ['Testing', 'Automation', 'Jira'],
  'DevOps Engineer': ['AWS', 'Docker', 'CI/CD'],
  'UI/UX Designer': ['Figma', 'Wireframing', 'Research'],
  'Product Manager': ['Roadmap', 'Discovery', 'Analytics'],
  'Operations Manager': ['Operations', 'Process', 'MIS'],
  'Marketing Executive': ['Campaigns', 'SEO', 'Content'],
  'Support Engineer': ['Troubleshooting', 'Ticketing', 'Linux']
}

const salaryRangeForIndex = (index) => {
  const min = 400000 + ((index * 175000) % 2200000)
  return [min, min + 500000 + ((index % 5) * 150000)]
}

export const DEMO_JOBS = (() => {
  let jobId = 1
  return CLIENT_SEEDS.flatMap((clientSeed, clientIndex) => {
    const [clientName, , , , city, state] = clientSeed
    const count = clientIndex < 10 ? 4 : 3
    return Array.from({ length: count }, (_, offset) => {
      const title = JOB_TITLES[(clientIndex * 3 + offset) % JOB_TITLES.length]
      const [salaryMin, salaryMax] = salaryRangeForIndex(jobId)
      const status = JOB_STATUSES[(clientIndex + offset) % JOB_STATUSES.length]
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
        experience: EXPERIENCE_RANGES[(clientIndex + offset) % EXPERIENCE_RANGES.length],
        completion,
        successCount: status === 'Filled' ? 1 + ((clientIndex + offset) % 3) : (jobId + clientIndex) % 2,
        rejectedByClient: (clientIndex + offset) % 5,
        openPositions: status === 'Filled' || status === 'Closed' ? 0 : 1 + ((clientIndex + offset) % 4),
        skills: TITLE_SKILLS[title],
        jd: '',
        notes: `${title} mandate for ${clientName}.`,
      }
    })
  })
})()

export const DEMO_CLIENTS = CLIENT_SEEDS.map(([name, contact, phone, email, city, state, status], index) => ({
  id: index + 1,
  name,
  contact,
  phone: `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`,
  email,
  city,
  state,
  status,
  activeJobs: DEMO_JOBS.filter((job) => job.client === name && (job.status === 'Open' || job.status === 'Active')).length,
  notes: '',
}))

