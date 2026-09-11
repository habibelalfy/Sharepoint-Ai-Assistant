/**
 * Document text extraction for the RAG indexer.
 *
 * @module rag/extraction
 */
import { ExtractionError } from '../errors';
import mammoth from 'mammoth';
import { OfficeParser } from 'officeparser';
import pdfParse from 'pdf-parse';

/** Extracts plain text from a document's raw bytes. */
export interface IDocumentExtractor {
  /** File extensions this extractor handles (lowercase, no leading dot). */
  readonly extensions: string[];
  /** Extracts plain text from the raw file bytes. */
  extract(fileName: string, buffer: Buffer): Promise<string>;
}

/** Extracts text from PDF documents via `pdf-parse`. */
export class PdfExtractor implements IDocumentExtractor {
  public readonly extensions = ['pdf'];

  public async extract(fileName: string, buffer: Buffer): Promise<string> {
    try {
      const data = await pdfParse(buffer);
      return data.text ?? '';
    } catch (cause) {
      throw new ExtractionError(`Failed to extract text from PDF "${fileName}"`, { cause });
    }
  }
}

/** Extracts text from DOCX documents via `mammoth`. */
export class DocxExtractor implements IDocumentExtractor {
  public readonly extensions = ['docx'];

  public async extract(fileName: string, buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (cause) {
      throw new ExtractionError(`Failed to extract text from DOCX "${fileName}"`, { cause });
    }
  }
}

/** Extracts text from PPTX documents via `officeparser`. */
export class PptxExtractor implements IDocumentExtractor {
  public readonly extensions = ['pptx', 'ppt', 'odp'];

  public async extract(fileName: string, buffer: Buffer): Promise<string> {
    try {
      const ast = await OfficeParser.parseOffice(buffer, { ocr: false });
      return ast.toText();
    } catch (cause) {
      throw new ExtractionError(`Failed to extract text from presentation "${fileName}"`, {
        cause,
      });
    }
  }
}

/** Extracts text from plain-text formats (UTF-8 decode). */
export class PlainTextExtractor implements IDocumentExtractor {
  public readonly extensions = ['txt', 'md', 'csv', 'log', 'json', 'xml', 'html'];

  public async extract(_fileName: string, buffer: Buffer): Promise<string> {
    return buffer.toString('utf8');
  }
}

/** Routes a file to the extractor registered for its extension. */
export class DocumentExtractor implements IDocumentExtractor {
  private readonly extractors: IDocumentExtractor[];

  public constructor(extractors: IDocumentExtractor[] = defaultExtractors()) {
    this.extractors = extractors;
  }

  public get extensions(): string[] {
    return this.extractors.flatMap((extractor) => extractor.extensions);
  }

  public async extract(fileName: string, buffer: Buffer): Promise<string> {
    const extension = extensionOf(fileName);
    const extractor = this.extractors.find((candidate) => candidate.extensions.includes(extension));
    if (!extractor) {
      throw new ExtractionError(`No extractor registered for ".${extension}" (file "${fileName}")`);
    }
    return extractor.extract(fileName, buffer);
  }
}

/** Default extractor set: PDF, DOCX, PPTX, plaintext. */
export function defaultExtractors(): IDocumentExtractor[] {
  return [new PdfExtractor(), new DocxExtractor(), new PptxExtractor(), new PlainTextExtractor()];
}

/** Lowercased file extension (no dot), or empty string when absent. */
export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}
