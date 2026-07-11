import ExcelJS from 'exceljs';
import fs from 'node:fs';

// Writes the client deliverable: a "Read me first" cover sheet (what this is,
// who delivered it, how it was built, the email standard, the numbers), the
// styled "Leads" table, and a "Business" sheet describing the sender — plus an
// optional CSV mirror of the table.

const GREEN = 'FF30A050';
const GREEN_TXT = 'FF107030';
const DARK = 'FF14301E';
const BORDER = 'FFCFE8D6';

// Default table for funded-startup lists. A profile may supply its own
// `columns` array (same shape) to reshape the sheet for a different ICP — the
// DTC/ecommerce profile drops Funding/LinkedIn and adds Platform/Standout/Social.
// link: 'website' → hyperlink to https://<website_domain>; 'self' → value is a URL.
const DEFAULT_COLUMNS = [
  { header: '#', key: 'num', width: 12 },
  { header: 'Company', key: 'company', width: 20, link: 'website' },
  { header: 'Contact', key: 'contact_name', width: 20 },
  { header: 'Role', key: 'title', width: 20 },
  { header: 'Category', key: 'category', width: 24, wrap: true },
  { header: 'Funding', key: 'funding', width: 26, wrap: true },
  { header: 'Location', key: 'location', width: 16 },
  { header: 'Email', key: 'email', width: 28 },
  { header: 'LinkedIn', key: 'linkedin', width: 36, link: 'self' },
  { header: 'Niche', key: 'niche', width: 40, wrap: true },
  { header: "What's happening now", key: 'site_news', width: 36, wrap: true, dash: true },
  { header: 'Why they fit', key: 'why', width: 40, wrap: true },
  { header: 'Email subject', key: 'subject', width: 28, wrap: true },
  { header: 'Email outreach', key: 'email_outreach', width: 72, wrap: true },
  { header: 'DM opener', key: 'dm', width: 50, wrap: true },
];

const columnsFor = (profile) => profile.columns || DEFAULT_COLUMNS;

const font = (opts) => ({ name: 'Cambria', ...opts });
const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };

export async function exportXlsx(leads, profile, outPath, date, { iconPath = null } = {}) {
  const wb = new ExcelJS.Workbook();
  const imgId = iconPath && fs.existsSync(iconPath)
    ? wb.addImage({ filename: iconPath, extension: 'png' })
    : null;

  addCoverSheet(wb, leads, date, profile, imgId);

  const columns = columnsFor(profile);
  const lastCol = columns.length;

  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
  });

  ws.columns = columns.map((c) => ({ width: c.width }));

  const lastLetter = colLetter(lastCol);
  ws.mergeCells(`B1:${lastLetter}3`);
  for (let r = 1; r <= 3; r++) {
    ws.getRow(r).height = 25.5;
    for (let c = 2; c <= lastCol; c++) ws.getRow(r).getCell(c).fill = greenFill;
  }

  if (imgId !== null) {
    // sits in the A1:A2 pocket above the brand name in A3
    ws.addImage(imgId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 58, height: 58 } });
  }
  const title = ws.getCell('B1');
  // rich text so the agent line reads as a distinct, lighter subtitle
  const runs = [
    { font: font({ size: 15, bold: true, color: { argb: 'FFFFFFFF' } }),
      text: `${profile.name}\n` },
    { font: font({ size: 11, color: { argb: 'FFFFFFFF' } }),
      text: `Lead list  ·  ${leads.length} verified leads  ·  ${date}` },
  ];
  if (profile.agent?.name) {
    runs.push({ font: font({ size: 10, italic: true, color: { argb: 'FFEAF6EE' } }),
      text: `\nDelivered by ${profile.agent.name} — ${profile.agent.description || ''}` });
  }
  title.value = { richText: runs };
  title.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  title.fill = greenFill;

  const brand = ws.getCell('A3');
  // clickable so buyers can return to discover more agents
  brand.value = profile.brand_url
    ? { text: profile.brand, hyperlink: profile.brand_url }
    : profile.brand;
  brand.font = font({ size: 11, bold: true, color: { argb: GREEN }, underline: Boolean(profile.brand_url) });
  brand.alignment = { horizontal: 'center', vertical: 'middle' };

  const headerRow = ws.getRow(4);
  headerRow.height = 21.75;
  columns.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = font({ size: 11, bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = greenFill;
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } };
  });

  leads.forEach((L, i) => {
    const row = ws.getRow(i + 5);
    row.height = 165;
    columns.forEach((c, j) => {
      const cell = row.getCell(j + 1);
      const raw = c.key === 'num' ? i + 1 : L[c.key];
      const linked = resolveLink(c, L, raw);
      if (linked) {
        cell.value = linked;
        cell.font = font({ size: 10, color: { argb: DARK }, underline: true });
      } else {
        cell.value = c.dash ? (raw || '—') : (raw == null ? '' : raw);
        cell.font = font({ size: 10, color: { argb: DARK } });
      }
      cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: Boolean(c.wrap) };
      cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } };
    });
  });

  const b = wb.addWorksheet('Business', { views: [{ showGridLines: false }] });
  b.getColumn(1).width = 22;
  b.getColumn(2).width = 100;
  const rows = [['About the business (sender)', null], ...(profile.business_sheet || [])];
  rows.forEach(([k, v], i) => {
    const row = b.getRow(i + 1);
    const ck = row.getCell(1);
    const cv = row.getCell(2);
    ck.value = k;
    cv.value = v;
    if (i === 0) {
      row.height = 25.5;
      ck.font = font({ size: 13, bold: true, color: { argb: 'FFFFFFFF' } });
      ck.fill = greenFill;
      cv.fill = greenFill;
      ck.alignment = { vertical: 'middle' };
    } else {
      row.height = 45.75;
      ck.font = font({ size: 10, bold: true, color: { argb: GREEN_TXT } });
      ck.alignment = { vertical: 'top', wrapText: true };
      cv.font = font({ size: 10, color: { argb: DARK } });
      cv.alignment = { vertical: 'top', wrapText: true };
    }
  });

  await wb.xlsx.writeFile(outPath);
}

// The buyer's first impression: a one-page branded brief that says what the
// file is, who produced it, how the data was verified, and the standard the
// emails were held to. Replaces the old stats-only Report tab.
function addCoverSheet(wb, leads, date, profile, imgId) {
  const r = wb.addWorksheet('Read me first', { views: [{ showGridLines: false }] });
  r.getColumn(1).width = 26;
  r.getColumn(2).width = 96;

  const n = leads.length;
  const isDtc = profile.lead_type === 'dtc_store';
  const bySector = { health: 0, edu: 0, work: 0 };
  let news = 0, freshRaise = 0, published = 0, smtpOk = 0, acceptAll = 0, withStandout = 0;
  const year = new Date().getFullYear();
  for (const L of leads) {
    bySector[L.sector] = (bySector[L.sector] || 0) + 1;
    if (L.site_news) news += 1;
    if (L.standout) withStandout += 1;
    const years = String(L.funding || '').match(/20\d\d/g);
    if (years && Math.max(...years.map(Number)) >= year - 1) freshRaise += 1;
    if (L.email_source === 'published') published += 1;
    if (L.email_smtp === 'deliverable') smtpOk += 1;
    if (L.email_smtp === 'accept-all') acceptAll += 1;
  }
  const inconclusive = n - smtpOk - acceptAll;

  // banner
  r.mergeCells('A1:B3');
  for (let i = 1; i <= 3; i++) r.getRow(i).height = 25.5;
  const banner = r.getCell('A1');
  banner.value = {
    richText: [
      { font: font({ size: 15, bold: true, color: { argb: 'FFFFFFFF' } }), text: `${profile.name}\n` },
      { font: font({ size: 11, color: { argb: 'FFFFFFFF' } }), text: `Lead list  ·  ${n} verified leads  ·  ${date}` },
    ],
  };
  banner.fill = greenFill;
  banner.alignment = { horizontal: imgId !== null ? 'center' : 'left', vertical: 'middle', wrapText: true };
  if (imgId !== null) {
    r.addImage(imgId, { tl: { col: 0.12, row: 0.15 }, ext: { width: 62, height: 62 } });
  }

  const cover = profile.cover || {};
  const whatThisIs = cover.what_this_is
    || `${n} verified ${isDtc ? 'ecommerce brands' : 'decision-makers'} matching your buyer profile, each with a personalized email and direct message ready to send. Every column that names a brand or person links straight to their site or profile.`;
  const howBuilt = cover.how_built || (isDtc
    ? "Each brand was discovered against your profile, verified through live web research (an active, independently-run store on Shopify or similar, a real founder, an English-speaking market, and a credibility signal like a Shark Tank / Dragons' Den appearance or strong traction), checked a second time by an adversarial pass, and its store was read the same day for a timely outreach angle."
    : 'Each company was discovered against the buyer profile, verified through live web research (founder still in the seat, independent, actively operating, emerging stage), checked a second time by an adversarial pass that hunts for quiet acquisitions and leadership changes, and its website was read the same day to time the outreach around what is happening right now.');
  const emailStandard = isDtc
    ? `Every address is a real inbox on the brand's own domain — the founder's direct email or the store's contact address — checked against the mail server. An address a server rejects never ships: ${smtpOk} of ${n} are server-confirmed deliverable, ${acceptAll} sit on accept-all domains, ${inconclusive} inconclusive, 0 rejected.`
    : `Every address is the contact's direct email — publicly documented or built from the company's documented format — and checked against the company's own mail server. An address a server rejects never ships: ${smtpOk} of ${n} are server-confirmed deliverable, ${acceptAll} sit on accept-all domains (format-verified), ${inconclusive} inconclusive, 0 rejected.`;
  const numbers = isDtc
    ? `${n} founder-run brands · ${withStandout} with a Shark Tank / Dragons' Den or strong-traction signal · ${news} with something new on their store right now.`
    : `${bySector.health || 0} healthcare · ${bySector.edu || 0} education · ${bySector.work || 0} workforce learning — ${news} with a live announcement on their site right now, ${freshRaise} funded within the last 12 months.`;

  const rows = [
    ['What this is', whatThisIs],
    ['Delivered by', profile.agent?.name
      ? `${profile.agent.name} — ${profile.agent.description || ''}`
      : profile.brand],
    ['How it was built', howBuilt],
    ['Our email standard', emailStandard],
    ['The numbers', numbers],
    ['Verified as of', date],
  ];

  rows.forEach(([k, v], i) => {
    const row = r.getRow(i + 5);
    row.height = k === 'Verified as of' ? 24 : 60;
    row.getCell(1).value = k;
    row.getCell(1).font = font({ size: 10, bold: true, color: { argb: GREEN_TXT } });
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).value = v;
    row.getCell(2).font = font({ size: 10, color: { argb: DARK } });
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
  });

  if (profile.brand_url) {
    const linkRow = r.getRow(rows.length + 5);
    linkRow.height = 24;
    linkRow.getCell(1).value = 'Find more agents';
    linkRow.getCell(1).font = font({ size: 10, bold: true, color: { argb: GREEN_TXT } });
    linkRow.getCell(1).alignment = { vertical: 'top' };
    linkRow.getCell(2).value = { text: profile.brand_url.replace(/^https?:\/\//, ''), hyperlink: profile.brand_url };
    linkRow.getCell(2).font = font({ size: 10, color: { argb: DARK }, underline: true });
    linkRow.getCell(2).alignment = { vertical: 'top' };
  }
}

// Returns an ExcelJS hyperlink value for a linkable column, or null for a plain cell.
function resolveLink(col, lead, raw) {
  if (!col.link || raw == null || raw === '') return null;
  if (col.link === 'website') {
    return lead.website_domain ? { text: String(raw), hyperlink: `https://${lead.website_domain}` } : null;
  }
  if (col.link === 'self') {
    return /^https?:\/\//.test(String(raw)) ? { text: String(raw), hyperlink: String(raw) } : null;
  }
  return null;
}

// 1 -> A, 2 -> B, ... (small helper; export tables never exceed 26 columns)
function colLetter(n) {
  return String.fromCharCode(64 + n);
}

export function exportCsv(leads, outPath, profile = {}) {
  const columns = columnsFor(profile);
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => esc(c.header)).join(',')];
  leads.forEach((L, i) => {
    lines.push(columns.map((c) => esc(c.key === 'num' ? i + 1 : L[c.key])).join(','));
  });
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
}
