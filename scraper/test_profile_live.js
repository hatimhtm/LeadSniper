// Live smoke test for grounded research (needs GEMINI_API_KEY).
// Augmedix must be disqualified (acquired by Commure 2024; June export shipped it
// with the wrong CEO). Tennr must verify with the real founder.
import fs from 'node:fs';
import { getAllConfig } from './src/config.js';
import { verifyCompany, refuteRecord, personalize } from './src/profile/researcher.js';
import { validateLead, validateCopy } from './src/profile/qa.js';
import { buildLead } from './src/profile/drafter.js';

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/example.json', import.meta.url), 'utf8'));
const config = await getAllConfig();
if (!config.gemini_api_key) { console.error('no GEMINI_API_KEY'); process.exit(1); }

console.log('model:', config.gemini_model || 'gemini-2.5-flash');

console.log('\n--- verify Augmedix (expect ok:false, acquired) ---');
const aug = await verifyCompany(config, profile, { company: 'Augmedix', sector: 'health', signal: 'AI clinical documentation' });
console.log(JSON.stringify(aug, null, 1).slice(0, 600));

console.log('\n--- verify Tennr (expect ok:true, Trey Holterman) ---');
const tennr = await verifyCompany(config, profile, { company: 'Tennr', sector: 'health', signal: 'AI referral document automation, NYC' });
console.log(JSON.stringify(tennr, null, 1).slice(0, 900));

if (tennr.ok) {
  console.log('\n--- refute Tennr record (expect refuted:false) ---');
  console.log(JSON.stringify(await refuteRecord(config, tennr)));

  console.log('\n--- personalize + assemble + QA ---');
  const fragments = await personalize(config, profile, tennr);
  const lead = buildLead(tennr, fragments, profile);
  console.log('subject:', lead.subject);
  console.log('dm:', lead.dm);
  console.log('email first 300:', lead.email_outreach.slice(0, 300));
  const leadCheck = await validateLead(lead, profile);
  const copyCheck = validateCopy(lead, profile);
  console.log('lead QA:', leadCheck.pass ? 'PASS' : `FAIL ${leadCheck.reasons.join('; ')}`);
  console.log('copy QA:', copyCheck.pass ? 'PASS' : `FAIL ${copyCheck.reasons.join('; ')}`);
}

console.log('\n--- refute fabricated record (expect refuted:true) ---');
console.log(JSON.stringify(await refuteRecord(config, {
  company: 'Augmedix', contact_name: 'Joe Hogan', title: 'President and CEO',
})));
