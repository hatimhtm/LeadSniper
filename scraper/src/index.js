#!/usr/bin/env node

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { supabase, getAllConfig } from './config.js';
import { searchPlaces } from './places.js';
import { crawlWebsite, initBrowser, closeBrowser } from './crawler.js';
import { analyzeWebsite, scoreAndAnalyze } from './analyzer.js';
import { generateMessages } from './ai-drafter.js';

// ── Main scrape command ──
program
  .name('lead-sniper')
  .description('Smart lead generation scraper')
  .argument('<niche>', 'Business niche (e.g., "Avocat", "Dental Clinic", "Real Estate")')
  .argument('<city>', 'Target city (e.g., "Paris", "Dubai", "Casablanca")')
  .option('--skip-crawl', 'Skip deep website crawling')
  .option('--skip-analysis', 'Skip PageSpeed analysis')
  .option('--skip-ai', 'Skip AI email/message drafting')
  .option('--max <number>', 'Override max results', parseInt)
  .action(async (niche, city, options) => {
    await runScrape(niche, city, options);
  });

// ── Watch mode command ──
program
  .command('watch')
  .description('Watch for search requests from the dashboard (low RAM when idle)')
  .option('--interval <seconds>', 'Poll interval in seconds', parseInt, 30)
  .action(async (options) => {
    await runWatchMode(options.interval || 30);
  });

// ── Re-score all existing leads ──
program
  .command('rescore')
  .description('Re-calculate opportunity scores for all existing leads using the latest scoring logic')
  .action(async () => {
    await runRescore();
  });

program.parse();

// ── Rescore ──
async function runRescore() {
  const spinner = ora('Fetching all leads...').start();

  // Fetch all leads with their search niche
  const { data: leads, error } = await supabase
    .from('ms_leads')
    .select('*, search:ms_searches(niche)');

  if (error) {
    spinner.fail(`Failed to fetch leads: ${error.message}`);
    process.exit(1);
  }

  spinner.succeed(`Found ${leads.length} leads to re-score`);

  let updated = 0;
  let errors = 0;

  for (const lead of leads) {
    const niche = lead.search?.niche || '';
    const rescored = scoreAndAnalyze({ ...lead }, niche);

    const { error: updateError } = await supabase
      .from('ms_leads')
      .update({
        opportunity_score: rescored.opportunity_score,
        score_breakdown: rescored.score_breakdown,
        service_opportunities: rescored.service_opportunities,
        pitch_angles: rescored.pitch_angles,
        pitch_summary: rescored.pitch_summary,
      })
      .eq('id', lead.id);

    if (updateError) {
      errors++;
    } else {
      updated++;
    }

    // Log progress every 10 leads
    if ((updated + errors) % 10 === 0) {
      process.stdout.write(`\r  Re-scored ${updated + errors}/${leads.length} leads...`);
    }
  }

  console.log(`\n${chalk.green(`Done! Re-scored ${updated} leads.`)}${errors > 0 ? chalk.red(` ${errors} errors.`) : ''}`);
  process.exit(0);
}

// ── Watch Mode ──
async function runWatchMode(intervalSec) {
  printBanner();
  console.log(chalk.hex('#7c5cfc')('  Mode: ') + chalk.white.bold('Watch') + chalk.gray(` (polling every ${intervalSec}s)`));
  console.log(chalk.gray('  Waiting for search requests from the dashboard...\n'));

  const configSpinner = ora('Loading configuration...').start();
  const config = await getAllConfig();
  configSpinner.succeed(chalk.green('Configuration loaded'));

  let isProcessing = false;

  const poll = async () => {
    if (isProcessing) return;

    try {
      // Check for pending search requests
      const { data: requests } = await supabase
        .from('ms_search_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(1);

      if (requests && requests.length > 0) {
        isProcessing = true;
        const req = requests[0];

        console.log(chalk.hex('#7c5cfc')(`\n  New request: `) + chalk.white.bold(`${req.niche} in ${req.city}`));

        // Mark as running
        await supabase
          .from('ms_search_requests')
          .update({ status: 'running', started_at: new Date().toISOString() })
          .eq('id', req.id);

        try {
          await runScrape(req.niche, req.city, {
            skipCrawl: req.skip_crawl,
            skipAnalysis: req.skip_analysis,
            skipAi: req.skip_ai,
            max: req.max_results,
            _requestId: req.id,
          });

          // Find the search record that was just created
          const { data: latestSearch } = await supabase
            .from('ms_searches')
            .select('id')
            .eq('niche', req.niche)
            .eq('city', req.city)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          await supabase
            .from('ms_search_requests')
            .update({
              status: 'completed',
              completed_at: new Date().toISOString(),
              search_id: latestSearch?.id || null,
            })
            .eq('id', req.id);

        } catch (err) {
          await supabase
            .from('ms_search_requests')
            .update({ status: 'failed', error_message: err.message })
            .eq('id', req.id);
        }

        isProcessing = false;
        console.log(chalk.gray('\n  Waiting for next request...\n'));
      }
    } catch (err) {
      // Silently retry on network errors. `fetch` substring check was
      // fragile — broaden to common transient classes so we don't spam
      // the log on every dropped Wi-Fi packet.
      const transient =
        err instanceof TypeError ||
        err.name === 'AbortError' ||
        err.name === 'FetchError' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'ENOTFOUND';
      if (!transient) {
        console.log(chalk.gray(`  Poll error: ${err.message}`));
      }
    }
  };

  // Initial poll
  await poll();

  // Set up polling interval - lightweight, no Playwright loaded when idle
  setInterval(poll, intervalSec * 1000);

  // Keep process alive
  process.on('SIGINT', () => {
    console.log(chalk.gray('\n  Shutting down watch mode...'));
    process.exit(0);
  });
}

// ── Main Scrape Pipeline ──
async function runScrape(niche, city, options = {}) {
  if (!options._requestId) printBanner();

  // Load config
  const configSpinner = ora('Loading configuration...').start();
  const config = await getAllConfig();
  if (options.max) config.scraper_max_results = options.max;
  configSpinner.succeed(chalk.green('Configuration loaded'));

  // Validate API keys
  if (!config.google_places_api_key_1 && !config.google_places_api_key_2) {
    console.log(chalk.red('\n  No Google Places API keys found.'));
    console.log(chalk.gray('  Add them in the dashboard Settings page or in .env'));
    console.log(chalk.gray('  GOOGLE_PLACES_API_KEY_1=AIzaSy...'));
    process.exit(1);
  }

  const query = `${niche} in ${city}`;
  console.log(chalk.gray(`\n  Target: ${chalk.white.bold(query)}`));
  console.log(chalk.gray(`  Max results: ${config.scraper_max_results}`));
  console.log('');

  // Create search record
  const { data: searchRecord } = await supabase
    .from('ms_searches')
    .insert({ niche, city, status: 'running' })
    .select()
    .single();

  const searchId = searchRecord?.id;

  try {
    // Phase 1: Google Places Search
    const searchSpinner = ora(`Phase 1: Searching Google Places for "${query}"...`).start();
    const places = await searchPlaces(query, config);
    searchSpinner.succeed(chalk.green(`Found ${places.length} businesses`));

    if (places.length === 0) {
      console.log(chalk.yellow('\n  No results found. Try a different search query.'));
      await supabase.from('ms_searches').update({ status: 'completed', total_results: 0, completed_at: new Date().toISOString() }).eq('id', searchId);
      return;
    }

    // Check for duplicates
    const existingIds = new Set();
    const { data: existing } = await supabase
      .from('ms_leads')
      .select('google_place_id')
      .in('google_place_id', places.map((p) => p.google_place_id).filter(Boolean));

    if (existing) existing.forEach((e) => existingIds.add(e.google_place_id));

    const newPlaces = places.filter((p) => !existingIds.has(p.google_place_id));
    if (newPlaces.length < places.length) {
      console.log(chalk.gray(`  Skipping ${places.length - newPlaces.length} duplicates already in database`));
    }

    // Phase 2: Deep Crawl
    if (!options.skipCrawl) {
      console.log('');
      const crawlSpinner = ora('Phase 2: Deep crawling websites...').start();

      for (let i = 0; i < newPlaces.length; i++) {
        const place = newPlaces[i];
        crawlSpinner.text = `Phase 2: Crawling ${i + 1}/${newPlaces.length} - ${place.business_name}`;

        if (place.website_url) {
          const crawlData = await crawlWebsite(place.website_url, config);
          Object.assign(place, crawlData);
        }

        // Rate limiting delay
        if (i < newPlaces.length - 1) {
          const delay = randomDelay(config.scraper_delay_min, config.scraper_delay_max);
          await sleep(delay);
        }
      }

      await closeBrowser();
      const emailCount = newPlaces.filter((p) => p.emails.length > 0).length;
      crawlSpinner.succeed(chalk.green(`Crawled ${newPlaces.length} sites, found ${emailCount} emails`));
    }

    // Phase 3: Website Analysis + Opportunity Scoring
    if (!options.skipAnalysis) {
      console.log('');
      const analysisSpinner = ora('Phase 3: Analyzing websites (PageSpeed + Scoring)...').start();
      let analyzed = 0;

      for (let i = 0; i < newPlaces.length; i++) {
        const place = newPlaces[i];
        if (place.website_url) {
          analysisSpinner.text = `Phase 3: Analyzing ${i + 1}/${newPlaces.length} - ${place.business_name}`;
          const analysis = await analyzeWebsite(place.website_url);
          Object.assign(place, analysis);
          analyzed++;

          // PageSpeed API is slow, add delay
          if (i < newPlaces.length - 1) {
            await sleep(randomDelay(1000, 2000));
          }
        }

        // Score and analyze every lead (even without website)
        scoreAndAnalyze(place, niche);
      }

      analysisSpinner.succeed(chalk.green(`Analyzed ${analyzed} websites, scored ${newPlaces.length} leads`));
    } else {
      // Still score based on available data
      for (const place of newPlaces) {
        scoreAndAnalyze(place, niche);
      }
    }

    // Phase 4: AI Message Drafting
    if (!options.skipAi && config.gemini_api_key) {
      console.log('');
      const aiSpinner = ora('Phase 4: Generating AI messages...').start();

      for (let i = 0; i < newPlaces.length; i++) {
        const place = newPlaces[i];
        aiSpinner.text = `Phase 4: AI drafting ${i + 1}/${newPlaces.length} - ${place.business_name}`;

        const messages = await generateMessages(place, config);
        // Store all channels in ai_email_draft field with markers
        const parts = [];
        if (messages.email) parts.push(`--- EMAIL ---\n${messages.email}`);
        if (messages.whatsapp) parts.push(`--- WHATSAPP ---\n${messages.whatsapp}`);
        if (messages.linkedin) parts.push(`--- LINKEDIN ---\n${messages.linkedin}`);
        place.ai_email_draft = parts.join('\n\n') || null;
      }

      aiSpinner.succeed(chalk.green(`Generated AI messages for ${newPlaces.length} leads`));
    }

    // Save to Supabase
    console.log('');
    const saveSpinner = ora('Saving leads to database...').start();

    const leadsToInsert = newPlaces.map((p) => ({
      search_id: searchId,
      business_name: p.business_name,
      google_place_id: p.google_place_id,
      google_maps_url: p.google_maps_url,
      rating: p.rating,
      review_count: p.review_count,
      address: p.address,
      website_url: p.website_url,
      phone: p.phone,
      whatsapp_link: p.whatsapp_link,
      has_website: p.has_website,
      emails: p.emails,
      social_links: p.social_links,
      has_mobile_app: p.has_mobile_app,
      app_store_url: p.app_store_url,
      play_store_url: p.play_store_url,
      tech_stack: p.tech_stack,
      page_speed_score: p.page_speed_score,
      mobile_friendly: p.mobile_friendly,
      load_time_ms: p.load_time_ms,
      pitch_angles: p.pitch_angles,
      pitch_summary: p.pitch_summary,
      ai_email_draft: p.ai_email_draft,
      // New scoring fields
      opportunity_score: p.opportunity_score,
      score_breakdown: p.score_breakdown,
      service_opportunities: p.service_opportunities || [],
      fcp_ms: p.fcp_ms,
      lcp_ms: p.lcp_ms,
      cls_score: p.cls_score,
      tti_ms: p.tti_ms,
      has_ssl: p.has_ssl,
      has_viewport_meta: p.has_viewport_meta,
      has_meta_description: p.has_meta_description,
      has_og_tags: p.has_og_tags,
      has_structured_data: p.has_structured_data,
      has_alt_tags: p.has_alt_tags,
      image_optimization_score: p.image_optimization_score,
      content_freshness_year: p.content_freshness_year,
      has_online_booking: p.has_online_booking,
      has_pwa: p.has_pwa,
      status: 'new',
    }));

    // Filter out duplicates within the extracted batch itself to avoid uniqueness conflicts
    const uniqueLeads = [];
    const seenIds = new Set();
    for (const lead of leadsToInsert) {
      if (!seenIds.has(lead.google_place_id)) {
        seenIds.add(lead.google_place_id);
        uniqueLeads.push(lead);
      }
    }

    // Upsert in batches of 20 - safer than insert for handling race conditions
    let inserted = 0;
    for (let i = 0; i < uniqueLeads.length; i += 20) {
      const batch = uniqueLeads.slice(i, i + 20);
      const { error } = await supabase.from('ms_leads').upsert(batch, { onConflict: 'google_place_id', ignoreDuplicates: true });
      if (error) {
        console.log(chalk.yellow(`  Warning: batch upsert error: ${error.message}`));
      } else {
        inserted += batch.length;
      }
    }

    // Update search record
    await supabase
      .from('ms_searches')
      .update({
        status: 'completed',
        total_results: inserted,
        completed_at: new Date().toISOString(),
      })
      .eq('id', searchId);

    saveSpinner.succeed(chalk.green(`Saved ${inserted} leads to database`));

    // Print results table
    console.log('');
    printResultsTable(newPlaces);

    // Summary
    console.log('');
    console.log(chalk.bold.hex('#7c5cfc')('  ═══════════════════════════════════════'));
    console.log(chalk.bold.white('  SUMMARY'));
    console.log(chalk.gray(`  Total leads: ${chalk.white.bold(newPlaces.length)}`));
    console.log(chalk.gray(`  Emails found: ${chalk.hex('#60a5fa').bold(newPlaces.filter((p) => p.emails.length > 0).length)}`));
    console.log(chalk.gray(`  With website: ${chalk.hex('#34d399').bold(newPlaces.filter((p) => p.has_website).length)}`));
    console.log(chalk.gray(`  Without website: ${chalk.hex('#f87171').bold(newPlaces.filter((p) => !p.has_website).length)}`));
    console.log(chalk.gray(`  With app: ${chalk.hex('#fbbf24').bold(newPlaces.filter((p) => p.has_mobile_app).length)}`));
    console.log(chalk.gray(`  Avg speed score: ${chalk.white.bold(getAvgSpeed(newPlaces))}`));
    console.log(chalk.gray(`  Avg opportunity: ${chalk.hex('#7c5cfc').bold(getAvgScore(newPlaces))}`));
    console.log(chalk.bold.hex('#7c5cfc')('  ═══════════════════════════════════════'));
    console.log('');

  } catch (err) {
    await closeBrowser();
    await supabase
      .from('ms_searches')
      .update({ status: 'failed', error_message: err.message })
      .eq('id', searchId);

    console.log(chalk.red(`\n  Error: ${err.message}`));
    if (!options._requestId) process.exit(1);
    throw err;
  }
}

// ── Helpers ──

function printBanner() {
  console.log('');
  console.log(chalk.bold.hex('#7c5cfc')('  ╔═══════════════════════════════════════╗'));
  console.log(chalk.bold.hex('#7c5cfc')('  ║') + chalk.bold.white('      LEAD SNIPER - Smart Scraper      ') + chalk.bold.hex('#7c5cfc')('║'));
  console.log(chalk.bold.hex('#7c5cfc')('  ╚═══════════════════════════════════════╝'));
  console.log('');
}

function printResultsTable(places) {
  const table = new Table({
    head: [
      chalk.hex('#7c5cfc')('Business'),
      chalk.hex('#7c5cfc')('Rating'),
      chalk.hex('#7c5cfc')('Email'),
      chalk.hex('#7c5cfc')('Phone'),
      chalk.hex('#7c5cfc')('Site'),
      chalk.hex('#7c5cfc')('Speed'),
      chalk.hex('#7c5cfc')('Score'),
      chalk.hex('#7c5cfc')('Pitch'),
    ],
    style: { head: [], border: ['gray'] },
    colWidths: [22, 8, 8, 8, 8, 8, 8, 14],
  });

  for (const p of places.slice(0, 30)) {
    table.push([
      p.business_name.slice(0, 20),
      p.rating ? chalk.hex('#fbbf24')(p.rating.toString()) : chalk.gray('--'),
      p.emails.length > 0 ? chalk.hex('#60a5fa')('Yes') : chalk.gray('No'),
      p.phone ? chalk.hex('#34d399')('Yes') : chalk.gray('No'),
      p.has_website ? chalk.hex('#34d399')('Yes') : chalk.hex('#f87171')('No'),
      p.page_speed_score !== null ? colorSpeed(p.page_speed_score) : chalk.gray('--'),
      p.opportunity_score !== null ? colorScore(p.opportunity_score) : chalk.gray('--'),
      p.pitch_angles.slice(0, 2).map((a) => a.replace(/_/g, ' ')).join(', ').slice(0, 12),
    ]);
  }

  if (places.length > 30) {
    console.log(chalk.gray(`  Showing first 30 of ${places.length} results`));
  }

  console.log(table.toString());
}

function colorSpeed(score) {
  if (score >= 90) return chalk.hex('#34d399')(score.toString());
  if (score >= 50) return chalk.hex('#fbbf24')(score.toString());
  return chalk.hex('#f87171')(score.toString());
}

function colorScore(score) {
  if (score >= 70) return chalk.hex('#34d399')(score.toString());
  if (score >= 40) return chalk.hex('#fbbf24')(score.toString());
  return chalk.hex('#f87171')(score.toString());
}

function getAvgSpeed(places) {
  const withSpeed = places.filter((p) => p.page_speed_score !== null);
  if (!withSpeed.length) return 'N/A';
  return Math.round(withSpeed.reduce((sum, p) => sum + p.page_speed_score, 0) / withSpeed.length);
}

function getAvgScore(places) {
  const withScore = places.filter((p) => p.opportunity_score !== null);
  if (!withScore.length) return 'N/A';
  return Math.round(withScore.reduce((sum, p) => sum + p.opportunity_score, 0) / withScore.length) + '/100';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
