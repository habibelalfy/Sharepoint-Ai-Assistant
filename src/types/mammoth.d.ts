/**
 * Minimal ambient type declaration for `mammoth` (DOCX text extraction).
 *
 * `mammoth` does not ship its own TypeScript types and no `@types/mammoth`
 * package exists on DefinitelyTyped. This declaration covers only the
 * `extractRawText` entry point the RAG extractor uses (see `rag/extraction`).
 */
declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
    error?: Error;
  }

  export interface ExtractRawTextResult {
    value: string;
    messages: MammothMessage[];
  }

  export interface RawTextInput {
    buffer: Buffer;
  }

  export function extractRawText(input: RawTextInput): Promise<ExtractRawTextResult>;
}
