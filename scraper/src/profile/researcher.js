import chalk from 'chalk';

// Gemini with Google Search grounding. Every fact in profile mode must come out of
// a grounded call — model memory alone produced the wrong-CEO/placeholder disaster
// this module replaces.

const MAX_RETRIES = 3;

async function callGeminiGrounded(apiKey, model, prompt, { temperature = 0.2 } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  let lastErr;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature, maxOutputTokens: 32768 },
        }),
        signal: AbortSignal.timeout(120000),
      });

      const data = await response.json();
      if (data.error) {
        const code = data.error.code || 0;
        if ((code === 429 || code >= 500) && attempt < MAX_RETRIES - 1) {
          await sleep(2000 * (attempt + 1) ** 2);
          continue;
        }
        throw new Error(data.error.message);
      }

      const candidate = data.candidates?.[0];
      const text = candidate?.content?.parts?.map((p) => p.text || '').join('');
      if (!text) throw new Error('No content in grounded response');

      // groundingMetadata missing means the model answered from memory — reject,
      // ungrounded people-facts are exactly the failure mode we are eliminating.
      const grounded = Boolean(
        candidate.groundingMetadata?.groundingChunks?.length ||
        candidate.groundingMetadata?.webSearchQueries?.length
      );
      return { text: text.trim(), grounded };
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES - 1) await sleep(2000 * (attempt + 1) ** 2);
    }
  }
  throw lastErr;
}

function parseJsonLenient(text) {
  // Grounded Gemini responses have several failure shapes: prose before the
  // fence, raw control chars inside strings, and — worst — a TRUNCATED first
  // ```json block immediately followed by a complete regenerated copy. So:
  // collect every fenced chunk, try them last-first (the regenerated copy is
  // the complete one), then fall back to bracket-scanning the whole text.
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)(?=```|$)/g)]
    .map((m) => m[1])
    .filter((c) => c && /[{[]/.test(c));
  const candidates = [...fenced.reverse(), text];

  let lastErr = new Error('No JSON found in response');
  for (const cleaned of candidates) {
    const start = Math.min(...['{', '['].map((c) => {
      const i = cleaned.indexOf(c);
      return i === -1 ? Infinity : i;
    }));
    if (start === Infinity) continue;
    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    const body = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch (err) {
      lastErr = err;
    }
    try {
      // raw control chars are only legal between tokens — space-replacing
      // them never corrupts valid JSON
      return JSON.parse(body.replace(/[\x00-\x1f]/g, ' '));
    } catch (err) {
      lastErr = err;
    }
    // hard-truncated array (thinking ate the output budget): salvage every
    // complete element and drop the cut-off one
    if (body.startsWith('[')) {
      const cut = body.lastIndexOf('}');
      if (cut > 0) {
        const salvaged = body.slice(0, cut + 1) + ']';
        try {
          return JSON.parse(salvaged);
        } catch (err) {
          lastErr = err;
        }
        try {
          return JSON.parse(salvaged.replace(/[\x00-\x1f]/g, ' '));
        } catch (err) {
          lastErr = err;
        }
      }
    }
  }
  throw lastErr;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Renders the buyer profile's emerging-stage cap as a prompt line ('' if unset).
function stageCapLine(profile) {
  const caps = profile.icp?.stage_caps;
  if (!caps) return '';
  const val = caps.max_valuation_musd >= 1000
    ? `$${caps.max_valuation_musd / 1000}B` : `$${caps.max_valuation_musd}M`;
  return `\nSTAGE CAP — emerging-stage only: privately held, valuation under ${val}, total raised under $${caps.max_total_raised_musd}M. No public companies, no unicorns, no IPO-track giants.\n`;
}

// LeadSniper handles two prospect classes. 'funded_startup' (default)
// verifies funding/founder-CEO/stage. 'dtc_store' verifies platform,
// active-store, traction, and a reachable founder/store email — no funding.
function leadType(profile) {
  return profile.lead_type || 'funded_startup';
}

export async function discoverCandidates(config, profile, count, extraExclude = []) {
  const exclude = [...new Set([...(profile.exclude_companies || []), ...extraExclude])];
  const sectorKeys = Object.keys(profile.icp.sectors).join('|');
  const sectors = Object.entries(profile.icp.sectors)
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');
  const bad = profile.icp.bad_fit.map((b) => `- ${b}`).join('\n');

  const prompt = leadType(profile) === 'dtc_store'
    ? `Today is ${today()}. You are sourcing ecommerce prospects for a service provider. Use Google Search — do not rely on memory.

IDEAL CUSTOMER PROFILE:
${profile.icp.summary}

Product verticals to spread across (use these keys):
${sectors}

BAD FIT — never include:
${bad}

DO NOT include any of these brands (already used):
${exclude.join(', ')}

Find ${count} DISTINCT ecommerce brands that fit. STRONGLY prefer brands that have appeared on Shark Tank (US) or Dragons' Den (UK) — they are the best-fit signal. Otherwise pick clearly established, founder-run Shopify/DTC brands with visible traction (thousands of reviews, notable press, large social following) in English-speaking markets (US, UK, AU, CA). Avoid huge/mass-market incumbents past the founder-run SMB stage, and avoid dead or non-English stores.

Return ONLY a JSON array of objects: {"company": "brand name", "sector": "${sectorKeys}", "signal": "one line: what they sell + the standout signal (e.g. 'Shark Tank S14, sells oat-milk skincare, 40k+ reviews')"}`
    : `Today is ${today()}. You are sourcing B2B prospects. Use Google Search — do not rely on memory.

IDEAL CUSTOMER PROFILE:
${profile.icp.summary}

Sectors (use these keys):
${sectors}

BAD FIT — never include:
${bad}
${stageCapLine(profile)}
DO NOT include any of these companies (already used):
${exclude.join(', ')}

Find ${count} DISTINCT companies that fit, spread across the sectors, each verifiably active and independent (not acquired) as of ${today()}. Prefer companies with a 2025-2026 trigger event: fresh funding round, major launch, big partnership, or expansion.

Return ONLY a JSON array of objects: {"company": "...", "sector": "${sectorKeys}", "signal": "one line on why they fit, with the recent trigger event"}`;

  // discovery output is long free-form JSON from a grounded call — parse
  // failures are stochastic (stray prose, broken fences), so retry fresh
  let list;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt, { temperature: 0.6 });
    if (!grounded) { lastErr = new Error('Discovery response was not search-grounded'); continue; }
    try {
      list = parseJsonLenient(text);
      break;
    } catch (err) {
      lastErr = err;
      try { (await import('node:fs')).writeFileSync(`/tmp/leadsniper-discovery-fail-${Date.now()}.txt`, text); } catch { /* diagnostics only */ }
    }
  }
  if (!list) throw lastErr;
  const seen = new Set(exclude.map((c) => c.toLowerCase()));
  return list.filter((c) => {
    const key = (c.company || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function verifyCompany(config, profile, candidate) {
  const prompt = leadType(profile) === 'dtc_store'
    ? dtcVerifyPrompt(candidate)
    : fundedVerifyPrompt(profile, candidate);

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt);
  if (!grounded) return { ok: false, reason: 'verification was not search-grounded', company: candidate.company };
  try {
    const rec = parseJsonLenient(text);
    rec.sector = rec.sector || candidate.sector;
    rec.verified_on = today();
    // DTC founder/store profiles rarely carry funding — never let a blank block QA
    if (leadType(profile) === 'dtc_store' && !rec.funding) rec.funding = 'Private / self-funded';
    return rec;
  } catch (err) {
    return { ok: false, reason: `unparseable verification: ${err.message}`, company: candidate.company };
  }
}

function fundedVerifyPrompt(profile, candidate) {
  return `Today is ${today()}. Verify facts about the company "${candidate.company}" (${candidate.signal || 'no context'}) using Google Search. Do NOT answer from memory — every people-fact must be confirmed by a current source.

Answer these questions:
1. Is the company independent and active as of ${today()}? (Not acquired, merged, or shut down. An acquisition at ANY point disqualifies it.)
2. Who is the CURRENT founder/co-founder CEO (or equivalent founder-leader)? Confirm they still hold the role as of ${today()} — search for departure/replacement news. If the founder left the top seat, the company is disqualified.
3. What is their exact LinkedIn profile URL? (Search "site:linkedin.com/in <name> <company>". Only return a URL you actually saw in results.)
4. HQ city, short form like "New York, US" or "Oslo, Norway".
5. Latest funding: round, amount, year, one notable investor.
6. Company website domain (bare domain, e.g. "acme.com").
7. One plain-English sentence (~15 words) describing what they do.
8. One specific 2025-2026 trigger event (raise, launch, partnership, milestone) usable to personalize outreach.
9. Best DIRECT email for the contact. Priority: (a) an address the person shared publicly (press release, podcast page, their own post) — mark "published"; (b) an address constructed from the company's documented email format (RocketReach/LeadIQ/SignalHire format pages, masked-address hints) — mark "pattern" and name the pattern; (c) nothing found — mark "none" and leave email empty. NEVER return generic inboxes (info@, hello@, support@, sales@, contact@) and NEVER invent a placeholder.
10. Company stage: best-estimate TOTAL raised to date in $M, latest known valuation in $M (null if undisclosed), and whether the company is publicly traded.${stageCapLine(profile) ? ' If the company is publicly traded, valued at or above the stage cap, or has raised beyond the cap, set ok:false with reason "past emerging stage".' : ''}
${stageCapLine(profile)}
Return ONLY a JSON object:
{"ok": true/false, "reason": "only if false", "company": "official short name", "sector": "${candidate.sector}", "contact_name": "", "first_name": "", "title": "", "linkedin": "", "location": "", "funding": "", "total_raised_musd": number or null, "valuation_musd": number or null, "is_public": true/false, "website_domain": "", "niche": "", "hook": "", "email": "", "email_source": "published|pattern|none", "email_evidence": "where the address or pattern was documented"}`;
}

function dtcVerifyPrompt(candidate) {
  return `Today is ${today()}. Verify facts about the ecommerce brand "${candidate.company}" (${candidate.signal || 'no context'}) using Google Search. Do NOT answer from memory — every fact must be confirmed by a current source. Be honest: a private brand's exact revenue is usually NOT public — use verifiable proxies (TV appearance, review counts, press, following), never invent a revenue number.

Answer these questions:
1. Is this an ACTIVE ecommerce store still run by its founder as of ${today()}? (Store is live and selling, not shut down or in liquidation, not fully bought out / absorbed into a large parent.) A MINORITY investment — a Shark Tank or Dragons' Den deal, or angel/seed funding where the founder keeps control — is FINE and is a positive signal, not a disqualifier. Only a full buyout, shutdown, or founder exit sets ok:false.
2. What ecommerce platform does the store run on? Confirm it is Shopify (or a comparable DTC platform like WooCommerce/BigCommerce) from real signals (cdn.shopify.com, myshopify, builtwith-style evidence). If it is clearly NOT a self-serve DTC platform (e.g. Amazon-only, marketplace-only), ok:false. Put the platform in "platform".
3. Who is the FOUNDER or OWNER? Full name and role ("Founder" / "Co-founder" / "Owner"). Confirm they still run the brand. A named founder is required — if none can be confirmed, ok:false.
4. Locality: city + country, and confirm it serves an English-speaking market (US, UK, AU, CA). If the brand is primarily non-English, ok:false.
5. Standout signal — the credibility/traction proxy, in priority order: Shark Tank (US) or Dragons' Den (UK) appearance (name the season/year if known); else notable press; else visible traction (e.g. "38,000+ reviews", "260k Instagram followers"). One short phrase.
6. Website domain (bare, e.g. "brand.com").
7. What they sell — one plain sentence (~12 words).
8. Instagram profile URL if the brand has one (that is where DTC founders live); LinkedIn URL only if easily found.
9. Best reachable email. A STORE or FOUNDER inbox is acceptable for this buyer: prefer the founder's direct email if documented ("published"); else the store's real contact address or the founder's name @ the brand domain, built from documented format ("pattern"); else "none". It MUST be on the brand's own domain (not gmail/marketplace). Name where it was found in "email_evidence".
10. Email-marketing angle — one specific, concrete reason this brand's email likely underperforms or an opening to pitch (e.g. "big new launch to promote to their list", "high traffic but no visible welcome offer", "strong social but generic post-purchase flow"). Put it in "angle".

Return ONLY a JSON object:
{"ok": true/false, "reason": "only if false", "company": "brand name", "sector": "${candidate.sector}", "contact_name": "founder full name", "first_name": "", "title": "Founder|Co-founder|Owner", "platform": "", "location": "", "standout": "", "linkedin": "", "social": "instagram url or ''", "website_domain": "", "niche": "what they sell", "hook": "the standout signal or a current promo", "angle": "", "email": "", "email_source": "published|pattern|none", "email_evidence": ""}`;
}

// Focused fallback when the verify pass finds everything except the LinkedIn URL —
// cheaper than rejecting an otherwise solid lead.
export async function findLinkedIn(config, record) {
  const prompt = `Use Google Search to find the exact LinkedIn profile URL for ${record.contact_name}, ${record.title} at ${record.company}. Search "site:linkedin.com/in ${record.contact_name} ${record.company}" and variations. Only return a URL that appears in actual search results and clearly belongs to this person at this company.

Return ONLY a JSON object: {"linkedin": "https://www.linkedin.com/in/..." or ""}`;

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt);
  if (!grounded) return '';
  try {
    return parseJsonLenient(text).linkedin || '';
  } catch {
    return '';
  }
}

// Adversarial second pass: a fresh grounded call whose only job is to disprove the
// record. This is what catches quiet acquisitions and CEO departures.
export async function refuteRecord(config, record, profile = {}) {
  const ident = record.website_domain
    ? `the company operating at ${record.website_domain}`
    : `"${record.company}"`;
  // For DTC brands a minority investment (a Shark Tank / Dragons' Den deal, an
  // angel/seed round) is the BEST signal, not a disqualifier — only a full
  // buyout, shutdown, or founder exit should refute. For funded startups any
  // acquisition disqualifies.
  const disqualifiers = leadType(profile) === 'dtc_store'
    ? `the store being closed, dead, or in liquidation; a FULL acquisition or buyout (change of control, absorbed into a parent company); or the founder having fully exited the business. IMPORTANT: a MINORITY investment — a Shark Tank or Dragons' Den deal, or angel/seed funding where the founder keeps control — is NOT a disqualifier and must NOT be treated as an acquisition or loss of independence.`
    : `acquisition or merger news at any date, the person leaving or being replaced in the role, company shutdown or pivot, or the person's name being associated with a DIFFERENT company in this role.`;

  const prompt = `Today is ${today()}. Try to DISPROVE the following claims using Google Search. Look specifically for: ${disqualifiers}

CLAIMS (about ${ident} ONLY — several unrelated companies may share the name "${record.company}"; evidence about a same-named company at a different domain does NOT refute these claims):
- "${record.contact_name}" is currently ${record.title} at "${record.company}" (${record.website_domain || 'domain unknown'}).
- "${record.company}" (${record.website_domain || 'domain unknown'}) is an active company still run by its founder.

Search for: "${record.company} acquired", "${record.company} closed", "${record.contact_name}".

Return ONLY a JSON object: {"refuted": true/false, "reason": "the contrary evidence if refuted, else empty"}`;

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt);
  if (!grounded) return { refuted: true, reason: 'refute pass was not search-grounded' };
  try {
    return parseJsonLenient(text);
  } catch {
    return { refuted: true, reason: 'unparseable refute response' };
  }
}

// Fetches the company homepage and distills it into a SELLING INSIGHT, not a
// summary. Example: a prospect's banner announces a new flagship model
// → the insight is "major launch, their story/site needs to catch up — perfect
// moment for the buyer's positioning work", not "they have a new model".
export async function siteIntel(config, profile, record) {
  const html = await fetchHomepage(record.website_domain);
  if (!html) return null;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 4000);

  const prompt = `You are a sales-intelligence analyst working for this service provider:
"${profile.icp.summary}"
Their offer, in short: ${profile.business_sheet?.find((r) => r[0] === 'Offer')?.[1] || 'brand, positioning, and PR strategy'}.

Below is the CURRENT homepage text of ${record.company} (${record.website_domain}), a prospect. Read it and extract:
1. whats_new: the single freshest concrete thing the site is announcing right now (a launch, a new product, a sale/promo, a partnership, a milestone). One sentence, specific. Empty string if nothing clearly new.
2. opportunity: the INSIGHT — think one step past the announcement: given what is new, what does this company now NEED that the provider's service directly addresses? One sentence, specific to this company, framed around the provider's offer above. Never generic filler.
3. evidence: the exact site phrase that supports whats_new (short quote).

Use ONLY the homepage text. Never invent announcements.

HOMEPAGE TEXT:
${text}

Return ONLY JSON: {"whats_new": "", "opportunity": "", "evidence": ""}`;

  try {
    const out = await callGeminiJson(config, prompt, 0.3);
    if (out && (out.whats_new || out.opportunity)) return out;
    return null;
  } catch {
    return null;
  }
}

async function fetchHomepage(domain) {
  for (const url of [`https://${domain}`, `https://www.${domain}`]) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
        redirect: 'follow',
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const html = await res.text();
        if (html.length > 500) return html;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function callGeminiJson(config, prompt, temperature = 0.7) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini_model}:generateContent?key=${config.gemini_api_key}`;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature, maxOutputTokens: 2048, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error.message);
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No content');
      return parseJsonLenient(text);
    } catch (err) {
      if (attempt === MAX_RETRIES - 1) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}

// Non-grounded call for copywriting only — no facts may originate here beyond
// what the verified record and site intel already contain.
export async function personalize(config, profile, record, intel = null) {
  const intelBlock = intel
    ? `\nFresh from their site TODAY:\n- What's new: ${intel.whats_new || 'n/a'}\n- The opening this creates: ${intel.opportunity || 'n/a'}`
    : '';
  const prompt = leadType(profile) === 'dtc_store'
    ? dtcPersonalizePrompt(record, intelBlock)
    : fundedPersonalizePrompt(record, intelBlock);
  return callGeminiJson(config, prompt, 0.7);
}

function fundedPersonalizePrompt(record, intelBlock) {
  return `You write outreach copy fragments in a specific voice. Warm, plain, confident. No hype words (revolutionary, game-changing, cutting-edge), no em dashes, no exclamation marks. Keep years, dollar amounts, and counts as numerals (2026, $101M, 2,000 hospitals) — never spell them out. Never invent facts — use ONLY the facts given.

FACTS:
Company: ${record.company}
What they do: ${record.niche}
Recent trigger: ${record.hook}
Funding: ${record.funding}
Sector: ${record.sector}${intelBlock}

Reference fragments in the target voice (from an approved sample):
- p2: "What you are building at Cleerly, using AI to catch heart disease early from a scan, is genuinely important. Big ideas like that spread fastest when the story is as clear as the science."
- closer: "If you are getting ready to raise, launch, or simply get more visible, this is exactly the moment a clear story pays off."
- dm_clause: "the way Cleerly catches heart disease early is genuinely important"
- subject: "Telling the Cleerly story as clearly as the science"

RULES:
- If homepage intel is present, p2 must reference the fresh announcement specifically, and closer must turn the opportunity insight into the reason to talk NOW (one step past the news: what they need next, not what they just did).
- "why" must include the concrete funding numbers (round, amount) so the reader sees budget at a glance.

Write for ${record.company}. Return ONLY a JSON object:
{"category": "2-4 word industry label like 'AI cardiac diagnostics'",
 "why": "one sentence for a 'Why they fit' column: founder-led + funding with numbers + what makes now the moment",
 "subject": "email subject under 60 chars, no colon spam",
 "p2": "2 sentences: sincere specific praise referencing what they do plus the freshest concrete event",
 "closer": "1 sentence turning the current moment into why a clear story pays off now",
 "dm_clause": "short clause completing 'I admire what you are building at ${record.company}, ...'"}`;
}

function dtcPersonalizePrompt(record, intelBlock) {
  return `You write cold-outreach copy fragments for an ecommerce email-marketing specialist reaching out to Shopify/DTC founders. Voice: warm, plain, peer-to-peer, genuinely admiring of their brand. No hype words, no em dashes, no exclamation marks, no jargon. Never invent facts — use ONLY the facts given. Never claim to know their revenue.

FACTS:
Brand: ${record.company}
What they sell: ${record.niche}
Standout signal: ${record.standout || record.hook}
Locality: ${record.location}
Email-marketing angle (why their email could do more): ${record.angle || 'their email flows are likely under-used'}${intelBlock}

Reference fragments in the target voice:
- p2: "I came across Fizzy Goblet and the shoes are gorgeous, no surprise the store gets the traffic it does. Brands with a following like yours usually have a lot more revenue sitting in their email than they realise."
- closer: "If your welcome and post-purchase flows are not pulling their weight yet, that is usually the fastest money in ecommerce to go and get."
- dm_clause: "the brand you have built and the loyal following behind it"
- subject: "quick idea for Fizzy Goblet's email"

RULES:
- p2 must give sincere, specific praise about THIS brand (reference what they sell and the standout signal), then gently note the email upside. Warm, never salesy.
- closer must turn the specific angle into a light, concrete reason email is worth a look now. Never promise revenue figures.
- "why" is for a 'Why they fit' column: name the platform/traction proxy and the concrete email opportunity (this is the buyer's "why this brand").
- subject must be lowercase-casual and under 55 chars, mentioning the brand.

Write for ${record.company}. Return ONLY a JSON object:
{"category": "2-4 word product vertical like 'Footwear DTC' or 'Skincare brand'",
 "why": "one sentence: platform + standout/traction proxy + the concrete email opportunity",
 "subject": "casual email subject under 55 chars, names the brand",
 "p2": "2 sentences: specific admiring praise about the brand plus a gentle nod to the email upside",
 "closer": "1 sentence turning the angle into a light reason to look at email now",
 "dm_clause": "short clause completing 'I love what you have built at ${record.company}, ...'"}`;
}

export function logStep(msg) {
  console.log(chalk.cyan(`  ${msg}`));
}
