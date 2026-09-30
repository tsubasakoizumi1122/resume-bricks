import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concepts, analyzeJob } from '../public/tailor.js';
import { PHRASES, SYNONYMS, GAP_VOCAB, TERM_LABELS } from '../public/vocab.js';

// One row per occupation: a job post, a brick that fits it, a brick that doesn't,
// concepts the match report should show, and tools/credentials it should flag as missing.
const CASES = [
  {
    field: 'software engineering',
    job: 'Backend Software Engineer. Build REST APIs in Node.js and TypeScript, deploy with Docker and Kubernetes on AWS, CI/CD. Go or Rust a plus.',
    fit: 'Built REST APIs in Node.js on AWS; containerized services with Docker; set up CI/CD with GitHub Actions',
    matched: ['api', 'nodejs', 'docker', 'aws', 'cicd'],
    missing: ['kubernetes', 'typescript', 'rust'],
  },
  {
    field: 'data science',
    job: 'Data Scientist: machine learning models in Python (pandas, scikit-learn), SQL on Snowflake, dashboards in Tableau.',
    fit: 'Trained machine learning models in Python with scikit-learn; wrote SQL and built dashboards',
    matched: ['machinelearning', 'python', 'sql', 'dataviz'],
    missing: ['snowflake', 'tableau'],
  },
  {
    field: 'product & design',
    job: 'Product Designer: UX/UI for web and mobile, user research, wireframes and prototypes in Figma, maintain the design system.',
    fit: 'Ran usability testing and designed wireframes in Figma; contributed to our design system',
    matched: ['ux', 'uxresearch', 'figma', 'designsystem'],
    missing: [],
  },
  {
    field: 'sales',
    job: 'Account Executive: own quota, cold calling and prospecting, manage the sales pipeline in Salesforce, negotiate renewals.',
    fit: 'Exceeded quota 3 quarters in a row; prospected via cold outreach and managed pipeline in HubSpot CRM',
    matched: ['sales', 'prospecting', 'crm'],
    missing: ['salesforce'],
  },
  {
    field: 'customer support',
    job: 'Customer Support Specialist: resolve tickets in Zendesk, troubleshoot account issues, keep CSAT high.',
    fit: 'Resolved 60 tickets a day at the help desk, troubleshooting login issues, CSAT 96%',
    matched: ['customersupport', 'troubleshooting', 'customersatisfaction'],
    missing: ['zendesk'],
  },
  {
    field: 'accounting',
    job: 'Staff Accountant: accounts payable and receivable, month-end close, reconciliations, GAAP. CPA preferred. NetSuite.',
    fit: 'Handled accounts payable, bank reconciliations and month-end close for a 40-person company in QuickBooks',
    matched: ['accounting'],
    missing: ['cpa', 'netsuite', 'gaap'],
  },
  {
    field: 'HR',
    job: 'HR Generalist: talent acquisition, onboarding, employee relations, payroll in ADP, HRIS (Workday).',
    fit: 'Ran recruiting for 30 roles a year, onboarding new hires, and payroll through ADP',
    matched: ['recruiting', 'payroll', 'adp'],
    missing: ['workday'],
  },
  {
    field: 'operations & logistics',
    job: 'Operations Coordinator: supply chain and inventory management, vendor management, process improvement. Six Sigma and forklift certification a plus.',
    fit: 'Managed inventory control for a 50,000 sq ft warehouse and led a process improvement project that cut pick errors 30%',
    matched: ['inventory', 'logistics', 'processimprovement'],
    missing: ['sixsigma', 'forklift'],
  },
  {
    field: 'nursing',
    job: 'Registered Nurse, Med-Surg. Patient care for 5-6 patients, medication administration, charting in Epic EHR. BLS and ACLS required.',
    fit: 'Provided direct patient care on a 30-bed unit, administered medications, documented in electronic health records',
    matched: ['patientcare', 'ehr'],
    missing: ['bls', 'acls', 'epic'],
  },
  {
    field: 'teaching',
    job: 'Middle School Math Teacher (K-12 certified). Lesson planning, classroom management, differentiate for ESL learners and IEPs. Teaching license required.',
    fit: 'Taught 7th grade math to 120 students; wrote lesson plans and managed a classroom with ESL and IEP students',
    matched: ['teaching', 'lessonplanning', 'esl', 'specialeducation'],
    missing: ['teachinglicense'],
  },
  {
    field: 'legal',
    job: 'Paralegal: legal research in Westlaw, draft contracts, support litigation and e-discovery.',
    fit: 'Performed legal research and drafted contracts for a litigation team',
    matched: ['legal', 'legalresearch', 'contracts', 'litigation'],
    missing: ['westlaw'],
  },
  {
    field: 'hospitality & food',
    job: 'Restaurant Shift Lead: food and beverage service, POS, food safety, train new staff, guest experience.',
    fit: 'Barista and shift supervisor: opened the cafe, trained new baristas, handled the POS, ServSafe certified',
    matched: ['foodservice', 'pos', 'foodsafety'],
    missing: [],
  },
  {
    field: 'engineering & trades',
    job: 'Mechanical Engineer: design parts in SolidWorks, run tests, follow OSHA safety rules. PE license a plus. MATLAB.',
    fit: 'Designed brackets in SolidWorks (CAD) and ran load tests; followed OSHA site safety rules',
    matched: ['cad', 'osha', 'safety'],
    missing: ['pe', 'matlab'],
  },
  {
    field: 'admin',
    job: 'Administrative Assistant: calendar management, travel arrangements, data entry, Microsoft Office.',
    fit: 'Office manager: scheduled meetings, booked travel arrangements, data entry in Excel and Microsoft Office',
    matched: ['admin', 'scheduling', 'dataentry', 'msoffice'],
    missing: [],
  },
];

const OFF = { id: 'off', type: 'experience', role: 'Dog walker', org: 'Neighborhood', bullets: ['Walked dogs twice a day', 'Kept a pickup schedule'] };

for (const c of CASES) {
  test(`tailor vocabulary: ${c.field}`, () => {
    const fit = { id: 'fit', type: 'experience', role: 'Role', org: 'Org', bullets: [c.fit] };
    const a = analyzeJob(c.job, [fit, OFF]);
    const score = (id) => a.scored.find((s) => s.id === id).score;
    assert.ok(score('fit') > score('off'), 'fitting brick scores higher');
    const got = new Set(concepts(c.fit));
    for (const m of c.matched) assert.ok(got.has(m) && concepts(c.job).includes(m), `both mention ${m}`);
    for (const m of c.missing) assert.ok(a.missing.includes(m), `flags missing ${m} (got ${a.missing.join(', ')})`);
  });
}

test('words that mean different things in different jobs are not confused', () => {
  const has = (text, c) => concepts(text).includes(c);
  assert.ok(!has('Software development and unit testing', 'realestate'), 'development is not real estate');
  assert.ok(!has('Wrote unit tests for the API', 'abtest'), 'unit tests are not A/B tests');
  assert.ok(has('Ran A/B tests on landing pages', 'abtest'));
  assert.ok(!has('Built data pipelines in Airflow', 'salespipeline'));
  assert.ok(!has('Team lead for 4 engineers', 'leadgen'), 'team lead is not lead generation');
  assert.ok(!has('Business development for B2B accounts', 'softwaredev'));
  assert.ok(!has('Onboarding new hires', 'lifecycle'));
  assert.ok(has('Commercial real estate brokerage', 'commercial') && has('Commercial real estate brokerage', 'realestate'));
});

test('vocabulary is well-formed', () => {
  for (const [re, rep] of PHRASES) {
    assert.ok(re.global, `${re} needs the g flag`);
    assert.match(rep, /^[a-z0-9]+(?: [a-z0-9]+)*$/, `phrase token "${rep}"`);
  }
  for (const [w, cs] of Object.entries(SYNONYMS)) for (const c of cs) assert.match(c, /^[a-z0-9]+$/, `${w} -> ${c}`);
  for (const t of GAP_VOCAB) assert.match(t, /^[a-z0-9]+$/, `tool "${t}"`);
  for (const t of GAP_VOCAB) assert.ok(TERM_LABELS[t] || /^[a-z]+$/.test(t), `label for ${t}`);
});
