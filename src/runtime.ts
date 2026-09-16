/**
 * Shared process bootstrap for background services (scheduled alerts + RAG).
 *
 * Both entry points — the stdio MCP server and the HTTP gateway — start the same
 * set of background services: the scheduled alert jobs and, when RAG is enabled,
 * the document indexer and retrieval wiring. Extracting this keeps the two
 * bootstraps identical and lets a single containerized process host the complete
 * application.
 *
 * @module runtime
 */
import type { AppConfig } from './config';
import { DocumentExtractor } from './rag/extraction';
import { OpenAIEmbeddingProvider, verifyEmbeddingDimension } from './rag/embeddings';
import { DocumentIndexer, type RagLogger } from './rag/indexer';
import { RetrievalService } from './rag/retrieval-service';
import { PgVectorStore } from './rag/vector-store';
import { AlertService } from './services/alert-service';
import { ConsoleEmailSender, SmtpEmailSender } from './services/email-service';
import { PermissionService } from './services/permission-service';
import type { SharePointClient } from './sharepoint/client';

/** The services shared by every entry point. */
export interface BackgroundServices {
  permissions: PermissionService;
  retrieval?: RetrievalService;
  alertService: AlertService;
  indexer?: DocumentIndexer;
}

/**
 * Builds the shared permission/alert/RAG services and starts their schedulers.
 *
 * @param client - The authenticated SharePoint client.
 * @param config - Loaded application configuration.
 * @param logger - Structured logger.
 * @returns The constructed services (alert + RAG schedulers already started).
 */
export async function bootstrapBackgroundServices(
  client: SharePointClient,
  config: AppConfig,
  logger: RagLogger,
): Promise<BackgroundServices> {
  const permissions = new PermissionService(undefined, client);

  // RAG is additive and optional. When enabled, build the embedding provider +
  // pgvector store, run the dimension startup check, and schedule the indexer.
  let retrieval: RetrievalService | undefined;
  let indexer: DocumentIndexer | undefined;
  if (config.rag.enabled && config.dataSource !== 'project-server') {
    const vectorStore = new PgVectorStore(
      config.rag.pgvectorConnectionString,
      config.rag.embeddingDimensions,
    );
    await vectorStore.initSchema();
    const embeddings = new OpenAIEmbeddingProvider({
      baseUrl: config.rag.embeddingApiBaseUrl,
      apiKey: config.rag.embeddingApiKey,
      model: config.rag.embeddingModelName,
      dimension: config.rag.embeddingDimensions,
    });
    await verifyEmbeddingDimension(embeddings, config.rag.embeddingDimensions);

    retrieval = new RetrievalService(embeddings, vectorStore, permissions);
    indexer = new DocumentIndexer(
      client,
      new DocumentExtractor(),
      { size: config.rag.chunkSize, overlap: config.rag.chunkOverlap },
      embeddings,
      vectorStore,
      { schedule: config.rag.schedule, logger },
    );
  }

  // Scheduled alert jobs (overdue, upcoming milestones, health check). Recipients
  // come from ALERT_RECIPIENTS; SMTP is used when SMTP_HOST is set, otherwise
  // alerts are written to the console (stderr).
  const emailSender = config.smtp ? new SmtpEmailSender(config.smtp) : new ConsoleEmailSender();
  const alertService = new AlertService(client, emailSender, config.alertSchedules, {
    recipients: config.alertRecipients,
  });
  if (config.dataSource !== 'project-server') alertService.startAlertScheduler();

  // RAG document indexer job (nightly by default).
  if (indexer) {
    indexer.startRagScheduler();
    logger.info(
      { event: 'rag_indexer_started', schedule: config.rag.schedule },
      'RAG document indexer scheduled',
    );
  }

  return { permissions, retrieval, alertService, indexer };
}
