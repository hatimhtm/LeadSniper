import chalk from 'chalk';
import { calculateOpportunityScore } from './scorer.js';

/**
 * Google PageSpeed Insights API (free, no key needed)
 * Now extracts 20+ metrics for granular opportunity scoring.
 */
export async function analyzeWebsite(url) {
  const result = {
    page_speed_score: null,
    mobile_friendly: null,
    load_time_ms: null,
    fcp_ms: null,
    lcp_ms: null,
    cls_score: null,
    tti_ms: null,
    has_ssl: null,
    has_viewport_meta: null,
    has_meta_description: null,
    has_og_tags: null,
    has_structured_data: null,
    has_alt_tags: null,
    image_optimization_score: null,
    content_freshness_year: null,
    has_online_booking: null,
    has_pwa: null,
  };

  if (!url) return result;

  // Check SSL
  result.has_ssl = url.startsWith('https://');

  try {
    const apiUrl = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    apiUrl.searchParams.set('url', url);
    apiUrl.searchParams.set('strategy', 'mobile');
    // Request multiple categories for more data
    apiUrl.searchParams.append('category', 'performance');
    apiUrl.searchParams.append('category', 'accessibility');
    apiUrl.searchParams.append('category', 'seo');
    apiUrl.searchParams.append('category', 'best-practices');

    const response = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(45000) });
    if (!response.ok) {
      // Bail before JSON parse — PageSpeed returns HTML error pages on
      // 4xx/5xx and `response.json()` would throw a confusing SyntaxError.
      throw new Error(`PageSpeed API HTTP ${response.status}`);
    }
    const data = await response.json();

    if (data.lighthouseResult) {
      const lh = data.lighthouseResult;
      const audits = lh.audits || {};

      // Performance score (0-100)
      result.page_speed_score = Math.round((lh.categories?.performance?.score || 0) * 100);

      // Core Web Vitals
      if (audits['first-contentful-paint']?.numericValue) {
        result.fcp_ms = Math.round(audits['first-contentful-paint'].numericValue);
      }
      if (audits['largest-contentful-paint']?.numericValue) {
        result.lcp_ms = Math.round(audits['largest-contentful-paint'].numericValue);
      }
      if (audits['cumulative-layout-shift']?.numericValue !== undefined) {
        result.cls_score = Math.round(audits['cumulative-layout-shift'].numericValue * 1000) / 1000;
      }
      if (audits['interactive']?.numericValue) {
        result.tti_ms = Math.round(audits['interactive'].numericValue);
        result.load_time_ms = result.tti_ms;
      }

      // Mobile friendly - viewport meta
      const viewportAudit = audits['viewport'];
      result.has_viewport_meta = viewportAudit?.score === 1;
      result.mobile_friendly = result.has_viewport_meta;

      // Meta description
      const metaDesc = audits['meta-description'];
      result.has_meta_description = metaDesc?.score === 1;

      // Structured data
      const structuredData = audits['structured-data-item'] || audits['structured-data'];
      result.has_structured_data = structuredData ? structuredData.score === 1 : null;

      // Image alt tags
      const imageAlt = audits['image-alt'];
      result.has_alt_tags = imageAlt ? imageAlt.score === 1 : null;

      // Image optimization
      const unoptimizedImages = audits['uses-optimized-images'] || audits['modern-image-formats'];
      if (unoptimizedImages?.score !== undefined) {
        result.image_optimization_score = Math.round(unoptimizedImages.score * 100);
      }

      // PWA
      const serviceWorker = audits['service-worker'];
      result.has_pwa = serviceWorker ? serviceWorker.score === 1 : false;

      // OG tags - check in rendered HTML if available
      const htmlContent = lh.audits?.['final-screenshot']?.details?.data || '';
      // Can't easily check OG from PageSpeed, mark as null
      result.has_og_tags = null;
    }
  } catch (err) {
    console.log(chalk.gray(`    PageSpeed failed for ${url}: ${err.message}`));
  }

  return result;
}

/**
 * Extract additional signals from crawled HTML content
 */
export function extractAdditionalSignals(htmlContent, url) {
  const signals = {
    has_og_tags: false,
    has_structured_data: false,
    has_online_booking: false,
    content_freshness_year: null,
  };

  if (!htmlContent) return signals;

  // OG tags
  signals.has_og_tags = /property="og:/i.test(htmlContent) || /property='og:/i.test(htmlContent);

  // Structured data (JSON-LD, microdata)
  signals.has_structured_data =
    /application\/ld\+json/i.test(htmlContent) ||
    /itemscope/i.test(htmlContent) ||
    /itemtype="http/i.test(htmlContent);

  // Online booking indicators
  const bookingPatterns = [
    /book(?:ing)?[\s-]?(?:now|online|appointment)/i,
    /r[eé]serv(?:er|ation|ez)/i,
    /prendre[\s-]rendez[\s-]vous/i,
    /schedule[\s-](?:an?\s)?appointment/i,
    /calendly\.com/i,
    /acuityscheduling/i,
    /doctolib/i,
    /simplybook/i,
    /appointy/i,
  ];
  signals.has_online_booking = bookingPatterns.some(p => p.test(htmlContent));

  // Content freshness - look for copyright year
  const copyrightMatch = htmlContent.match(/(?:©|\bcopyright\b)\s*(\d{4})/i);
  if (copyrightMatch) {
    signals.content_freshness_year = parseInt(copyrightMatch[1]);
  } else {
    // Look for any recent year mention in footer area
    const footerMatch = htmlContent.match(/<footer[\s\S]*?(\d{4})[\s\S]*?<\/footer>/i);
    if (footerMatch) {
      signals.content_freshness_year = parseInt(footerMatch[1]);
    }
  }

  return signals;
}

/**
 * Determine pitch angles based on collected data
 */
export function determinePitchAngles(lead) {
  const angles = [];

  if (!lead.has_website) {
    angles.push('no_website');
  }

  if (lead.page_speed_score !== null && lead.page_speed_score < 50) {
    angles.push('slow_website');
  }

  const outdatedTech = ['WordPress', 'Joomla', 'Drupal', 'Wix', 'Squarespace', 'jQuery', 'PHP'];
  if (lead.tech_stack.some((t) => outdatedTech.includes(t))) {
    angles.push('outdated_tech');
  }

  if (!lead.has_mobile_app && lead.rating && lead.rating >= 4.0) {
    angles.push('no_mobile_app');
  }

  if (lead.mobile_friendly === false) {
    angles.push('poor_mobile');
  }

  if (lead.rating && lead.rating < 3.5 && lead.review_count > 10) {
    angles.push('bad_reviews');
  }

  if (angles.length === 0) {
    angles.push('general');
  }

  return angles;
}

/**
 * Generate a human-readable pitch summary
 */
export function generatePitchSummary(lead) {
  const parts = [];

  if (lead.pitch_angles.includes('no_website')) {
    parts.push(`${lead.business_name} has a ${lead.rating}-star rating with ${lead.review_count} reviews but no website. This is a prime opportunity to pitch a modern web presence.`);
  }

  if (lead.pitch_angles.includes('slow_website')) {
    parts.push(`Their website loads with a speed score of ${lead.page_speed_score}/100 — potential clients are leaving before the page even loads.`);
  }

  if (lead.pitch_angles.includes('outdated_tech')) {
    parts.push(`They're running on ${lead.tech_stack.join(', ')} — an outdated stack that could be modernized for better performance and SEO.`);
  }

  if (lead.pitch_angles.includes('no_mobile_app')) {
    parts.push(`With a ${lead.rating}-star rating, they have a strong brand but no mobile app. A custom app could drive customer retention and bookings.`);
  }

  if (lead.pitch_angles.includes('poor_mobile')) {
    parts.push(`Their website is not mobile-optimized — a significant issue since 60%+ of traffic comes from mobile devices.`);
  }

  if (lead.pitch_angles.includes('bad_reviews')) {
    parts.push(`With a ${lead.rating}-star average, their online reputation needs attention. A better digital presence could help improve customer experience.`);
  }

  return parts.join(' ') || 'General outreach opportunity.';
}

/**
 * Full scoring pipeline - call after crawling + PageSpeed
 */
export function scoreAndAnalyze(lead, niche) {
  lead.pitch_angles = determinePitchAngles(lead);
  lead.pitch_summary = generatePitchSummary(lead);

  const { score, breakdown, services } = calculateOpportunityScore(lead, niche);
  lead.opportunity_score = score;
  lead.score_breakdown = breakdown;
  lead.service_opportunities = services;

  return lead;
}
