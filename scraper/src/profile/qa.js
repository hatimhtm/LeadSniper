import dns from 'node:dns/promises';

// Hard gates between research and export. A lead that fails ANY gate is rejected
// with a reason — nothing "mostly fine" ever reaches the client file. Every rule
// here maps to a real defect that shipped in the 2026-06 beta export.

const GENERIC_LOCALS = new Set([
  'info', 'support', 'hello', 'contact', 'contactus', 'sales', 'admin', 'office',
  'team', 'media', 'press', 'pr', 'legal', 'investors', 'partnerships', 'help',
  'enterprise', 'careers', 'jobs', 'talent', 'hr', 'billing', 'security', 'howdy',
  'hey', 'hi', 'mail', 'email', 'general', 'enquiries', 'inquiries', 'marketing',
]);

const PLACEHOLDER_RE = /\[[^\]]*\]|domain\.com|example\.com|founder name|your name|placeholder|\bTODO\b|XXX/i;

const REQUIRED_FIELDS = [
  'company', 'contact_name', 'title', 'linkedin', 'location', 'niche', 'hook',
  'email', 'website_domain', 'sector',
];

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function firstName(contactName) {
  return (contactName || '').split(/\s+/)[0]?.replace(/,+$/, '') || '';
}

// email local part must plausibly belong to the named person:
// first name, last name, f+last, first.last, first+l — anything else is suspect.
function emailMatchesName(email, contactName) {
  const local = normalize(email.split('@')[0]).replace(/[^a-z]/g, '');
  if (!local) return false;
  const parts = normalize(contactName)
    .replace(/,/g, ' ')
    .split(/\s+/)
    .map((p) => p.replace(/[^a-z]/g, ''))
    .filter((p) => p.length >= 2 && !['md', 'phd', 'dr', 'jr', 'sr', 'ii', 'iii'].includes(p));
  if (!parts.length) return false;
  const [first, ...rest] = parts;
  const last = rest[rest.length - 1] || '';
  const candidates = new Set([
    first, last, first + last, last + first,
    first[0] + last, first + (last[0] || ''),
    first.slice(0, 3), last.slice(0, 4),
  ].filter((c) => c && c.length >= 2));
  return [...candidates].some((c) => local === c || local.startsWith(c) || c.startsWith(local));
}

function domainsRelated(emailDomain, websiteDomain) {
  const e = normalize(emailDomain).replace(/^www\./, '');
  const w = normalize(websiteDomain).replace(/^www\./, '');
  if (!e || !w) return false;
  if (e === w) return true;
  const strip = (d) => d.split('.').slice(0, -1).join('') || d;
  const core = (d) => strip(d).replace(/[^a-z0-9]/g, '');
  return core(e).includes(core(w).slice(0, 6)) || core(w).includes(core(e).slice(0, 6));
}

export async function mxResolves(email) {
  const domain = email.split('@')[1];
  if (!domain) return false;
  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch {
    return false;
  }
}

// Validates one verified+personalized lead. Returns { pass, reasons[] }.
export async function validateLead(lead, profile, { checkMx = true } = {}) {
  const reasons = [];

  for (const f of REQUIRED_FIELDS) {
    if (!lead[f] || !String(lead[f]).trim()) reasons.push(`missing field: ${f}`);
  }

  for (const [k, v] of Object.entries(lead)) {
    if (typeof v === 'string' && PLACEHOLDER_RE.test(v)) {
      reasons.push(`placeholder text in ${k}: "${v.slice(0, 60)}"`);
    }
  }

  const email = String(lead.email || '').trim().toLowerCase();
  if (email) {
    if (!/^[a-z0-9][a-z0-9._+-]*@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) {
      reasons.push(`malformed email: ${email}`);
    } else {
      const local = email.split('@')[0].replace(/[^a-z]/g, '');
      if (GENERIC_LOCALS.has(local)) reasons.push(`generic inbox: ${email}`);
      if (!emailMatchesName(email, lead.contact_name)) {
        reasons.push(`email does not match contact name: ${lead.contact_name} <> ${email}`);
      }
      if (!domainsRelated(email.split('@')[1], lead.website_domain)) {
        reasons.push(`email domain does not match company domain: ${email} <> ${lead.website_domain}`);
      }
      if (checkMx && reasons.length === 0 && !(await mxResolves(email))) {
        reasons.push(`no MX records for ${email.split('@')[1]}`);
      }
    }
  }

  if (!/^https:\/\/(www|[a-z]{2})\.linkedin\.com\/in\/[A-Za-z0-9\-_%.]+\/?$/.test(String(lead.linkedin || ''))) {
    reasons.push(`bad LinkedIn URL: ${lead.linkedin}`);
  }

  const roleOk = (profile.icp.buyer_roles || []).some((r) =>
    normalize(lead.title).includes(normalize(r))
  );
  if (!roleOk) reasons.push(`title not a target buyer role: ${lead.title}`);

  if (!['published', 'pattern'].includes(lead.email_source)) {
    reasons.push(`email_source is ${lead.email_source || 'unset'} (need published or pattern)`);
  }

  return { pass: reasons.length === 0, reasons };
}

// Validates assembled outreach copy against the lead it claims to address.
export function validateCopy(lead, profile) {
  const reasons = [];
  const first = firstName(lead.contact_name);
  const greeting = profile.voice.greeting.replace('{first}', first);

  if (!lead.email_outreach?.startsWith(greeting.split('?')[0])) {
    reasons.push('email greeting does not match contact first name');
  }
  if (!lead.email_outreach?.includes(lead.company)) reasons.push('email never names the company');
  if (!lead.email_outreach?.trimEnd().endsWith(profile.voice.signoff.split('\n').pop())) {
    reasons.push('email missing signoff');
  }
  if (!lead.dm?.startsWith(`Hi ${first},`)) reasons.push('DM greeting mismatch');
  if ((lead.dm || '').length > 400) reasons.push(`DM too long: ${lead.dm.length} chars`);
  if ((lead.subject || '').length > 70) reasons.push(`subject too long: ${lead.subject.length}`);
  for (const k of ['email_outreach', 'dm', 'subject', 'why', 'category']) {
    if (PLACEHOLDER_RE.test(lead[k] || '')) reasons.push(`placeholder in ${k}`);
  }
  return { pass: reasons.length === 0, reasons };
}

// Final whole-batch check before the file is written.
export function validateBatch(leads, profile) {
  const reasons = [];
  const seen = new Set();
  const excluded = new Set((profile.exclude_companies || []).map(normalize));
  for (const L of leads) {
    const key = normalize(L.company);
    if (seen.has(key)) reasons.push(`duplicate company: ${L.company}`);
    seen.add(key);
    if (excluded.has(key)) reasons.push(`excluded company slipped through: ${L.company}`);
  }
  return { pass: reasons.length === 0, reasons };
}
