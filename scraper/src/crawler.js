import { chromium } from 'playwright';
import chalk from 'chalk';
import { extractAdditionalSignals } from './analyzer.js';

const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const SOCIAL_PATTERNS = {
  linkedin: /https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[a-zA-Z0-9\-._~]+/g,
  instagram: /https?:\/\/(www\.)?instagram\.com\/[a-zA-Z0-9_.]+/g,
  twitter: /https?:\/\/(www\.)?(twitter|x)\.com\/[a-zA-Z0-9_]+/g,
  facebook: /https?:\/\/(www\.)?facebook\.com\/[a-zA-Z0-9.]+/g,
};
const APP_STORE_REGEX = /https?:\/\/apps\.apple\.com\/[^\s"'<>]+/g;
const PLAY_STORE_REGEX = /https?:\/\/play\.google\.com\/store\/apps\/[^\s"'<>]+/g;

// Common junk emails to filter out
const JUNK_EMAILS = new Set([
  'example@example.com', 'test@test.com', 'email@example.com',
  'your@email.com', 'name@domain.com', 'info@example.com',
]);

// Known tech stack indicators
const TECH_INDICATORS = [
  { name: 'WordPress', patterns: [/wp-content/i, /wp-includes/i, /wordpress/i] },
  { name: 'Shopify', patterns: [/cdn\.shopify\.com/i, /shopify/i] },
  { name: 'Wix', patterns: [/wix\.com/i, /wixstatic\.com/i] },
  { name: 'Squarespace', patterns: [/squarespace\.com/i, /sqsp\.com/i] },
  { name: 'Webflow', patterns: [/webflow\.com/i, /webflow\.io/i] },
  { name: 'React', patterns: [/__next/i, /react/i, /_next\/static/i] },
  { name: 'Next.js', patterns: [/_next\//i, /__NEXT_DATA__/i] },
  { name: 'Vue.js', patterns: [/vue\.js/i, /vuejs/i, /v-[a-z]/i] },
  { name: 'Angular', patterns: [/angular/i, /ng-version/i] },
  { name: 'jQuery', patterns: [/jquery/i] },
  { name: 'Bootstrap', patterns: [/bootstrap/i] },
  { name: 'Tailwind', patterns: [/tailwindcss/i] },
  { name: 'PHP', patterns: [/\.php/i] },
  { name: 'Joomla', patterns: [/joomla/i] },
  { name: 'Drupal', patterns: [/drupal/i] },
  { name: 'Magento', patterns: [/magento/i, /mage/i] },
  { name: 'PrestaShop', patterns: [/prestashop/i] },
  { name: 'Ghost', patterns: [/ghost\.org/i, /ghost\.io/i] },
  { name: 'HubSpot', patterns: [/hubspot/i, /hs-scripts/i] },
  { name: 'Google Analytics', patterns: [/google-analytics/i, /gtag/i, /ga\.js/i] },
  { name: 'Google Tag Manager', patterns: [/googletagmanager/i] },
];

let browser = null;

export async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disk-cache-size=0'],
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Deep crawl a website: extract emails, social links, tech stack, app links,
 * and additional signals for opportunity scoring.
 */
export async function crawlWebsite(url, config) {
  const result = {
    emails: [],
    social_links: {},
    tech_stack: [],
    has_mobile_app: false,
    app_store_url: null,
    play_store_url: null,
    // Additional signals for scoring
    has_og_tags: null,
    has_structured_data: null,
    has_online_booking: null,
    content_freshness_year: null,
  };

  if (!url) return result;

  const browser = await initBrowser();
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000); // Increased timeout for slower sites

  // Block images, fonts, media, and stylesheets to save RAM and speed up crawling
  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(type)) {
      route.abort();
    } else {
      route.continue();
    }
  });

  // Collect all page content for analysis
  let allContent = '';

  try {
    // Visit homepage with retry logic to improve reliability
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        break; // Success
      } catch (err) {
        if (attempt === 2) throw err;
        await sleep(2000); // Wait 2s before retrying
      }
    }
    allContent += await page.content();

    // Try to find and visit contact/about pages
    const contactLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .map((a) => a.href)
        .filter((href) =>
          /contact|about|team|equipe|a-propos|qui-sommes|nous-contacter|impressum|kontakt/i.test(href)
        )
        .slice(0, 3);
    });

    for (const link of contactLinks) {
      try {
        await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 30000 });
        allContent += '\n' + (await page.content());
        await sleep(randomDelay(config.scraper_delay_min / 2, config.scraper_delay_max / 2));
      } catch {
        // Skip failed sub-pages
      }
    }

    // Extract emails
    const emailMatches = allContent.match(EMAIL_REGEX) || [];
    result.emails = [...new Set(emailMatches)]
      .filter((e) => !JUNK_EMAILS.has(e.toLowerCase()))
      .filter((e) => !e.endsWith('.png') && !e.endsWith('.jpg') && !e.endsWith('.svg'))
      .filter((e) => !e.includes('example') && !e.includes('test@'))
      .filter((e) => !/^(noreply|no-reply|no_reply|donotreply|sentry)@/i.test(e))
      .slice(0, 5);

    // Extract social links
    for (const [platform, regex] of Object.entries(SOCIAL_PATTERNS)) {
      const matches = allContent.match(regex);
      if (matches && matches.length > 0) {
        result.social_links[platform] = matches[0];
      }
    }

    // Detect tech stack
    for (const tech of TECH_INDICATORS) {
      if (tech.patterns.some((p) => p.test(allContent))) {
        result.tech_stack.push(tech.name);
      }
    }

    // Check for mobile app links
    const appStoreMatches = allContent.match(APP_STORE_REGEX);
    const playStoreMatches = allContent.match(PLAY_STORE_REGEX);
    if (appStoreMatches) {
      result.has_mobile_app = true;
      result.app_store_url = appStoreMatches[0];
    }
    if (playStoreMatches) {
      result.has_mobile_app = true;
      result.play_store_url = playStoreMatches[0];
    }

    // Extract additional signals for opportunity scoring
    const additionalSignals = extractAdditionalSignals(allContent, url);
    Object.assign(result, additionalSignals);

  } catch (err) {
    console.log(chalk.gray(`    Could not crawl ${url}: ${err.message}`));
  } finally {
    await context.close();
  }

  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
