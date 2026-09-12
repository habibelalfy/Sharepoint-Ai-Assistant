import { describe, expect, it } from '@jest/globals';
import { loadConfig } from '../src/config';

const validEnv: NodeJS.ProcessEnv = {
  SHAREPOINT_SITE_URL: 'http://sp-server/sites/projects',
  SHAREPOINT_USERNAME: 'svc_ai_assistant',
  SHAREPOINT_PASSWORD: 'secret',
  SHAREPOINT_DOMAIN: 'CORP',
  SHAREPOINT_AUTH_MODE: 'kerberos',
};

/** Returns a copy of the env with one key removed. */
function without(env: NodeJS.ProcessEnv, key: string): NodeJS.ProcessEnv {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

describe('loadConfig', () => {
  it('builds a config from valid environment variables', () => {
    const config = loadConfig(validEnv);
    expect(config.sharepoint.siteUrl).toBe('http://sp-server/sites/projects');
    expect(config.sharepoint.username).toBe('svc_ai_assistant');
    expect(config.sharepoint.authMode).toBe('kerberos');
    expect(config.sharepoint.domain).toBe('CORP');
    expect(config.logLevel).toBe('info');
    expect(config.serviceName).toBe('sharepoint-ai-assistant');
  });

  it('defaults auth mode to kerberos when omitted', () => {
    expect(loadConfig(without(validEnv, 'SHAREPOINT_AUTH_MODE')).sharepoint.authMode).toBe(
      'kerberos',
    );
  });

  it('defaults log level to info when omitted', () => {
    expect(loadConfig(without(validEnv, 'LOG_LEVEL')).logLevel).toBe('info');
  });

  it('throws when a required variable is missing', () => {
    expect(() => loadConfig(without(validEnv, 'SHAREPOINT_PASSWORD'))).toThrow(
      /SHAREPOINT_PASSWORD/,
    );
  });

  it('throws when auth mode is invalid', () => {
    expect(() => loadConfig({ ...validEnv, SHAREPOINT_AUTH_MODE: 'oauth' })).toThrow(
      /SHAREPOINT_AUTH_MODE/,
    );
  });

  it('throws when the site URL is invalid', () => {
    expect(() => loadConfig({ ...validEnv, SHAREPOINT_SITE_URL: 'not a url' })).toThrow(
      /SHAREPOINT_SITE_URL/,
    );
  });

  it('defaults alert schedules when omitted', () => {
    expect(loadConfig(validEnv).alertSchedules).toEqual({
      overdue: '0 9 * * *',
      milestones: '0 10 * * *',
      healthCheck: '0 8 * * 1',
    });
  });

  it('reads custom alert schedules from env', () => {
    const config = loadConfig({ ...validEnv, ALERT_SCHEDULE_OVERDUE: '0 6 * * *' });
    expect(config.alertSchedules.overdue).toBe('0 6 * * *');
    expect(config.alertSchedules.milestones).toBe('0 10 * * *');
  });

  it('defaults alert recipients to an empty list', () => {
    expect(loadConfig(validEnv).alertRecipients).toEqual([]);
  });

  it('parses ALERT_RECIPIENTS into a trimmed list', () => {
    const config = loadConfig({ ...validEnv, ALERT_RECIPIENTS: ' a@corp.com, b@corp.com , ' });
    expect(config.alertRecipients).toEqual(['a@corp.com', 'b@corp.com']);
  });

  it('builds SMTP config when SMTP_HOST is set', () => {
    const config = loadConfig({
      ...validEnv,
      SMTP_HOST: 'smtp.corp.com',
      SMTP_FROM: 'ai@corp.com',
    });
    expect(config.smtp).toEqual({ host: 'smtp.corp.com', port: 25, from: 'ai@corp.com' });
  });

  it('requires SMTP_FROM when SMTP_HOST is set', () => {
    expect(() => loadConfig({ ...validEnv, SMTP_HOST: 'smtp.corp.com' })).toThrow(/SMTP_FROM/);
  });
});

describe('loadConfig RAG', () => {
  const ragEnv = {
    EMBEDDING_API_BASE_URL: 'http://localhost:8080/v1',
    PGVECTOR_CONNECTION_STRING: 'postgres://ai:secret@localhost:5432/rag',
  };

  it('disables RAG by default and applies defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.rag.enabled).toBe(false);
    expect(config.rag.schedule).toBe('0 2 * * *');
    expect(config.rag.chunkSize).toBe(1000);
    expect(config.rag.chunkOverlap).toBe(200);
    expect(config.rag.embeddingModelName).toBe('bge-large-en-v1.5');
    expect(config.rag.embeddingDimensions).toBe(1024);
  });

  it('enables RAG when both services are configured', () => {
    const config = loadConfig({ ...validEnv, ...ragEnv });
    expect(config.rag.enabled).toBe(true);
    expect(config.rag.embeddingApiBaseUrl).toBe('http://localhost:8080/v1');
    expect(config.rag.pgvectorConnectionString).toBe('postgres://ai:secret@localhost:5432/rag');
  });

  it('throws when only one of the two RAG services is configured', () => {
    expect(() => loadConfig({ ...validEnv, EMBEDDING_API_BASE_URL: 'http://x' })).toThrow(
      /EMBEDDING_API_BASE_URL/,
    );
    expect(() => loadConfig({ ...validEnv, PGVECTOR_CONNECTION_STRING: 'postgres://x' })).toThrow(
      /PGVECTOR_CONNECTION_STRING/,
    );
  });

  it('reads custom chunking/schedule/model from env', () => {
    const config = loadConfig({
      ...validEnv,
      ...ragEnv,
      RAG_INDEX_SCHEDULE: '0 4 * * *',
      RAG_CHUNK_SIZE: '500',
      RAG_CHUNK_OVERLAP: '50',
      EMBEDDING_MODEL_NAME: 'custom-model',
      EMBEDDING_DIMENSIONS: '768',
    });
    expect(config.rag.schedule).toBe('0 4 * * *');
    expect(config.rag.chunkSize).toBe(500);
    expect(config.rag.chunkOverlap).toBe(50);
    expect(config.rag.embeddingModelName).toBe('custom-model');
    expect(config.rag.embeddingDimensions).toBe(768);
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => loadConfig({ ...validEnv, ...ragEnv, RAG_CHUNK_SIZE: '0' })).toThrow(
      /RAG_CHUNK_SIZE/,
    );
  });

  it('rejects a chunk overlap >= chunk size', () => {
    expect(() =>
      loadConfig({ ...validEnv, ...ragEnv, RAG_CHUNK_SIZE: '100', RAG_CHUNK_OVERLAP: '100' }),
    ).toThrow(/RAG_CHUNK_OVERLAP/);
  });
});

describe('loadConfig LLM', () => {
  it('disables chat by default and applies defaults', () => {
    const config = loadConfig(validEnv);
    expect(config.llm.enabled).toBe(false);
    expect(config.llm.model).toBe('deepseek-chat');
    expect(config.llm.temperature).toBe(0);
    expect(config.llm.maxSteps).toBe(8);
  });

  it('enables chat when LLM_API_BASE_URL is set', () => {
    const config = loadConfig({ ...validEnv, LLM_API_BASE_URL: 'https://api.deepseek.com/v1' });
    expect(config.llm.enabled).toBe(true);
    expect(config.llm.baseUrl).toBe('https://api.deepseek.com/v1');
    expect(config.llm.apiKey).toBe('not-needed');
  });

  it('reads custom model/temperature/steps', () => {
    const config = loadConfig({
      ...validEnv,
      LLM_API_BASE_URL: 'http://localhost:11434/v1',
      LLM_API_KEY: 'ollama',
      LLM_MODEL: 'qwen2.5',
      LLM_TEMPERATURE: '0.5',
      LLM_MAX_STEPS: '12',
    });
    expect(config.llm.model).toBe('qwen2.5');
    expect(config.llm.temperature).toBe(0.5);
    expect(config.llm.maxSteps).toBe(12);
  });

  it('rejects a negative temperature', () => {
    expect(() =>
      loadConfig({ ...validEnv, LLM_API_BASE_URL: 'http://x', LLM_TEMPERATURE: '-1' }),
    ).toThrow(/LLM_TEMPERATURE/);
  });
});
