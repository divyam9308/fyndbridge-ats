/** @typedef {'active' | 'on_leave' | 'inactive'} EmployeeStatus */

/**
 * @typedef {Object} LinkedRecord
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} Employee
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {string=} mobile
 * @property {EmployeeStatus} status
 * @property {LinkedRecord[]} clients
 * @property {LinkedRecord[]} mandates
 * @property {LinkedRecord[]} candidates
 */

/** @type {Employee[]} */
export const EMPLOYEE_MANAGEMENT_MOCK_DATA = [
  {
    id: 'emp-ankita-tandon',
    name: 'Ankita Tandon',
    email: 'ankita.tandon@fyndbridge.com',
    mobile: '+91 98765 31042',
    status: 'active',
    clients: [
      { id: 'client-northstar', name: 'Northstar Retail' },
      { id: 'client-kelvin', name: 'Kelvin Digital' },
      { id: 'client-vistara', name: 'Vistara Systems' },
      { id: 'client-urban-grid', name: 'Urban Grid' },
      { id: 'client-axis', name: 'Axis Enterprises' }
    ],
    mandates: [
      { id: 'mandate-product-manager', name: 'Product Manager' },
      { id: 'mandate-senior-recruiter', name: 'Senior Recruiter' },
      { id: 'mandate-data-analyst', name: 'Data Analyst' }
    ],
    candidates: [
      { id: 'candidate-aanya', name: 'Aanya Kapoor' },
      { id: 'candidate-aditya', name: 'Aditya Jain' },
      { id: 'candidate-bhavya', name: 'Bhavya Rao' },
      { id: 'candidate-dev', name: 'Dev Malhotra' },
      { id: 'candidate-kabir', name: 'Kabir Mehta' },
      { id: 'candidate-meera', name: 'Meera Shah' }
    ]
  },
  {
    id: 'emp-cherry-sagar',
    name: 'Cherry Sagar',
    email: 'cherry.sagar@fyndbridge.com',
    mobile: '+91 98107 22419',
    status: 'on_leave',
    clients: [
      { id: 'client-bluepeak', name: 'BluePeak Consulting' },
      { id: 'client-novus', name: 'Novus Health' }
    ],
    mandates: [
      { id: 'mandate-finance-lead', name: 'Finance Lead' },
      { id: 'mandate-hrbp', name: 'HR Business Partner' }
    ],
    candidates: [
      { id: 'candidate-ishita', name: 'Ishita Verma' },
      { id: 'candidate-rohan', name: 'Rohan Arora' },
      { id: 'candidate-tanvi', name: 'Tanvi Sethi' }
    ]
  },
  {
    id: 'emp-divya-adhikari',
    name: 'Divya Adhikari',
    email: 'divya.adhikari@fyndbridge.com',
    status: 'active',
    clients: [
      { id: 'client-meridian', name: 'Meridian Labs' },
      { id: 'client-arcstone', name: 'Arcstone Group' },
      { id: 'client-summit', name: 'Summit Works' }
    ],
    mandates: [
      { id: 'mandate-java-engineer', name: 'Java Engineer' },
      { id: 'mandate-sales-director', name: 'Sales Director' },
      { id: 'mandate-ui-designer', name: 'UI Designer' },
      { id: 'mandate-operations', name: 'Operations Manager' }
    ],
    candidates: [
      { id: 'candidate-anmol', name: 'Anmol Batra' },
      { id: 'candidate-kritika', name: 'Kritika Bose' }
    ]
  },
  {
    id: 'emp-indeep-kaur',
    name: 'Indeep Kaur',
    email: 'indeep.kaur@fyndbridge.com',
    mobile: '+91 99712 64380',
    status: 'active',
    clients: [{ id: 'client-crescent', name: 'Crescent Mobility' }],
    mandates: [{ id: 'mandate-talent-partner', name: 'Talent Partner' }],
    candidates: [
      { id: 'candidate-juhi', name: 'Juhi Nair' },
      { id: 'candidate-manish', name: 'Manish Gupta' },
      { id: 'candidate-neha', name: 'Neha Dutta' },
      { id: 'candidate-rahul', name: 'Rahul Soni' }
    ]
  },
  {
    id: 'emp-mohit-kumar',
    name: 'Mohit Kumar',
    email: 'mohit.kumar@fyndbridge.com',
    status: 'inactive',
    clients: [],
    mandates: [],
    candidates: []
  },
  {
    id: 'emp-nisha-sharma',
    name: 'Nisha Sharma',
    email: 'nisha.sharma@fyndbridge.com',
    mobile: '+91 99102 88317',
    status: 'active',
    clients: [
      { id: 'client-pulse', name: 'Pulse Analytics' },
      { id: 'client-orbit', name: 'Orbit Commerce' }
    ],
    mandates: [
      { id: 'mandate-cloud-architect', name: 'Cloud Architect' },
      { id: 'mandate-growth-manager', name: 'Growth Manager' }
    ],
    candidates: [{ id: 'candidate-samara', name: 'Samara Khan' }]
  },
  {
    id: 'emp-palak-arora',
    name: 'Palak Arora',
    email: 'palak.arora@fyndbridge.com',
    status: 'on_leave',
    clients: [{ id: 'client-elevate', name: 'Elevate Financial' }],
    mandates: [{ id: 'mandate-business-analyst', name: 'Business Analyst' }],
    candidates: [
      { id: 'candidate-veer', name: 'Veer Khanna' },
      { id: 'candidate-yash', name: 'Yash Bedi' }
    ]
  },
  {
    id: 'emp-rajneesh-aggarwal',
    name: 'Rajneesh Aggarwal',
    email: 'rajneesh.aggarwal@fyndbridge.com',
    mobile: '+91 98991 45206',
    status: 'active',
    clients: [
      { id: 'client-apex', name: 'Apex Manufacturing' },
      { id: 'client-prism', name: 'Prism Networks' }
    ],
    mandates: [
      { id: 'mandate-plant-head', name: 'Plant Head' },
      { id: 'mandate-network-engineer', name: 'Network Engineer' }
    ],
    candidates: [
      { id: 'candidate-aarav', name: 'Aarav Sinha' },
      { id: 'candidate-sakshi', name: 'Sakshi Anand' },
      { id: 'candidate-vivan', name: 'Vivan Das' }
    ]
  }
]
