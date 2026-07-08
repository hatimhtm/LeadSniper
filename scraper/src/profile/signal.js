// Lead priority scoring — turns verification + freshness evidence into a
// Hot / Warm / Steady label the client can sort by. Pure function of data the
// pipeline already collected; no extra API calls.

export function scoreLead(lead) {
  let score = 0;
  const reasons = [];

  if (lead.site_news) {
    score += 35;
    reasons.push('live announcement on their site right now');
  }

  const funding = String(lead.funding || '');
  const yearMatch = funding.match(/20\d\d/g);
  const latestYear = yearMatch ? Math.max(...yearMatch.map(Number)) : 0;
  const currentYear = new Date().getFullYear();
  if (latestYear >= currentYear) {
    score += 25;
    reasons.push(`raised this year (${funding.match(/\$\d+(?:\.\d+)?[MB]/)?.[0] || 'new round'})`);
  } else if (latestYear === currentYear - 1) {
    score += 15;
    reasons.push('raised within the last year');
  }

  if (lead.email_smtp === 'deliverable') {
    score += 20;
    reasons.push('mailbox server-confirmed');
  }
  if (lead.email_source === 'published') {
    score += 10;
    reasons.push('email publicly documented');
  }
  if (/\$\d+(\.\d+)?B|\$[2-9]\d{2}M|\$1\d{2}M/.test(funding)) {
    score += 10;
    reasons.push('large war chest');
  }

  const label = score >= 60 ? 'Hot' : score >= 35 ? 'Warm' : 'Steady';
  return { score, label, reason: reasons.join(' · ') };
}

export function applySignals(leads) {
  for (const lead of leads) {
    const s = scoreLead(lead);
    lead.signal = s.label;
    lead.signal_score = s.score;
    lead.signal_reason = s.reason;
  }
  // Hot first, then Warm, then Steady; stable within each band
  const rank = { Hot: 0, Warm: 1, Steady: 2 };
  return [...leads].sort((a, b) =>
    rank[a.signal] - rank[b.signal] || b.signal_score - a.signal_score);
}
