import { supabase, getAllConfig } from './src/config.js';
import { generateMessages } from './src/ai-drafter.js';
import chalk from 'chalk';
import ora from 'ora';

async function fixDrafts() {
  console.log(chalk.bold.hex('#7c5cfc')('\n  === LEAD SNIPER DRAFT FIXER ===\n'));

  const configSpinner = ora('Loading configuration...').start();
  const config = await getAllConfig();
  if (!config.gemini_api_key) {
    configSpinner.fail('No Gemini API key found in configuration.');
    process.exit(1);
  }
  configSpinner.succeed(chalk.green('Configuration loaded'));

  const fetchSpinner = ora('Fetching existing leads...').start();
  // Fetch leads that have an ai_email_draft. We'll regenerate them.
  const { data: leads, error } = await supabase
    .from('ms_leads')
    .select('*')
    .not('ai_email_draft', 'is', null);

  if (error) {
    fetchSpinner.fail(`Failed to fetch leads: ${error.message}`);
    process.exit(1);
  }
  fetchSpinner.succeed(`Found ${leads.length} leads to evaluate for re-drafting.`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    
    // Simple heuristic: if the total draft length is unusually short (e.g., < 200 chars) 
    // OR if it's missing the LINKEDIN section (which is the last one usually), it might be cut off.
    const draftStr = lead.ai_email_draft || '';
    const mightBeCutOff = !draftStr.includes('--- LINKEDIN ---') || draftStr.length < 300;

    // You can force it to redraft all by removing this condition, but let's be smart about API usage.
    if (mightBeCutOff) {
      process.stdout.write(`\r  [${i + 1}/${leads.length}] Regenerating draft for ${chalk.white.bold(lead.business_name)}...`);
      
      try {
        const messages = await generateMessages(lead, config);
        const parts = [];
        if (messages.email) parts.push(`--- EMAIL ---\n${messages.email}`);
        if (messages.whatsapp) parts.push(`--- WHATSAPP ---\n${messages.whatsapp}`);
        if (messages.linkedin) parts.push(`--- LINKEDIN ---\n${messages.linkedin}`);
        const newDraft = parts.join('\n\n') || null;

        const { error: updateError } = await supabase
          .from('ms_leads')
          .update({ ai_email_draft: newDraft })
          .eq('id', lead.id);

        if (updateError) errors++;
        else updated++;

      } catch (err) {
        errors++;
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n\n${chalk.green('Done!')}`);
  console.log(`  Regenerated: ${updated}`);
  console.log(`  Skipped (Looked fine): ${skipped}`);
  console.log(`  Errors: ${errors}`);
  process.exit(0);
}

fixDrafts();