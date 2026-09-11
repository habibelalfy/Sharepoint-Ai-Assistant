/**
 * SharePoint on-premises REST client.
 *
 * All SharePoint I/O flows through this single class (ADR-001). It owns URL
 * construction, the OData `odata=verbose` response shape, request-digest
 * handling for writes, and centralized error wrapping + retry. Callers inject
 * an authenticated axios instance (see {@link createAuthenticatedAxios}) so the
 * transport/auth can change without touching business logic.
 *
 * @module sharepoint/client
 */
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import type { SharePointConnectionConfig } from '../config';
import { SharePointError } from '../errors';
import { createAuthenticatedAxios } from './auth';

/** Options accepted by {@link SharePointClient.queryList}. */
export interface QueryListOptions {
  /** OData filter expression, e.g. `Status eq 'In Progress'`. */
  filter?: string;
  /** Fields to project, e.g. `['Title', 'Status']`. */
  select?: string[];
  /** OData orderby expression, e.g. `DueDate asc`. */
  orderby?: string;
  /** Maximum number of rows to return. */
  top?: number;
}

/** Tuning knobs for {@link SharePointClient}; defaults are production-safe. */
export interface SharePointClientOptions {
  /** Maximum total attempts per request (1 initial + retries). Default 3. */
  maxAttempts?: number;
  /** Base delay for exponential backoff in milliseconds. Default 500. */
  retryBaseDelayMs?: number;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** SharePoint `odata=verbose` context info response envelope. */
interface SharePointContextInfo {
  d?: { GetContextWebInformation?: { FormDigestValue?: string } };
}

/** SharePoint `odata=verbose` list (collection) response envelope. */
interface SharePointListResponse {
  d?: { results?: unknown[] };
}

/** SharePoint `odata=verbose` single-item response envelope. */
interface SharePointItemResponse {
  d?: unknown;
}

/** A SharePoint document library (list template 101). */
export interface SharePointLibraryInfo {
  Id?: number;
  Title?: string;
  RootFolder?: { ServerRelativeUrl?: string };
}

/** The list item backing a document file (permission/project metadata). */
export interface SharePointFileListItem {
  PermittedGroups?: { results?: string[] } | string[];
  ProjectId?: number;
}

/** A file in a document library folder. */
export interface SharePointFileInfo {
  Name?: string;
  ServerRelativeUrl?: string;
  TimeLastModified?: string;
  ETag?: string;
  UniqueId?: string;
  ListItemAllFields?: SharePointFileListItem;
}

/** A sub-folder in a document library. */
export interface SharePointSubFolderInfo {
  Name?: string;
  ServerRelativeUrl?: string;
}

/** Extracts SharePoint's verbose error message (`odata.error.message.value`). */
function extractSharePointMessage(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined;
  }
  const obj = data as Record<string, unknown>;
  const error = obj['odata.error'] ?? obj.error;
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }
  const message = (error as Record<string, unknown>).message;
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const value = (message as Record<string, unknown>).value;
  return typeof value === 'string' ? value : undefined;
}

/** True if the failure is transient (network error or 5xx) and worth retrying. */
function isRetryable(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  if (!error.response) {
    return true; // network/timeout — no HTTP response at all
  }
  return error.response.status >= 500;
}

/** Converts any failure into a typed {@link SharePointError}. */
function toSharePointError(error: unknown): SharePointError {
  if (axios.isAxiosError(error) && error.response) {
    const message = extractSharePointMessage(error.response.data) ?? error.message;
    return new SharePointError(message, error.response.status, error.response.data, {
      cause: error,
    });
  }
  if (error instanceof Error) {
    return new SharePointError(error.message, 0, undefined, { cause: error });
  }
  return new SharePointError('Unknown SharePoint error', 0, undefined, { cause: error });
}

/**
 * Client for the on-premises SharePoint REST API.
 */
export class SharePointClient {
  private readonly http: AxiosInstance;
  private readonly siteUrl: string;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private digest: string | undefined;

  public constructor(http: AxiosInstance, siteUrl: string, options: SharePointClientOptions = {}) {
    this.http = http;
    this.siteUrl = siteUrl.replace(/\/+$/, '');
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Builds a client and its authenticated transport from connection config.
   */
  public static async connect(config: SharePointConnectionConfig): Promise<SharePointClient> {
    const http = await createAuthenticatedAxios(config);
    return new SharePointClient(http, config.siteUrl);
  }

  /** Fetches a request digest required for write operations. */
  public async getRequestDigest(): Promise<string> {
    const response = await this.request(() =>
      this.http.post<SharePointContextInfo>(`${this.siteUrl}/_api/contextinfo`),
    );
    const digest = response.data?.d?.GetContextWebInformation?.FormDigestValue;
    if (!digest) {
      throw new SharePointError(
        'Request digest missing from context info response',
        response.status,
        response.data,
      );
    }
    return digest;
  }

  /** Queries a list, returning the flattened `d.results` array. */
  public async queryList(listName: string, options: QueryListOptions = {}): Promise<unknown[]> {
    const url = this.buildItemsUrl(listName);
    const params: Record<string, string | number> = {};
    if (options.filter !== undefined) {
      params.$filter = options.filter;
    }
    if (options.select !== undefined && options.select.length > 0) {
      params.$select = options.select.join(',');
    }
    if (options.orderby !== undefined) {
      params.$orderby = options.orderby;
    }
    if (options.top !== undefined) {
      params.$top = options.top;
    }

    const response = await this.request(() =>
      this.http.get<SharePointListResponse>(url, { params }),
    );
    return response.data?.d?.results ?? [];
  }

  /** Fetches a single list item by its integer ID. */
  public async getItemById(listName: string, id: number): Promise<unknown> {
    const response = await this.request(() =>
      this.http.get<SharePointItemResponse>(`${this.buildItemsUrl(listName)}(${id})`),
    );
    return response.data?.d;
  }

  /** Creates a list item, attaching the required request digest. */
  public async createItem(listName: string, itemData: Record<string, unknown>): Promise<unknown> {
    const digest = await this.ensureRequestDigest();
    const response = await this.request(() =>
      this.http.post<SharePointItemResponse>(this.buildItemsUrl(listName), itemData, {
        headers: { 'X-RequestDigest': digest },
      }),
    );
    return response.data?.d;
  }

  /** Updates a list item (MERGE), attaching the required request digest. */
  public async updateItem(
    listName: string,
    id: number,
    itemData: Record<string, unknown>,
  ): Promise<unknown> {
    const digest = await this.ensureRequestDigest();
    const response = await this.request(() =>
      this.http.post<SharePointItemResponse>(`${this.buildItemsUrl(listName)}(${id})`, itemData, {
        headers: {
          'X-HTTP-Method': 'MERGE',
          'IF-MATCH': '*',
          'X-RequestDigest': digest,
        },
      }),
    );
    return response.data?.d;
  }

  /**
   * Lists the site's document libraries (list template 101).
   */
  public async listDocumentLibraries(): Promise<SharePointLibraryInfo[]> {
    const response = await this.request(() =>
      this.http.get<SharePointListResponse>(`${this.siteUrl}/_api/web/lists`, {
        params: {
          $filter: 'BaseTemplate eq 101',
          $select: 'Id,Title,RootFolder/ServerRelativeUrl',
          $expand: 'RootFolder',
        },
      }),
    );
    return (response.data?.d?.results ?? []) as SharePointLibraryInfo[];
  }

  /**
   * Lists files directly inside a document-library folder (server-relative URL).
   *
   * Includes change-detection metadata (`ETag`, `TimeLastModified`) plus the
   * backing list item's permission/project columns for the RAG indexer.
   */
  public async listFilesInFolder(folderServerRelativeUrl: string): Promise<SharePointFileInfo[]> {
    const response = await this.request(() =>
      this.http.get<SharePointListResponse>(this.buildFolderUrl(folderServerRelativeUrl, 'Files'), {
        params: {
          $select:
            'Name,ServerRelativeUrl,TimeLastModified,ETag,UniqueId,' +
            'ListItemAllFields/PermittedGroups,ListItemAllFields/ProjectId',
          $expand: 'ListItemAllFields',
        },
      }),
    );
    return (response.data?.d?.results ?? []) as SharePointFileInfo[];
  }

  /**
   * Lists sub-folders directly inside a document-library folder.
   */
  public async listSubFolders(folderServerRelativeUrl: string): Promise<SharePointSubFolderInfo[]> {
    const response = await this.request(() =>
      this.http.get<SharePointListResponse>(
        this.buildFolderUrl(folderServerRelativeUrl, 'Folders'),
        {
          params: { $select: 'Name,ServerRelativeUrl' },
        },
      ),
    );
    return (response.data?.d?.results ?? []) as SharePointSubFolderInfo[];
  }

  /**
   * Downloads a file's raw bytes from its server-relative URL.
   */
  public async getFileContent(serverRelativeUrl: string): Promise<Buffer> {
    const escaped = serverRelativeUrl.replace(/'/g, "''");
    const url = `${this.siteUrl}/_api/web/GetFileByServerRelativeUrl('${escaped}')/$value`;
    const response = await this.request(() =>
      this.http.get<ArrayBuffer>(url, { responseType: 'arraybuffer' }),
    );
    return Buffer.from(response.data);
  }

  /** Caches a request digest for the lifetime of the client. */
  private async ensureRequestDigest(): Promise<string> {
    if (!this.digest) {
      this.digest = await this.getRequestDigest();
    }
    return this.digest;
  }

  /** Builds the `odata=verbose` items endpoint for a list title. */
  private buildItemsUrl(listName: string): string {
    const escaped = listName.replace(/'/g, "''");
    return `${this.siteUrl}/_api/web/lists/getByTitle('${escaped}')/items`;
  }

  /** Builds the REST endpoint for a folder's children (`Files` or `Folders`). */
  private buildFolderUrl(folderServerRelativeUrl: string, collection: 'Files' | 'Folders'): string {
    const escaped = folderServerRelativeUrl.replace(/'/g, "''");
    return `${this.siteUrl}/_api/web/GetFolderByServerRelativeUrl('${escaped}')/${collection}`;
  }

  /** Executes a request with retry (transient failures only) + error mapping. */
  private async request<T>(fn: () => Promise<AxiosResponse<T>>): Promise<AxiosResponse<T>> {
    let attempt = 0;
    for (;;) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        if (attempt >= this.maxAttempts || !isRetryable(error)) {
          throw toSharePointError(error);
        }
        const delay = this.retryBaseDelayMs * 2 ** (attempt - 1);
        await this.sleep(delay);
      }
    }
  }
}
