import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { ApiError } from './ApiError.js';

const MAX_TEXT_LENGTH = 100000;

function cleanText(value) {
  return value.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH);
}

export async function extractCvText(storageKey, mimeType) {
  const buffer = await fs.readFile(storageKey);
  let text = '';

  try {
    if (mimeType === 'text/plain') {
      text = buffer.toString('utf8');
    } else if (mimeType === 'application/pdf') {
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text || '';
      } finally {
        await parser.destroy();
      }
    } else if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      text = (await mammoth.extractRawText({ buffer })).value || '';
    } else {
      throw ApiError.badRequest('This CV format cannot be analyzed');
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw ApiError.badRequest('The CV could not be read. Upload a valid PDF, DOCX, or TXT file, or paste its text.');
  }

  const cleaned = cleanText(text);
  if (cleaned.length < 20) {
    throw ApiError.badRequest('The CV contains too little readable text. Paste the text if the file is image-only.');
  }
  return cleaned;
}
