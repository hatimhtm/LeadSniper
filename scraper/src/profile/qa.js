import dns from 'node:dns/promises';
import net from 'node:net';

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
  'email', 'website_domain', 'sector', 'funding',
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

// SMTP handshake probe: connect to the domain's MX and issue RCPT TO without
// sending mail. Returns:
//   'deliverable'  server accepted the exact mailbox and rejected a random one
//   'accept-all'   server accepts anything at the domain (probe can't confirm)
//   'rejected'     server explicitly refused the mailbox — hard fail
//   'unknown'      port 25 blocked/greylisted/timeout — probe inconclusive
// Many networks block outbound 25, so 'unknown' must never fail a lead on its own.
export async function smtpProbe(email, { timeoutMs = 12000 } = {}) {
  const domain = email.split('@')[1];
  let mx;
  try {
    const records = await dns.resolveMx(domain);
    if (!records.length) return 'rejected';
    mx = records.sort((a, b) => a.priority - b.priority)[0].exchange;
  } catch {
    return 'rejected';
  }

  const randomLocal = `qa-probe-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve) => {
    const socket = net.createConnection(25, mx);
    let buffer = '';
    let step = 0;
    let realStatus = null;
    const finish = (result) => { socket.destroy(); resolve(result); };
    const timer = setTimeout(() => finish('unknown'), timeoutMs);
    socket.on('error', () => { clearTimeout(timer); finish('unknown'); });
    socket.on('close', () => { clearTimeout(timer); resolve('unknown'); });

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!/\r?\n$/.test(buffer)) return;
      const code = parseInt(buffer.slice(0, 3), 10);
      // ignore multiline continuations like "250-"
      if (buffer.split('\n').filter(Boolean).pop()?.[3] === '-') return;
      buffer = '';
      clearTimeout(timer);
      const next = setTimeout(() => finish('unknown'), timeoutMs);
      socket.once('close', () => clearTimeout(next));

      if (step === 0 && code === 220) { socket.write('EHLO mail.leadsniper.dev\r\n'); step = 1; }
      else if (step === 1 && code === 250) { socket.write('MAIL FROM:<verify@leadsniper.dev>\r\n'); step = 2; }
      else if (step === 2 && code === 250) { socket.write(`RCPT TO:<${email}>\r\n`); step = 3; }
      else if (step === 3) {
        if (code === 250 || code === 251) {
          realStatus = 'accepted';
          socket.write(`RCPT TO:<${randomLocal}@${domain}>\r\n`);
          step = 4;
        } else if (code >= 550 && code <= 554) {
          clearTimeout(next); finish('rejected');
        } else { clearTimeout(next); finish('unknown'); }
      } else if (step === 4) {
        clearTimeout(next);
        if (code === 250 || code === 251) finish('accept-all');
        else finish(realStatus === 'accepted' ? 'deliverable' : 'unknown');
      } else { clearTimeout(next); finish('unknown'); }
    });
  });
}

// Validates one verified+personalized lead. Returns { pass, reasons[] }.
export async function validateLead(lead, profile, { checkMx = true, checkSmtp = false } = {}) {
  const reasons = [];

  for (const f of REQUIRED_FIELDS) {
    if (!lead[f] || !String(lead[f]).trim()) reasons.push(`missing field: ${f}`);
  }

  // funding must carry actual numbers ("$126M, 2025"), not vibes.
  if (lead.funding && !/\d/.test(String(lead.funding))) {
    reasons.push(`funding has no numbers: ${lead.funding}`);
  }

  // emerging-stage caps: a paid best-of list for an "emerging leader" buyer
  // must not carry unicorns, public companies, or mega-raised incumbents
  const caps = profile.icp?.stage_caps;
  if (caps) {
    if (lead.is_public === true) {
      reasons.push('publicly traded — past emerging stage');
    }
    if (typeof lead.valuation_musd === 'number' && lead.valuation_musd >= caps.max_valuation_musd) {
      reasons.push(`valuation $${lead.valuation_musd}M is at/above the $${caps.max_valuation_musd}M emerging-stage cap`);
    }
    if (typeof lead.total_raised_musd === 'number' && lead.total_raised_musd > caps.max_total_raised_musd) {
      reasons.push(`total raised $${lead.total_raised_musd}M exceeds the $${caps.max_total_raised_musd}M emerging-stage cap`);
    }
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
      if (checkSmtp && reasons.length === 0) {
        lead.email_smtp = await smtpProbe(email);
        if (lead.email_smtp === 'rejected') {
          reasons.push(`SMTP server refused mailbox ${email}`);
        }
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
  const seenPeople = new Set();
  const seenEmails = new Set();
  const excluded = new Set((profile.exclude_companies || []).map(normalize));
  for (const L of leads) {
    const key = normalize(L.company);
    if (seen.has(key)) reasons.push(`duplicate company: ${L.company}`);
    seen.add(key);
    if (excluded.has(key)) reasons.push(`excluded company slipped through: ${L.company}`);
    const person = normalize(L.contact_name);
    if (person && seenPeople.has(person)) reasons.push(`duplicate contact: ${L.contact_name}`);
    seenPeople.add(person);
    const email = normalize(L.email);
    if (email && seenEmails.has(email)) reasons.push(`duplicate email: ${L.email}`);
    seenEmails.add(email);
  }
  return { pass: reasons.length === 0, reasons };
}
