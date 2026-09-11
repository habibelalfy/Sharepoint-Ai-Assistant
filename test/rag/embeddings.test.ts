import { describe, expect, it, jest } from '@jest/globals';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    embeddings: { create: jest.fn() },
  })),
}));

import OpenAI from 'openai';
import { EmbeddingProviderError } from '../../src/errors';
import { OpenAIEmbeddingProvider, verifyEmbeddingDimension } from '../../src/rag/embeddings';
import type { IEmbeddingProvider } from '../../src/rag/embeddings';

function fakeProvider(vectors: number[][]): IEmbeddingProvider {
  return {
    dimension: vectors[0]?.length ?? 0,
    embed: async () => vectors,
  };
}

describe('verifyEmbeddingDimension', () => {
  it('resolves when the vector width matches the expected dimension', async () => {
    const provider = fakeProvider([[1, 2, 3]]);
    await expect(verifyEmbeddingDimension(provider, 3)).resolves.toBeUndefined();
  });

  it('throws EmbeddingProviderError on a width mismatch', async () => {
    const provider = fakeProvider([[1, 2]]);
    await expect(verifyEmbeddingDimension(provider, 3)).rejects.toBeInstanceOf(
      EmbeddingProviderError,
    );
  });

  it('throws EmbeddingProviderError when no vector is returned', async () => {
    const provider = fakeProvider([]);
    await expect(verifyEmbeddingDimension(provider, 3)).rejects.toBeInstanceOf(
      EmbeddingProviderError,
    );
  });
});

describe('OpenAIEmbeddingProvider', () => {
  type CreateEmbeddings = (params: {
    model: string;
    input: string[];
  }) => Promise<{ data: { index: number; embedding: number[] }[] }>;

  const options = {
    baseUrl: 'http://localhost:8080/v1',
    apiKey: 'not-needed',
    model: 'bge-large-en-v1.5',
    dimension: 2,
  };

  it('returns vectors in input order', async () => {
    const create = jest.fn<CreateEmbeddings>();
    create.mockResolvedValue({
      data: [
        { index: 1, embedding: [0.2, 0.3] },
        { index: 0, embedding: [0.1, 0.2] },
      ],
    });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({ embeddings: { create } }));

    const provider = new OpenAIEmbeddingProvider(options);
    const vectors = await provider.embed(['a', 'b']);

    expect(create).toHaveBeenCalledWith({ model: 'bge-large-en-v1.5', input: ['a', 'b'] });
    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.2, 0.3],
    ]);
  });

  it('wraps SDK errors in EmbeddingProviderError', async () => {
    const create = jest.fn<CreateEmbeddings>();
    create.mockRejectedValue(new Error('down'));
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({ embeddings: { create } }));

    const provider = new OpenAIEmbeddingProvider(options);
    await expect(provider.embed(['a'])).rejects.toBeInstanceOf(EmbeddingProviderError);
  });
});
