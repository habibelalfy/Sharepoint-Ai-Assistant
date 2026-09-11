/**
 * Document crawler/indexer for RAG.
 *
 * Walks SharePoint document libraries, extracts and chunks text, embeds it, and
 * keeps the pgvector store in sync (incremental, ETag-based). Runs inside the
 * existing native process on the existing cron scheduler.
 *
 * @module rag/indexer
 */
import cron from 'node-cron';
import { randomUUID } from 'node:crypto';
import type { ScheduledJob, Scheduler } from '../services/alert-service';
import type { SharePointClient, SharePointFileInfo } from '../sharepoint/client';
import type { ChunkingOptions } from './chunking';
import { chunkText } from './chunking';
import type { IEmbeddingProvider } from './embeddings';
import type { IDocumentExtractor } from './extraction';
import type { DocumentChunk } from './types';
import type { IVectorStore } from './vector-store';

/** Minimal logger surface the indexer uses (pino-compatible). */
export interface RagLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** Indexer options (scheduler/logging seams for tests). */
export interface DocumentIndexerOptions {
  schedule?: string;
  scheduler?: Scheduler;
  logger?: RagLogger;
}

const DEFAULT_RAG_SCHEDULE = '0 2 * * *';

export class DocumentIndexer {
  private readonly schedule: string;
  private readonly scheduler: Scheduler;
  private readonly logger?: RagLogger;

  public constructor(
    private readonly client: SharePointClient,
    private readonly extractor: IDocumentExtractor,
    private readonly chunking: ChunkingOptions,
    private readonly embeddings: IEmbeddingProvider,
    private readonly vectorStore: IVectorStore,
    options: DocumentIndexerOptions = {},
  ) {
    this.schedule = options.schedule ?? DEFAULT_RAG_SCHEDULE;
    this.scheduler = options.scheduler ?? nodeCronScheduler;
    this.logger = options.logger;
  }

  /** Registers the index job and returns its handle. */
  public startRagScheduler(): ScheduledJob {
    return this.scheduler(this.schedule, () => void this.indexAll());
  }

  /** Crawls all document libraries and reconciles the index. */
  public async indexAll(): Promise<void> {
    const libraries = await this.client.listDocumentLibraries();
    const indexed = await this.vectorStore.getIndexedDocuments();
    const seen = new Set<string>();

    for (const library of libraries) {
      const folderUrl = library.RootFolder?.ServerRelativeUrl;
      if (!folderUrl) {
        continue;
      }
      const libraryName = library.Title ?? folderUrl;
      await this.indexFolder(folderUrl, libraryName, indexed, seen);
    }

    for (const documentId of indexed.keys()) {
      if (!seen.has(documentId)) {
        await this.vectorStore.deleteByDocumentId(documentId);
        this.logger?.info({ documentId }, 'Removed stale document from index');
      }
    }
  }

  private async indexFolder(
    folderUrl: string,
    libraryName: string,
    indexed: Map<string, string>,
    seen: Set<string>,
  ): Promise<void> {
    const files = await this.client.listFilesInFolder(folderUrl);
    for (const file of files) {
      await this.indexFile(file, libraryName, indexed, seen);
    }
    const subFolders = await this.client.listSubFolders(folderUrl);
    for (const subFolder of subFolders) {
      if (subFolder.ServerRelativeUrl) {
        await this.indexFolder(subFolder.ServerRelativeUrl, libraryName, indexed, seen);
      }
    }
  }

  private async indexFile(
    file: SharePointFileInfo,
    libraryName: string,
    indexed: Map<string, string>,
    seen: Set<string>,
  ): Promise<void> {
    const documentId = file.UniqueId;
    if (!documentId || !file.ServerRelativeUrl) {
      return;
    }
    seen.add(documentId);

    const etag = file.ETag ?? file.TimeLastModified ?? '';
    if (indexed.get(documentId) === etag) {
      return; // unchanged since last run
    }

    const buffer = await this.client.getFileContent(file.ServerRelativeUrl);
    const text = await this.extractor.extract(file.Name ?? documentId, buffer);
    const chunkTexts = chunkText(text, this.chunking);
    const vectors = await this.embeddings.embed(chunkTexts);

    const chunks: DocumentChunk[] = chunkTexts.map((chunk, index) => ({
      id: randomUUID(),
      documentId,
      documentTitle: file.Name ?? documentId,
      libraryName,
      sourceUrl: file.ServerRelativeUrl ?? '',
      lastModified: file.TimeLastModified ?? '',
      etag,
      chunkIndex: index,
      text: chunk,
      embedding: vectors[index],
      permittedGroups: normalizeMultiValue(file.ListItemAllFields?.PermittedGroups),
      projectId: file.ListItemAllFields?.ProjectId,
    }));

    await this.vectorStore.upsert(chunks);
    this.logger?.info({ documentId, title: file.Name, chunks: chunks.length }, 'Indexed document');
  }
}

/** Production scheduler backed by node-cron (mirrors alert-service). */
function nodeCronScheduler(expression: string, task: () => void): ScheduledJob {
  const job = cron.schedule(expression, task);
  return { stop: () => job.stop() };
}

/** Normalizes a SharePoint multi-value field (`{results:[…]}` or `[…]`) to an array. */
function normalizeMultiValue(value: { results?: string[] } | string[] | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : (value.results ?? []);
}
