import { type ChildProcess, spawn } from 'node:child_process';

const OLLAMA_URL = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(
  /\/+$/,
  '',
);
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'qwen3';
const OLLAMA_STARTUP_TIMEOUT_MS = 10_000;
const OLLAMA_STARTUP_POLL_INTERVAL_MS = 500;
let startedOllama: ChildProcess | undefined;

interface AskOllamaOptions {
  model?: string;
  format?: Record<string, unknown>;
}

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(1_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureOllamaAvailable(): Promise<void> {
  if (await isOllamaAvailable()) return;

  let server: ChildProcess;
  try {
    server = spawn('ollama', ['serve'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    throw new Error('No se pudo iniciar Ollama.', { cause: error });
  }

  let startupError: Error | undefined;
  server.once('error', (error) => {
    startupError = error;
  });
  startedOllama = server;
  server.once('close', () => {
    if (startedOllama === server) startedOllama = undefined;
  });

  const deadline = Date.now() + OLLAMA_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isOllamaAvailable()) return;
    if (startupError) {
      await shutdownOllama();
      throw new Error(
        'No se pudo iniciar Ollama. Verifica que esté instalado y disponible en PATH.',
        { cause: startupError },
      );
    }
    await new Promise((resolve) =>
      setTimeout(resolve, OLLAMA_STARTUP_POLL_INTERVAL_MS),
    );
  }

  await shutdownOllama();
  throw new Error(
    `Ollama no estuvo disponible en ${OLLAMA_STARTUP_TIMEOUT_MS / 1000} segundos.`,
    startupError ? { cause: startupError } : undefined,
  );
}

async function shutdownOllama(): Promise<void> {
  const server = startedOllama;
  if (!server) return;
  if (server.pid === undefined) {
    startedOllama = undefined;
    return;
  }
  if (server.exitCode !== null || server.signalCode !== null) {
    startedOllama = undefined;
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Ollama no se cerró dentro del tiempo esperado.'));
    }, 5_000);
    const cleanup = () => {
      clearTimeout(timeout);
      server.removeListener('exit', onExit);
      server.removeListener('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(new Error('Error al cerrar Ollama.', { cause: error }));
    };

    server.once('exit', onExit);
    server.once('error', onError);
    if (!server.kill()) {
      cleanup();
      if (server.exitCode !== null || server.signalCode !== null) resolve();
      else reject(new Error('No se pudo detener el proceso de Ollama.'));
    }
  });
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

export { askOllama, ensureOllamaAvailable, shutdownOllama };
