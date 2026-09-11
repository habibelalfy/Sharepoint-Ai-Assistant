/**
 * Generates `src/prompts/system-prompt.md` from the live tool registry.
 *
 * Run after `npm run build`:
 *
 *   npm run generate:prompt
 *
 * @module prompts/generate-system-prompt
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server';
import type { SharePointClient } from '../sharepoint/client';
import { buildToolCatalog, renderSystemPrompt } from './system-prompt';

export async function generateSystemPrompt(): Promise<string> {
  // A dummy client is enough: registration and tools/list never touch SharePoint.
  const server = createServer({} as SharePointClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'prompt-generator', version: '1.0.0' });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const prompt = renderSystemPrompt(buildToolCatalog(tools));

  await client.close();
  await server.close();

  return prompt;
}

if (require.main === module) {
  generateSystemPrompt()
    .then((prompt) => {
      writeFileSync(join(process.cwd(), 'src', 'prompts', 'system-prompt.md'), prompt);
      console.error('Wrote src/prompts/system-prompt.md');
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
