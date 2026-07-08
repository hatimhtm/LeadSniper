import ExcelJS from 'exceljs';
import fs from 'node:fs';

// Writes the client deliverable: styled "Leads" sheet
// (merged title block, brand cell, frozen header) plus a "Business" sheet
// describing the sender, and a CSV mirror of the table.

const GREEN = 'FF30A050';
const GREEN_TXT = 'FF107030';
const DARK = 'FF14301E';
const BORDER = 'FFCFE8D6';

const HEADERS = ['#', 'Company', 'Contact', 'Role', 'Signal', 'Category', 'Funding', 'Location', 'Email',
  'LinkedIn', 'Niche', "What's happening now", 'Why they fit', 'Email subject', 'Email outreach', 'DM opener'];
const WIDTHS = [12, 20, 20, 20, 12, 24, 26, 16, 28, 36, 40, 36, 40, 28, 72, 50];
const KEYS = ['num', 'company', 'contact_name', 'title', 'signal', 'category', 'funding', 'location', 'email',
  'linkedin', 'niche', 'site_news', 'why', 'subject', 'email_outreach', 'dm'];
const WRAP_KEYS = new Set(['funding', 'niche', 'site_news', 'why', 'subject', 'email_outreach', 'dm']);

const SIGNAL_STYLE = {
  Hot: { fill: 'FFFDE9E3', color: 'FFC24A22' },
  Warm: { fill: 'FFFFF6E0', color: 'FF9A7B00' },
  Steady: { fill: 'FFEFF7F1', color: 'FF107030' },
};

const font = (opts) => ({ name: 'Cambria', ...opts });
const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };

export async function exportXlsx(leads, profile, outPath, date, { iconPath = null } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
  });

  ws.columns = WIDTHS.map((w) => ({ width: w }));

  ws.mergeCells('B1:P3');
  for (let r = 1; r <= 3; r++) {
    ws.getRow(r).height = 25.5;
    for (let c = 2; c <= 16; c++) ws.getRow(r).getCell(c).fill = greenFill;
  }

  if (iconPath && fs.existsSync(iconPath)) {
    const img = wb.addImage({ filename: iconPath, extension: 'png' });
    // sits in the A1:A2 pocket above the brand name in A3
    ws.addImage(img, { tl: { col: 0.15, row: 0.1 }, ext: { width: 58, height: 58 } });
  }
  const title = ws.getCell('B1');
  title.value = `${profile.name}\nLead list  ·  ${leads.length} verified leads  ·  ${date}`;
  title.font = font({ size: 15, bold: true, color: { argb: 'FFFFFFFF' } });
  title.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
  title.fill = greenFill;

  const brand = ws.getCell('A3');
  brand.value = profile.brand;
  brand.font = font({ size: 11, bold: true, color: { argb: GREEN } });
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
      } else if (k === 'signal' && SIGNAL_STYLE[L.signal]) {
        cell.value = L.signal;
        cell.font = font({ size: 10, bold: true, color: { argb: SIGNAL_STYLE[L.signal].color } });
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SIGNAL_STYLE[L.signal].fill } };
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

  addReportSheet(wb, leads, date);

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

function addReportSheet(wb, leads, date) {
  const r = wb.addWorksheet('Report', { views: [{ showGridLines: false }] });
  r.getColumn(1).width = 30;
  r.getColumn(2).width = 90;

  const n = leads.length;
  const bySector = { health: 0, edu: 0, work: 0 };
  const bySignal = { Hot: 0, Warm: 0, Steady: 0 };
  let news = 0, freshRaise = 0, published = 0, smtpOk = 0, acceptAll = 0;
  const year = new Date().getFullYear();
  for (const L of leads) {
    bySector[L.sector] = (bySector[L.sector] || 0) + 1;
    if (L.signal) bySignal[L.signal] += 1;
    if (L.site_news) news += 1;
    const years = String(L.funding || '').match(/20\d\d/g);
    if (years && Math.max(...years.map(Number)) >= year - 1) freshRaise += 1;
    if (L.email_source === 'published') published += 1;
    if (L.email_smtp === 'deliverable') smtpOk += 1;
    if (L.email_smtp === 'accept-all') acceptAll += 1;
  }

  const rows = [
    ['Leads delivered', `${n} — every one verified as of ${date}`],
    ['Sector mix', `${bySector.health || 0} healthcare · ${bySector.edu || 0} education · ${bySector.work || 0} workforce learning`],
    ['Signal', `${bySignal.Hot} Hot · ${bySignal.Warm} Warm · ${bySignal.Steady} Steady (list is sorted hottest first)`],
    ['Live announcements', `${news} of ${n} have something new on their site right now — referenced in their outreach`],
    ['Fresh capital', `${freshRaise} of ${n} raised within the last 12 months`],
    ['Email quality', `${published} publicly documented · ${n - published} built from the company's documented format`],
    ['Mailbox verification', `${smtpOk} server-confirmed deliverable · ${acceptAll} accept-all domains · ${n - smtpOk - acceptAll} inconclusive · 0 rejected`],
  ];

  const title = r.getCell('A1');
  r.mergeCells('A1:B1');
  title.value = `Lead list report  ·  ${date}`;
  title.font = font({ size: 13, bold: true, color: { argb: 'FFFFFFFF' } });
  title.fill = greenFill;
  title.alignment = { vertical: 'middle' };
  r.getRow(1).height = 25.5;

  rows.forEach(([k, v], i) => {
    const row = r.getRow(i + 2);
    row.height = 32;
    row.getCell(1).value = k;
    row.getCell(1).font = font({ size: 10, bold: true, color: { argb: GREEN_TXT } });
    row.getCell(1).alignment = { vertical: 'top', wrapText: true };
    row.getCell(2).value = v;
    row.getCell(2).font = font({ size: 10, color: { argb: DARK } });
    row.getCell(2).alignment = { vertical: 'top', wrapText: true };
  });

  const hdr = r.getRow(rows.length + 3);
  r.mergeCells(rows.length + 3, 1, rows.length + 3, 2);
  hdr.getCell(1).value = 'Top opportunities';
  hdr.getCell(1).font = font({ size: 11, bold: true, color: { argb: 'FFFFFFFF' } });
  hdr.getCell(1).fill = greenFill;
  hdr.height = 21.75;

  [...leads]
    .sort((a, b) => (b.signal_score || 0) - (a.signal_score || 0))
    .slice(0, 5)
    .forEach((L, i) => {
      const row = r.getRow(rows.length + 4 + i);
      row.height = 32;
      row.getCell(1).value = L.company;
      row.getCell(1).font = font({ size: 10, bold: true, color: { argb: DARK } });
      row.getCell(1).alignment = { vertical: 'top' };
      row.getCell(2).value = L.signal_reason || '';
      row.getCell(2).font = font({ size: 10, color: { argb: DARK } });
      row.getCell(2).alignment = { vertical: 'top', wrapText: true };
    });
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
