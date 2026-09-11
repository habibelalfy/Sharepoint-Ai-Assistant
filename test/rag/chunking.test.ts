import { describe, expect, it } from '@jest/globals';
import { chunkText } from '../../src/rag/chunking';

describe('chunkText', () => {
  it('returns an empty array for empty/whitespace input', () => {
    expect(chunkText('', { size: 100, overlap: 20 })).toEqual([]);
    expect(chunkText('   \n  ', { size: 100, overlap: 20 })).toEqual([]);
  });

  it('returns the whole text as one chunk when shorter than the size', () => {
    expect(chunkText('short text', { size: 100, overlap: 20 })).toEqual(['short text']);
  });

  it('splits long text into overlapping chunks', () => {
    const text = 'a'.repeat(100);
    const chunks = chunkText(text, { size: 30, overlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe(text.slice(0, 30));
    expect(chunks[1]).toBe(text.slice(20, 50));
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(30);
    }
  });

  it('normalizes CRLF to LF', () => {
    expect(chunkText('a\r\nb', { size: 10, overlap: 2 })).toEqual(['a\nb']);
  });

  it('produces no empty trailing chunks', () => {
    const chunks = chunkText('a'.repeat(101), { size: 30, overlap: 10 });
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });
});
