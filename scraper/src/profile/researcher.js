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
          generationConfig: { temperature, maxOutputTokens: 8192 },
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
  const cleaned = text.replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '');
  const start = Math.min(...['{', '['].map((c) => {
    const i = cleaned.indexOf(c);
    return i === -1 ? Infinity : i;
  }));
  if (start === Infinity) throw new Error('No JSON found in response');
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  return JSON.parse(cleaned.slice(start, end + 1));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function today() {
  return new Date().toISOString().slice(0, 10);
}

export async function discoverCandidates(config, profile, count, extraExclude = []) {
  const exclude = [...new Set([...(profile.exclude_companies || []), ...extraExclude])];
  const sectors = Object.entries(profile.icp.sectors)
    .map(([k, v]) => `- ${k}: ${v}`).join('\n');

  const prompt = `Today is ${today()}. You are sourcing B2B prospects. Use Google Search — do not rely on memory.

IDEAL CUSTOMER PROFILE:
${profile.icp.summary}

Sectors (use these keys):
${sectors}

BAD FIT — never include:
${profile.icp.bad_fit.map((b) => `- ${b}`).join('\n')}

DO NOT include any of these companies (already used):
${exclude.join(', ')}

Find ${count} DISTINCT companies that fit, spread across the sectors, each verifiably active and independent (not acquired) as of ${today()}. Prefer companies with a 2025-2026 trigger event: fresh funding round, major launch, big partnership, or expansion.

Return ONLY a JSON array of objects: {"company": "...", "sector": "health|edu|work", "signal": "one line on why they fit, with the recent trigger event"}`;

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt, { temperature: 0.6 });
  if (!grounded) throw new Error('Discovery response was not search-grounded');
  const list = parseJsonLenient(text);
  const seen = new Set(exclude.map((c) => c.toLowerCase()));
  return list.filter((c) => {
    const key = (c.company || '').toLowerCase().trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function verifyCompany(config, profile, candidate) {
  const prompt = `Today is ${today()}. Verify facts about the company "${candidate.company}" (${candidate.signal || 'no context'}) using Google Search. Do NOT answer from memory — every people-fact must be confirmed by a current source.

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

Return ONLY a JSON object:
{"ok": true/false, "reason": "only if false", "company": "official short name", "sector": "${candidate.sector}", "contact_name": "", "first_name": "", "title": "", "linkedin": "", "location": "", "funding": "", "website_domain": "", "niche": "", "hook": "", "email": "", "email_source": "published|pattern|none", "email_evidence": "where the address or pattern was documented"}`;

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt);
  if (!grounded) return { ok: false, reason: 'verification was not search-grounded', company: candidate.company };
  try {
    const rec = parseJsonLenient(text);
    rec.sector = rec.sector || candidate.sector;
    rec.verified_on = today();
    return rec;
  } catch (err) {
    return { ok: false, reason: `unparseable verification: ${err.message}`, company: candidate.company };
  }
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
export async function refuteRecord(config, record) {
  const prompt = `Today is ${today()}. Try to DISPROVE the following claims using Google Search. Look specifically for: acquisition or merger news at any date, the person leaving or being replaced in the role, company shutdown or pivot, or the person's name being associated with a DIFFERENT company in this role.

CLAIMS:
- "${record.contact_name}" is currently ${record.title} at "${record.company}".
- "${record.company}" is an independent, active company.

Search for: "${record.company} acquired", "${record.company} CEO", "${record.contact_name}".

Return ONLY a JSON object: {"refuted": true/false, "reason": "the contrary evidence if refuted, else empty"}`;

  const { text, grounded } = await callGeminiGrounded(config.gemini_api_key, config.gemini_model, prompt);
  if (!grounded) return { refuted: true, reason: 'refute pass was not search-grounded' };
  try {
    return parseJsonLenient(text);
  } catch {
    return { refuted: true, reason: 'unparseable refute response' };
  }
}

// Non-grounded call for copywriting only — no facts may originate here beyond
// what the verified record already contains.
export async function personalize(config, profile, record) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.gemini_model}:generateContent?key=${config.gemini_api_key}`;

  const prompt = `You write outreach copy fragments in a specific voice. Warm, plain, confident. No hype words (revolutionary, game-changing, cutting-edge), no em dashes, no exclamation marks. Keep years, dollar amounts, and counts as numerals (2026, $101M, 2,000 hospitals) — never spell them out. Never invent facts — use ONLY the facts given.

FACTS:
Company: ${record.company}
What they do: ${record.niche}
Recent trigger: ${record.hook}
Sector: ${record.sector}

Reference fragments in the target voice (from an approved sample):
- p2: "What you are building at Cleerly, using AI to catch heart disease early from a scan, is genuinely important. Big ideas like that spread fastest when the story is as clear as the science."
- closer: "If you are getting ready to raise, launch, or simply get more visible, this is exactly the moment a clear story pays off."
- dm_clause: "the way Cleerly catches heart disease early is genuinely important"
- subject: "Telling the Cleerly story as clearly as the science"

Write for ${record.company}. Return ONLY a JSON object:
{"category": "2-4 word industry label like 'AI cardiac diagnostics'",
 "why": "one sentence for a 'Why they fit' column: funded/founder-led + what makes now the moment",
 "subject": "email subject under 60 chars, no colon spam",
 "p2": "2 sentences: sincere specific praise referencing what they do plus the trigger event",
 "closer": "1 sentence tying the trigger event to why now is the moment for a clear story",
 "dm_clause": "short clause completing 'I admire what you are building at ${record.company}, ...'"}`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048, responseMimeType: 'application/json' },
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

export function logStep(msg) {
  console.log(chalk.cyan(`  ${msg}`));
}
