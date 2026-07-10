#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { getAllConfig } from '../config.js';
import { discoverCandidates, verifyCompany, refuteRecord, personalize, findLinkedIn, siteIntel } from './researcher.js';
import { validateLead, validateCopy, validateBatch } from './qa.js';
import { buildLead } from './drafter.js';
import { exportXlsx, exportCsv } from './export.js';

// Profile mode: buyer-profile-driven B2B prospecting with grounded verification.
//   node src/profile/run.js ../profiles/example.json --count 25
// Pipeline per lead: discover -> verify (grounded) -> refute (grounded, adversarial)
// -> personalize (copy only) -> QA gates -> export. Rejects are logged, never shipped.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { count: 25, refute: true, mx: true, smtp: true, intel: true, batch: 0, out: null, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--count') args.count = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--no-refute') args.refute = false;
    else if (a === '--no-mx') args.mx = false;
    else if (a === '--no-smtp') args.smtp = false;
    else if (a === '--no-intel') args.intel = false;
    else if (a === '--discover-batch') args.batch = parseInt(argv[++i], 10);
    else if (!a.startsWith('--')) args.profile = a;
  }
  if (!args.profile) {
    console.error('Usage: node src/profile/run.js <profile.json> [--count 25] [--out file.xlsx] [--no-refute] [--no-mx] [--no-smtp] [--no-intel]');
    process.exit(1);
  }
  return args;
}

async function pool(items, limit, worker) {
  const results = [];
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i).catch((err) => ({ ok: false, reason: String(err.message || err), company: items[i]?.company }));
    }
  }));
  return results;
}

const today = () => new Date().toISOString().slice(0, 10);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profilePath = path.resolve(args.profile);
  const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  const config = await getAllConfig();
  if (!config.gemini_api_key) {
    console.error(chalk.red('GEMINI_API_KEY missing (set it in .env or ms_settings)'));
    process.exit(1);
  }

  const runDir = path.resolve(__dirname, '../../../runs', profile.slug);
  fs.mkdirSync(runDir, { recursive: true });
  const deliveredPath = path.join(runDir, 'delivered.json');
  const delivered = fs.existsSync(deliveredPath) ? JSON.parse(fs.readFileSync(deliveredPath, 'utf8')) : [];
  const ckptPath = path.join(runDir, `checkpoint-${today()}.json`);
  const ckpt = fs.existsSync(ckptPath)
    ? JSON.parse(fs.readFileSync(ckptPath, 'utf8'))
    : { accepted: [], rejected: [], tried: [] };
  const saveCkpt = () => fs.writeFileSync(ckptPath, JSON.stringify(ckpt, null, 1));

  console.log(chalk.bold(`\nLeadSniper profile mode — ${profile.name}`));
  console.log(`target ${args.count} leads · refute pass ${args.refute ? 'on' : 'off'} · MX check ${args.mx ? 'on' : 'off'}`);
  if (ckpt.accepted.length) console.log(chalk.yellow(`resuming: ${ckpt.accepted.length} already accepted today`));

  let round = 0;
  while (ckpt.accepted.length < args.count && round < 6) {
    round++;
    const need = args.count - ckpt.accepted.length;
    const batchSize = args.batch || Math.max(10, Math.ceil(need * 1.6));
    console.log(chalk.bold(`\n[round ${round}] discovering ${batchSize} candidates (${need} still needed)`));

    const exclude = [...delivered, ...ckpt.tried];
    let candidates;
    try {
      candidates = await discoverCandidates(config, profile, batchSize, exclude);
    } catch (err) {
      console.error(chalk.red(`discovery failed: ${err.message}`));
      break;
    }
    candidates = candidates.slice(0, batchSize);
    if (!candidates.length) {
      console.log(chalk.yellow('discovery returned nothing new, stopping'));
      break;
    }
    console.log(`  ${candidates.length} fresh candidates: ${candidates.map((c) => c.company).join(', ')}`);
    ckpt.tried.push(...candidates.map((c) => c.company));
    saveCkpt();

    await pool(candidates, 3, async (candidate) => {
      if (ckpt.accepted.length >= args.count) return;
      const tag = chalk.dim(`[${candidate.company}]`);

      const rec = await verifyCompany(config, profile, candidate);
      if (!rec.ok) {
        ckpt.rejected.push({ company: candidate.company, stage: 'verify', reasons: [rec.reason] });
        console.log(`${tag} ${chalk.red('✗ verify:')} ${rec.reason}`);
        saveCkpt();
        return;
      }

      // salvage pass: verify often finds everything except the LinkedIn URL
      if (!/linkedin\.com\/in\//.test(rec.linkedin || '')) {
        rec.linkedin = await findLinkedIn(config, rec);
      }

      if (args.refute) {
        const ref = await refuteRecord(config, rec);
        if (ref.refuted) {
          ckpt.rejected.push({ company: rec.company, stage: 'refute', reasons: [ref.reason] });
          console.log(`${tag} ${chalk.red('✗ refuted:')} ${ref.reason}`);
          saveCkpt();
          return;
        }
      }

      // homepage insight pass: what is the site announcing right now, and what
      // does that mean the company needs next
      let intel = null;
      if (args.intel) {
        intel = await siteIntel(config, profile, rec).catch(() => null);
        if (intel?.whats_new) {
          rec.site_news = intel.whats_new;
          console.log(`${tag} ${chalk.blue('◆ site:')} ${intel.whats_new}`);
        }
      }

      let lead;
      for (let attempt = 0; attempt < 2; attempt++) {
        const fragments = await personalize(config, profile, rec, intel);
        lead = buildLead(rec, fragments, profile);
        const copyCheck = validateCopy(lead, profile);
        if (copyCheck.pass) break;
        if (attempt === 1) {
          ckpt.rejected.push({ company: rec.company, stage: 'copy', reasons: copyCheck.reasons });
          console.log(`${tag} ${chalk.red('✗ copy QA:')} ${copyCheck.reasons.join('; ')}`);
          saveCkpt();
          return;
        }
      }

      const check = await validateLead(lead, profile, { checkMx: args.mx, checkSmtp: args.smtp });
      if (!check.pass) {
        ckpt.rejected.push({ company: rec.company, stage: 'lead QA', reasons: check.reasons });
        console.log(`${tag} ${chalk.red('✗ lead QA:')} ${check.reasons.join('; ')}`);
        saveCkpt();
        return;
      }

      if (ckpt.accepted.length >= args.count) return;
      ckpt.accepted.push(lead);
      saveCkpt();
      console.log(`${tag} ${chalk.green(`✓ accepted (${ckpt.accepted.length}/${args.count})`)} ${lead.contact_name} · ${lead.email} [${lead.email_source}]`);
    });
  }

  const leads = ckpt.accepted.slice(0, args.count);
  if (!leads.length) {
    console.error(chalk.red('\nNo leads survived QA — nothing exported.'));
    process.exit(1);
  }

  const batchCheck = validateBatch(leads, profile);
  if (!batchCheck.pass) {
    console.error(chalk.red(`\nBatch QA failed: ${batchCheck.reasons.join('; ')} — nothing exported.`));
    process.exit(1);
  }

  const outX = args.out || path.join(os.homedir(), 'Desktop', `${profile.slug}-${today()}-leads.xlsx`);
  const outC = outX.replace(/\.xlsx$/, '.csv');
  const iconPath = profile.brand_icon
    ? path.resolve(path.dirname(profilePath), profile.brand_icon)
    : null;
  await exportXlsx(leads, profile, outX, today(), { iconPath });
  exportCsv(leads, outC);

  // audit trail: every accepted lead with its verification evidence, so the
  // deliverable is reviewable without re-research
  const auditPath = outX.replace(/\.xlsx$/, '.audit.json');
  fs.writeFileSync(auditPath, JSON.stringify(leads.map((l) => ({
    company: l.company, contact: l.contact_name, title: l.title,
    verified_on: l.verified_on, funding: l.funding,
    email: l.email, email_source: l.email_source,
    email_evidence: l.email_evidence || '', email_smtp: l.email_smtp || 'not probed',
    site_news: l.site_news || '', linkedin: l.linkedin,
  })), null, 1));

  fs.writeFileSync(deliveredPath, JSON.stringify([...new Set([...delivered, ...leads.map((l) => l.company)])], null, 1));

  const published = leads.filter((l) => l.email_source === 'published').length;
  console.log(chalk.bold.green(`\n✓ ${leads.length} leads exported`));
  console.log(`  ${outX}\n  ${outC}`);
  const smtpOk = leads.filter((l) => l.email_smtp === 'deliverable').length;
  const acceptAll = leads.filter((l) => l.email_smtp === 'accept-all').length;
  console.log(`  emails: ${published} published · ${leads.length - published} pattern-derived · SMTP: ${smtpOk} confirmed, ${acceptAll} accept-all domains`);
  console.log(`  audit trail: ${auditPath}`);
  console.log(`  rejected this run: ${ckpt.rejected.length} (see ${path.relative(process.cwd(), ckptPath)})`);
  if (leads.length < args.count) {
    console.log(chalk.yellow(`  NOTE: only ${leads.length}/${args.count} — rerun to top up (checkpoint resumes automatically)`));
  }
}

main().catch((err) => {
  console.error(chalk.red(`fatal: ${err.stack || err}`));
  process.exit(1);
});
