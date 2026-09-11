import { describe, expect, it } from '@jest/globals';
import { ExtractionError } from '../../src/errors';
import { DocumentExtractor, PlainTextExtractor, extensionOf } from '../../src/rag/extraction';
import type { IDocumentExtractor } from '../../src/rag/extraction';

describe('extensionOf', () => {
  it('returns the lowercased extension', () => {
    expect(extensionOf('Report.PDF')).toBe('pdf');
    expect(extensionOf('no-extension')).toBe('');
  });
});

describe('PlainTextExtractor', () => {
  it('decodes UTF-8 bytes', async () => {
    const extractor = new PlainTextExtractor();
    await expect(extractor.extract('notes.txt', Buffer.from('hello'))).resolves.toBe('hello');
  });
});

describe('DocumentExtractor', () => {
  it('routes to the matching extractor by extension', async () => {
    const fake: IDocumentExtractor = {
      extensions: ['xyz'],
      extract: async () => 'extracted',
    };
    const facade = new DocumentExtractor([fake]);
    await expect(facade.extract('doc.xyz', Buffer.from('x'))).resolves.toBe('extracted');
  });

  it('throws ExtractionError for an unregistered extension', async () => {
    const facade = new DocumentExtractor([]);
    await expect(facade.extract('doc.pdf', Buffer.from('x'))).rejects.toBeInstanceOf(
      ExtractionError,
    );
  });
});
