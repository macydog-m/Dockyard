export const MAX_RESPONSE_BYTES = 60 * 1024;

// Include the escaped JSON text copy as well as structuredContent.
export function responseBytes(result: unknown): number {
  return Buffer.byteLength(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
  }), 'utf8');
}
