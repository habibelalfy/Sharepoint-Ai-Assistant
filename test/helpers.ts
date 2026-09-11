import { jest } from '@jest/globals';
import type { SharePointClient } from '../src/sharepoint/client';

/** Returns the text payload of the first content block of a tool result. */
export function resultText(result: unknown): string {
  if (typeof result !== 'object' || result === null) {
    throw new Error('Expected a tool result object');
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    throw new Error('Expected tool result content');
  }
  const block = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (block?.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('Expected a text content block');
  }
  return block.text;
}

/** Builds a fully-mocked SharePointClient for tool-handler unit tests. */
export function mockSharePointClient(): SharePointClient {
  return {
    queryList: jest.fn(),
    getItemById: jest.fn(),
    getRequestDigest: jest.fn(),
    createItem: jest.fn(),
    updateItem: jest.fn(),
  } as unknown as SharePointClient;
}
