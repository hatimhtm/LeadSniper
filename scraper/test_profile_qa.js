// Offline test for profile-mode QA gates + exporter.
// 1. Every category of defect from the 2026-06 bad export must be REJECTED.
// 2. Known-good leads (the hand-verified 2026-07-07 delivery) must PASS.
// 3. The exporter output must match the expected delivery structure.
import fs from 'node:fs';
import { validateLead, validateCopy, validateBatch } from './src/profile/qa.js';
import { buildLead, normalizeTitle } from './src/profile/drafter.js';
import { exportXlsx, exportCsv } from './src/profile/export.js';

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/example.json', import.meta.url), 'utf8'));

let failures = 0;
const t = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const good = {
  company: 'Aidoc', sector: 'health', contact_name: 'Elad Walach', first_name: 'Elad',
  title: 'Co-founder & CEO', linkedin: 'https://www.linkedin.com/in/elad-walach/',
  location: 'New York, US', funding: 'Series E, $150M, 2026', website_domain: 'aidoc.com',
  niche: 'Software that reads hospital scans and flags urgent problems so doctors act sooner.',
  hook: '$150M Series E, live in 2,000 hospitals', email: 'elad@aidoc.com',
  email_source: 'published', email_evidence: 'ContactOut',
};

// Each bad lead reproduces a real defect from the June export.
const bads = [
  ['placeholder email', { ...good, email: 'user@domain.com', website_domain: 'domain.com' }],
  ['placeholder name', { ...good, contact_name: '[Founder Name]' }],
  ['generic inbox', { ...good, email: 'info@aidoc.com' }],
  ['wrong-person email', { ...good, email: 'luke.doyle@aidoc.com' }],
  ['wrong-company domain', { ...good, email: 'elad@sellersdorsey.com' }],
  ['no email found', { ...good, email: '', email_source: 'none' }],
  ['non-buyer role', { ...good, title: 'VP of Sales' }],
  ['bad linkedin', { ...good, linkedin: 'https://www.linkedin.com/company/aidoc' }],
  ['missing hook', { ...good, hook: '' }],
  ['funding without numbers', { ...good, funding: 'well funded' }],
  ['unicorn valuation', { ...good, valuation_musd: 3500 }],
  ['over-raised incumbent', { ...good, total_raised_musd: 404 }],
  ['public company', { ...good, is_public: true }],
  ['dead MX domain', { ...good, email: 'elad@aidoc-no-such-domain-xyz123.com', website_domain: 'aidoc-no-such-domain-xyz123.com' }],
];

for (const [name, lead] of bads) {
  const { pass, reasons } = await validateLead(lead, profile);
  t(`rejects ${name} (${reasons[0] || ''})`, !pass);
}

const goodCheck = await validateLead(good, profile);
t(`accepts known-good lead ${goodCheck.reasons.join(';')}`, goodCheck.pass);

// accent handling: Virgílio must match vbento@
const accent = { ...good, contact_name: 'Virgílio Bento', email: 'vbento@swordhealth.com', website_domain: 'swordhealth.com', linkedin: 'https://www.linkedin.com/in/vbento' };
const accentCheck = await validateLead(accent, profile);
t(`accepts accented name pattern email ${accentCheck.reasons.join(';')}`, accentCheck.pass);

// copy assembly + validation
const fragments = {
  category: 'AI radiology',
  why: 'Well funded, founder led imaging AI leader with an IPO on the horizon.',
  subject: 'The Aidoc story ahead of its next chapter',
  p2: 'What Aidoc does, catching urgent cases hiding in millions of scans, is genuinely important. With nearly two thousand hospitals live, the story deserves to travel further.',
  closer: 'Ahead of the milestones you are building toward, this is exactly the moment a clear story pays off.',
  dm_clause: 'catching urgent findings in scans so doctors act sooner is genuinely important',
};
const assembled = buildLead(good, fragments, profile);
const copyCheck = validateCopy(assembled, profile);
t(`assembled copy passes (${copyCheck.reasons.join(';')})`, copyCheck.pass);
t('email greeting personalized', assembled.email_outreach.startsWith('Hey Elad, how are you?'));
t('email contains intro verbatim', assembled.email_outreach.includes(profile.voice.intro));
t('email signs off', assembled.email_outreach.trimEnd().endsWith(profile.voice.signoff.split('\n').pop()));
t('dm under 400 chars and personalized', assembled.dm.startsWith('Hi Elad,') && assembled.dm.length < 400);

// copy validator catches placeholder fragments
const brokenCopy = buildLead(good, { ...fragments, p2: 'Dear [Founder Name], great work.' }, profile);
t('rejects placeholder in assembled copy', !validateCopy(brokenCopy, profile).pass);

// batch: duplicates + excluded companies blocked
t('batch rejects duplicate company', !validateBatch([assembled, assembled], profile).pass);
const excluded = { ...assembled, company: profile.exclude_companies[1] };
t('batch rejects excluded company', !validateBatch([excluded], profile).pass);
// note: 'Aidoc' itself is on the delivered-exclusion list, which validateBatch
// enforces — so the clean-set check needs a company not yet delivered
const fresh = { ...assembled, company: 'FreshCo Health' };
t('batch rejects already-delivered company (Aidoc)', !validateBatch([assembled], profile).pass);
t('batch accepts clean set', validateBatch([fresh], profile).pass);

// polish: title normalization
t('normalizes "and" to "&" and Co-founder casing', normalizeTitle('CEO and Co-Founder') === 'CEO & Co-founder');
t('buildLead applies title normalization', buildLead({ ...good, title: 'ceo and co-founder' }, fragments, profile).title === 'CEO & Co-founder');

// batch dedupe: same person or same email across different companies
const dupPerson = { ...assembled, company: 'OtherCo', email: 'elad@otherco.com', website_domain: 'otherco.com' };
t('batch rejects duplicate contact across companies', !validateBatch([{ ...assembled, company: 'FreshCo A' }, { ...dupPerson, company: 'FreshCo B' }], profile).pass);
const dupEmail = { ...assembled, company: 'FreshCo C', contact_name: 'Someone Else' };
t('batch rejects duplicate email', !validateBatch([{ ...assembled, company: 'FreshCo A' }, dupEmail], profile).pass);

// exporter structure check
const outX = '/tmp/test-profile-export.xlsx';
assembled.site_news = 'Launched Foo 2.0';
const outC = '/tmp/test-profile-export.csv';
await exportXlsx([assembled], profile, outX, '2026-07-07');
exportCsv([assembled], outC);
const ExcelJS = (await import('exceljs')).default;
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(outX);
const ws = wb.getWorksheet('Leads');
t('cover sheet is first: Read me first, Leads, Business', wb.worksheets.map((w) => w.name).join() === 'Read me first,Leads,Business');
t('title block merged and branded', ws.getCell('B1').isMerged && ws.getCell('A3').value.text === profile.brand);
t('header row matches 15-col layout', JSON.stringify(ws.getRow(4).values.slice(1)) === JSON.stringify(['#','Company','Contact','Role','Category','Funding','Location','Email','LinkedIn','Niche',"What's happening now",'Why they fit','Email subject','Email outreach','DM opener']));
t('frozen at row 4', ws.views[0].ySplit === 4 && ws.views[0].state === 'frozen');
const companyCell = ws.getCell('B5').value;
t('company cell hyperlinks to homepage', companyCell && companyCell.text === 'Aidoc' && companyCell.hyperlink === 'https://aidoc.com');
t('funding column populated', String(ws.getCell('F5').value).includes('$150M'));
t('whats-happening column populated', String(ws.getCell('K5').value).includes('Foo 2.0'));
t('lead row present', ws.getCell('H5').value === 'elad@aidoc.com');
const liCell = ws.getCell('I5').value;
t('linkedin cell is a clickable hyperlink', liCell && liCell.hyperlink === 'https://www.linkedin.com/in/elad-walach/');
const brandCell = ws.getCell('A3').value;
t('brand cell is a clickable hyperlink', brandCell && brandCell.hyperlink === profile.brand_url);
t('title block carries agent line', JSON.stringify(ws.getCell('B1').value).includes(profile.agent.name));
const cover = wb.getWorksheet('Read me first');
const coverLabels = [...Array(14)].map((_, i) => cover.getCell(`A${i + 1}`).value).filter(Boolean);
t('cover explains what this is', coverLabels.includes('What this is'));
t('cover names the delivering agent', coverLabels.includes('Delivered by') && String(cover.getCell('B6').value).includes(profile.agent.name));
t('cover states the email standard', coverLabels.includes('Our email standard') && String(cover.getCell('B8').value).includes('0 rejected'));
t('cover carries verified-as-of date', coverLabels.includes('Verified as of'));
const moreRow = coverLabels.indexOf('Find more agents');
t('cover links back to the brand', moreRow >= 0 && cover.getCell(`B${moreRow + 5 - coverLabels.indexOf('What this is')}`).value.hyperlink === profile.brand_url);
t('cover has no Signal mention', !coverLabels.includes('Signal'));
const csv = fs.readFileSync(outC, 'utf8');
t('csv mirrors table', csv.startsWith('#,Company,Contact') && csv.includes('elad@aidoc.com'));

console.log(failures ? `\n${failures} FAILURES` : '\nALL TESTS PASSED');
process.exit(failures ? 1 : 0);
