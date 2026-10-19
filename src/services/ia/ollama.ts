const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/+$/,
  '',
);
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3';

interface AskOllamaOptions {
  model?: string;
  format?: Record<string, unknown>;
}

async function askOllama(
  prompt: string,
  { model = DEFAULT_MODEL, format }: AskOllamaOptions = {},
): Promise<string> {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('"prompt" debe ser un texto no vacío.');
  }
  if (typeof model !== 'string' || model.trim().length === 0) {
    throw new TypeError('"model" debe ser un nombre de modelo no vacío.');
  }

  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.trim(),
        prompt: prompt.trim(),
        stream: false,
        ...(format ? { format } : {}),
      }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('Ollama tardó demasiado en responder.', { cause: error });
    }
    throw new Error(
      'No se pudo conectar con Ollama. Verifica que esté iniciado.',
      { cause: error },
    );
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Ollama respondió con HTTP ${response.status}${details ? `: ${details}` : ''}`,
    );
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('Ollama devolvió una respuesta JSON inválida.', {
      cause: error,
    });
  }

  if (
    typeof data !== 'object' ||
    data === null ||
    !('response' in data) ||
    typeof data.response !== 'string'
  ) {
    throw new Error('Ollama devolvió una respuesta inesperada.');
  }

  return data.response;
}

export { askOllama };
