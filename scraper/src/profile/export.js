import ExcelJS from 'exceljs';
import fs from 'node:fs';

// Writes the client deliverable: styled "Leads" sheet
// (merged title block, brand cell, frozen header) plus a "Business" sheet
// describing the sender, and a CSV mirror of the table.

const GREEN = 'FF30A050';
const GREEN_TXT = 'FF107030';
const DARK = 'FF14301E';
const BORDER = 'FFCFE8D6';

const HEADERS = ['#', 'Company', 'Contact', 'Role', 'Category', 'Location', 'Email',
  'LinkedIn', 'Niche', 'Why they fit', 'Email subject', 'Email outreach', 'DM opener'];
const WIDTHS = [12, 20, 20, 20, 24, 16, 28, 36, 40, 40, 28, 72, 50];
const KEYS = ['num', 'company', 'contact_name', 'title', 'category', 'location', 'email',
  'linkedin', 'niche', 'why', 'subject', 'email_outreach', 'dm'];
const WRAP_KEYS = new Set(['niche', 'why', 'subject', 'email_outreach', 'dm']);

const font = (opts) => ({ name: 'Cambria', ...opts });
const greenFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN } };

export async function exportXlsx(leads, profile, outPath, date) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 4, showGridLines: false }],
  });

  ws.columns = WIDTHS.map((w) => ({ width: w }));

  ws.mergeCells('B1:M3');
  for (let r = 1; r <= 3; r++) {
    ws.getRow(r).height = 25.5;
    for (let c = 2; c <= 13; c++) ws.getRow(r).getCell(c).fill = greenFill;
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
      cell.value = k === 'num' ? i + 1 : L[k];
      cell.font = font({ size: 10, color: { argb: DARK } });
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
