import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
process.env.NODE_ENV = 'test';
const { extractCvText } = await import('../src/utils/cv-text.js');
test('PDF text extraction loads its native dependency and reads a valid document', async () => {
  const content = 'BT /F1 12 Tf 50 750 Td (React developer with accessible web application experience.) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'giggo-pdf-test-'));
  const file = path.join(directory, 'cv.pdf');
  try { await fs.writeFile(file, pdf); const text = await extractCvText(file, 'application/pdf'); assert.match(text, /React developer with accessible/); }
  finally { await fs.unlink(file).catch(() => {}); await fs.rmdir(directory); }
});
