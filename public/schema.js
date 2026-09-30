// Brick types. Add a new type here and it shows up in the editor automatically;
// add a matching renderer in render.js to control how it prints.
// Colors are classic toy-brick colors so each type is easy to spot.

const dates = [
  { key: 'start', label: 'Start', placeholder: '2025-06' },
  { key: 'end', label: 'End', placeholder: '2025-08 or present' },
];
const bullets = { key: 'bullets', label: 'Bullets', kind: 'list' };

export const TYPES = {
  header: {
    label: 'Header',
    color: '#c91a09',
    section: null,
    fields: [
      { key: 'name', label: 'Full name' },
      { key: 'headline', label: 'Headline (optional)' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'location', label: 'Location' },
      { key: 'links', label: 'Links', kind: 'links' },
    ],
  },
  summary: {
    label: 'Summary',
    color: '#f2cd37',
    section: 'Summary',
    fields: [{ key: 'text', label: 'Text', kind: 'textarea' }],
  },
  experience: {
    label: 'Experience',
    color: '#0055bf',
    section: 'Experience',
    fields: [
      { key: 'role', label: 'Role / title' },
      { key: 'org', label: 'Organization' },
      { key: 'location', label: 'Location' },
      ...dates,
      bullets,
    ],
  },
  education: {
    label: 'Education',
    color: '#237841',
    section: 'Education',
    fields: [
      { key: 'school', label: 'School' },
      { key: 'degree', label: 'Degree / program' },
      { key: 'location', label: 'Location' },
      ...dates,
      bullets,
    ],
  },
  project: {
    label: 'Project',
    color: '#923978',
    section: 'Projects',
    fields: [
      { key: 'name', label: 'Project name' },
      { key: 'role', label: 'Your role (optional)' },
      { key: 'link', label: 'Link (optional)', placeholder: 'https://…' },
      ...dates,
      bullets,
    ],
  },
  skills: {
    label: 'Skills',
    color: '#fe8a18',
    section: 'Skills',
    fields: [
      { key: 'label', label: 'Group label', placeholder: 'Software' },
      { key: 'items', label: 'Items', kind: 'tags' },
    ],
  },
  certification: {
    label: 'Certification',
    color: '#078bc9',
    section: 'Certifications',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'issuer', label: 'Issuer' },
      { key: 'date', label: 'Date', placeholder: '2026-03' },
    ],
  },
  award: {
    label: 'Award',
    color: '#a0a5a9',
    section: 'Awards',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'issuer', label: 'Issuer' },
      { key: 'date', label: 'Date', placeholder: '2026-05' },
    ],
  },
  custom: {
    label: 'Custom',
    color: '#1b2a34',
    section: null,
    fields: [
      { key: 'heading', label: 'Heading (optional)' },
      { key: 'right', label: 'Right-side text (optional)' },
      { key: 'text', label: 'Text', kind: 'textarea' },
      bullets,
    ],
  },
};

export const TYPE_ORDER = Object.keys(TYPES);

export const SECTION_PRESETS = [
  'Summary',
  'Experience',
  'Education',
  'Projects',
  'Leadership',
  'Skills',
  'Certifications',
  'Awards',
];

const clip = (s, n = 48) => {
  s = String(s ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

/** Human label for a brick in the library. `title` always wins if set. */
export function blockLabel(b) {
  if (!b) return '';
  if (b.title) return String(b.title);
  switch (b.type) {
    case 'header':
      return b.name || 'Header';
    case 'summary':
      return clip(b.text) || 'Summary';
    case 'experience':
      return [b.role, b.org].filter(Boolean).join(' · ') || 'Experience';
    case 'education':
      return b.school || 'Education';
    case 'project':
      return b.name || 'Project';
    case 'skills':
      return b.label || clip((b.items || []).join(', ')) || 'Skills';
    case 'certification':
    case 'award':
      return b.name || TYPES[b.type].label;
    case 'custom':
      return b.heading || clip(b.text) || 'Custom';
    default:
      return b.id || 'Brick';
  }
}
