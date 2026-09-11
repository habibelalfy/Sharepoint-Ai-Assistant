/**
 * Embedding generation via the self-hosted text-embeddings-inference server.
 *
 * Uses the official `openai` SDK with `baseURL` pointed at the on-premises
 * container; no request ever leaves the network (see RAG_ARCHITECTURE.md).
 *
 * @module rag/embeddings
 */
import OpenAI from 'openai';
import { EmbeddingProviderError } from '../errors';

/** Generates dense vectors for text. */
export interface IEmbeddingProvider {
  /** The vector width this provider produces. */
  readonly dimension: number;
  /** Embeds one or more texts, returning one vector per input (in order). */
  embed(texts: string[]): Promise<number[][]>;
}

/** Options for {@link OpenAIEmbeddingProvider}. */
export interface OpenAIEmbeddingProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  dimension: number;
}

/** OpenAI-compatible embedding provider pointed at a self-hosted server. */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  public readonly dimension: number;
  private readonly client: OpenAI;
  private readonly model: string;

  public constructor(options: OpenAIEmbeddingProviderOptions) {
    this.dimension = options.dimension;
    this.model = options.model;
    this.client = new OpenAI({ baseURL: options.baseUrl, apiKey: options.apiKey });
  }

  public async embed(texts: string[]): Promise<number[][]> {
    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: texts,
      });
      return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
    } catch (cause) {
      throw new EmbeddingProviderError('Embedding request failed', { cause });
    }
  }
}

/**
 * Fails fast when the embedding server returns a vector width that does not
 * match the configured dimension (guards against a model/schema mismatch).
 *
 * @param provider - The embedding provider to probe.
 * @param expected - Expected vector width.
 * @throws {EmbeddingProviderError} If the probe vector width differs.
 */
export async function verifyEmbeddingDimension(
  provider: IEmbeddingProvider,
  expected: number,
): Promise<void> {
  const vectors = await provider.embed(['dimension-probe']);
  const vector = vectors[0];
  if (!vector) {
    throw new EmbeddingProviderError('Embedding server returned no vector for the probe input');
  }
  if (vector.length !== expected) {
    throw new EmbeddingProviderError(
      `Embedding server returned ${vector.length} dimensions; expected ${expected}`,
    );
  }
}
