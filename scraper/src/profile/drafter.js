import { firstName } from './qa.js';

// Deterministic voice assembly. Gemini only supplies the personalized fragments
// (p2, closer, dm_clause, subject, category, why) — the skeleton, intro, sector
// line, ask, and signoff come verbatim from the profile. The voice can therefore
// never drift and a hallucinated template can never reach the export.

export function assembleEmail(record, fragments, profile) {
  const first = firstName(record.contact_name);
  const v = profile.voice;
  const sectorLine = v.sector_lines[record.sector] || v.sector_lines.health;
  return [
    v.greeting.replace('{first}', first),
    fragments.p2,
    v.intro,
    sectorLine,
    `${fragments.closer} ${v.ask.replace('{company}', record.company)}`,
    v.signoff,
  ].join('\n\n');
}

export function assembleDm(record, fragments, profile) {
  const first = firstName(record.contact_name);
  const v = profile.voice;
  return v.dm_template
    .replace('{first}', first)
    .replace(/\{company\}/g, record.company)
    .replace('{dm_clause}', stripTrailingPeriod(fragments.dm_clause))
    .replace('{dm_sector}', v.dm_sector_words[record.sector] || 'healthcare');
}

function stripTrailingPeriod(s) {
  return (s || '').trim().replace(/\.+$/, '');
}

// Polish: consistent title style across every row ("CEO and Co-Founder" →
// "CEO & Co-founder"). Word order is never touched — only casing and ampersands.
export function normalizeTitle(title) {
  return (title || '')
    .replace(/\s+/g, ' ')
    .replace(/\band\b/gi, '&')
    .replace(/co[-\s]?founder/gi, 'Co-founder')
    .replace(/\bceo\b/gi, 'CEO')
    .trim();
}

export function buildLead(record, fragments, profile) {
  return {
    ...record,
    title: normalizeTitle(record.title),
    email: String(record.email || '').trim().toLowerCase(),
    category: fragments.category,
    why: fragments.why,
    subject: fragments.subject,
    email_outreach: assembleEmail(record, fragments, profile),
    dm: assembleDm(record, fragments, profile),
  };
}
