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

const HEADERS = ['#', 'Company', 'Contact', 'Role', 'Category', 'Funding', 'Location', 'Email',
  'LinkedIn', 'Niche', "What's happening now", 'Why they fit', 'Email subject', 'Email outreach', 'DM opener'];
const WIDTHS = [12, 20, 20, 20, 24, 26, 16, 28, 36, 40, 36, 40, 28, 72, 50];
const KEYS = ['num', 'company', 'contact_name', 'title', 'category', 'funding', 'location', 'email',
  'linkedin', 'niche', 'site_news', 'why', 'subject', 'email_outreach', 'dm'];
const WRAP_KEYS = new Set(['funding', 'niche', 'site_news', 'why', 'subject', 'email_outreach', 'dm']);
const LAST_COL = HEADERS.length; // for the merged title block

const font = (opts) => ({ name: 'Cambria', ...opts });
const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };

export async function exportXlsx(leads, profile, outPath, date, { iconPath = null } = {}) {
  const wb = new ExcelJS.Workbook();
  const imgId = iconPath && fs.existsSync(iconPath)
    ? wb.addImage({ filename: iconPath, extension: 'png' })
    : null;

  addCoverSheet(wb, leads, date, profile, imgId);

  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
  });

  ws.columns = WIDTHS.map((w) => ({ width: w }));

  const lastLetter = colLetter(LAST_COL);
  ws.mergeCells(`B1:${lastLetter}3`);
  for (let r = 1; r <= 3; r++) {
    ws.getRow(r).height = 25.5;
    for (let c = 2; c <= LAST_COL; c++) ws.getRow(r).getCell(c).fill = greenFill;
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
  HEADERS.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = font({ size: 11, bold: true, color: { argb: 'FFFFFFFF' } });
    cell.fill = greenFill;
    cell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: BORDER } } };
  });

  leads.forEach((L, i) => {
    const row = ws.getRow(i + 5);
    row.height = 165;
    KEYS.forEach((k, j) => {
      const cell = row.getCell(j + 1);
      if (k === 'company' && L.website_domain) {
        cell.value = { text: L[k], hyperlink: `https://${L.website_domain}` };
        cell.font = font({ size: 10, color: { argb: DARK }, underline: true });
      } else if (k === 'linkedin' && /^https?:\/\//.test(String(L.linkedin || ''))) {
        cell.value = { text: L.linkedin, hyperlink: L.linkedin };
        cell.font = font({ size: 10, color: { argb: DARK }, underline: true });
      } else if (k === 'site_news') {
        cell.value = L.site_news || '—';
        cell.font = font({ size: 10, color: { argb: DARK } });
      } else {
        cell.value = k === 'num' ? i + 1 : L[k];
        cell.font = font({ size: 10, color: { argb: DARK } });
      }
      cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: WRAP_KEYS.has(k) };
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
  const bySector = { health: 0, edu: 0, work: 0 };
  let news = 0, freshRaise = 0, published = 0, smtpOk = 0, acceptAll = 0;
  const year = new Date().getFullYear();
  for (const L of leads) {
    bySector[L.sector] = (bySector[L.sector] || 0) + 1;
    if (L.site_news) news += 1;
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

  const rows = [
    ['What this is', `${n} verified decision-makers matching your buyer profile, each with a personalized email and LinkedIn message ready to send. Companies are grouped by sector; every column that names a company or person links straight to their site or profile.`],
    ['Delivered by', profile.agent?.name
      ? `${profile.agent.name} — ${profile.agent.description || ''}`
      : profile.brand],
    ['How it was built', 'Each company was discovered against the buyer profile, verified through live web research (founder still in the seat, independent, actively operating, emerging stage), checked a second time by an adversarial pass that hunts for quiet acquisitions and leadership changes, and its website was read the same day to time the outreach around what is happening right now.'],
    ['Our email standard', `Every address is the contact's direct email — publicly documented or built from the company's documented format — and checked against the company's own mail server. An address a server rejects never ships: ${smtpOk} of ${n} are server-confirmed deliverable, ${acceptAll} sit on accept-all domains (format-verified), ${inconclusive} inconclusive, 0 rejected.`],
    ['The numbers', `${bySector.health || 0} healthcare · ${bySector.edu || 0} education · ${bySector.work || 0} workforce learning — ${news} with a live announcement on their site right now, ${freshRaise} funded within the last 12 months.`],
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

// 1 -> A, 2 -> B, ... (small helper; export tables never exceed 26 columns)
function colLetter(n) {
  return String.fromCharCode(64 + n);
}

export function exportCsv(leads, outPath) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [HEADERS.map(esc).join(',')];
  leads.forEach((L, i) => {
    lines.push(KEYS.map((k) => esc(k === 'num' ? i + 1 : L[k])).join(','));
  });
  fs.writeFileSync(outPath, lines.join('\n') + '\n');
}
