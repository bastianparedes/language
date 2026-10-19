import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PvRecorder } from '@picovoice/pvrecorder-node';
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  ipcMain,
} from 'electron';
import { listenMicrophone, listenSpeaker } from './services/audio';
import {
  ensureOllamaAvailable,
  shutdownOllama,
  translate,
} from './services/ia';
import {
  AVAILABLE_LANGUAGES,
  isLanguageCode,
  type LanguageCode,
} from './types/language';

type AudioSource = 'microphone' | 'speaker';

const LANGUAGE_NAMES = {
  es: 'Español',
  de: 'Deutsch',
  en: 'English',
  fr: 'Français',
} satisfies Record<LanguageCode, string>;

// Limpiar argumentos para ignorar comandos propios de electron
const args = process.argv.slice(2);
const cleanArgs = args.filter((arg) => arg !== '.' && !arg.endsWith('main.js'));

if (cleanArgs[0] === 'dispositivos') {
  PvRecorder.getAvailableDevices();
  app.quit();
  process.exit(0);
}

const inputLanguage = (cleanArgs[0] || 'es').toLowerCase();
if (!isLanguageCode(inputLanguage)) {
  console.error(
    `Idioma no soportado: "${inputLanguage}". Usa: ${AVAILABLE_LANGUAGES.join(', ')}`,
  );
  app.quit();
  process.exit(1);
}
let codigo: LanguageCode = inputLanguage;
const indiceMic = cleanArgs[1] !== undefined ? Number(cleanArgs[1]) : -1;
const outputLanguage = (cleanArgs[2] || '').toLowerCase();
const initialOutputLanguage =
  outputLanguage === ''
    ? ''
    : isLanguageCode(outputLanguage)
      ? outputLanguage
      : undefined;
if (initialOutputLanguage === undefined) {
  console.error(
    `Idioma destino no soportado: "${outputLanguage}". Usa: ${AVAILABLE_LANGUAGES.join(', ')}`,
  );
  app.quit();
  process.exit(1);
}
let idiomaDestino: LanguageCode | '' = initialOutputLanguage;
let mainWindow: BrowserWindow | null = null;
let audioController: AbortController | null = null;
let requestedAudioSource: AudioSource = 'microphone';
let isQuitting = false;
let isShuttingDownOllama = false;

function createWindow() {
  const rendererScript = readFileSync(
    path.join(__dirname, 'renderer.js'),
    'utf8',
  );
  const inputLanguageOptions = AVAILABLE_LANGUAGES.map(
    (code) =>
      `<option value="${code}" ${codigo === code ? 'selected' : ''}>${LANGUAGE_NAMES[code]}</option>`,
  ).join('');
  const outputLanguageOptions = AVAILABLE_LANGUAGES.map(
    (code) =>
      `<option value="${code}" ${idiomaDestino === code ? 'selected' : ''}>${LANGUAGE_NAMES[code]}</option>`,
  ).join('');
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: `Transcripción en Vivo - ${LANGUAGE_NAMES[codigo]}${idiomaDestino ? ` -> ${LANGUAGE_NAMES[idiomaDestino]}` : ''}`,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Interfaz visual incrustada con soporte para original y traducción
  mainWindow.loadURL(
    `data:text/html;charset=utf-8,` +
      encodeURIComponent(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>Transcripción y Traducción</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .card { background: #1e293b; padding: 2rem; border-radius: 1rem; width: 85%; height: 75vh; box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; box-sizing: border-box; }
        h2 { margin-top: 0; color: #38bdf8; display: flex; align-items: center; gap: 10px; font-size: 1.2rem; }
        .controls { display: flex; gap: 1rem; margin-bottom: 1rem; }
        .control { display: flex; flex: 1; flex-direction: column; gap: 0.4rem; }
        label { color: #cbd5e1; font-size: 0.9rem; }
        select { background: #0f172a; color: #f8fafc; border: 1px solid #475569; border-radius: 0.4rem; padding: 0.6rem; font: inherit; }
        .pulse { width: 12px; height: 12px; background: #ef4444; border-radius: 50%; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.7); } 70% { box-shadow: 0 0 0 10px rgba(239, 68, 68, 0); } 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); } }
        #transcripcion { font-size: 1.1rem; line-height: 1.5; overflow-y: auto; background: #0f172a; padding: 1rem; border-radius: 0.5rem; border: 1px solid #334155; flex-grow: 1; word-break: break-word; }
        .parcial { color: #94a3b8; font-style: italic; }
        .traducido { color: #34d399; font-size: 0.95rem; margin-bottom: 0.8rem; display: block; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2 id="estado"><div class="pulse"></div> Escuchando por micrófono en ${LANGUAGE_NAMES[codigo]}${idiomaDestino ? ` -> Traduciendo a ${LANGUAGE_NAMES[idiomaDestino]}` : ''}</h2>
        <div class="controls">
          <div class="control">
            <label for="fuente-audio">Fuente de audio</label>
            <select id="fuente-audio">
              <option value="microphone" selected>Micrófono</option>
              <option value="speaker">Parlante</option>
            </select>
          </div>
          <div class="control">
            <label for="idioma-entrada">Idioma de entrada</label>
            <select id="idioma-entrada">
              ${inputLanguageOptions}
            </select>
          </div>
          <div class="control">
            <label for="idioma-salida">Idioma de salida</label>
            <select id="idioma-salida">
              <option value="" ${idiomaDestino === '' ? 'selected' : ''}>Sin traducción</option>
              ${outputLanguageOptions}
            </select>
          </div>
        </div>
        <div id="transcripcion"></div>
      </div>
      <script>const languageNames = ${JSON.stringify(LANGUAGE_NAMES)};\n${rendererScript}</script>
    </body>
    </html>
  `),
  );

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await ensureOllamaAvailable();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Error desconocido.';
    console.error('Ollama no está disponible:', error);
    dialog.showErrorBox(
      'Ollama no disponible',
      `${message}\n\nInicia Ollama y vuelve a abrir la aplicación.`,
    );
    app.quit();
    return;
  }

  createWindow();

  function updateWindowTitle() {
    const destination = idiomaDestino
      ? ` -> ${LANGUAGE_NAMES[idiomaDestino]}`
      : '';
    if (mainWindow) {
      mainWindow.setTitle(
        `Transcripción en Vivo - ${LANGUAGE_NAMES[codigo]}${destination}`,
      );
    }
  }

  ipcMain.on(
    'set-input-language',
    (_event: IpcMainEvent, nextCode: unknown) => {
      if (typeof nextCode !== 'string' || !isLanguageCode(nextCode)) return;
      if (nextCode === codigo) return;
      requestedCodigo = nextCode;
    },
  );

  ipcMain.on('set-audio-source', (_event: IpcMainEvent, source: unknown) => {
    if (source !== 'microphone' && source !== 'speaker') return;
    if (source === requestedAudioSource) return;
    requestedAudioSource = source;
    audioController?.abort();
  });

  ipcMain.on(
    'set-output-language',
    (_event: IpcMainEvent, nextCode: unknown) => {
      if (
        nextCode !== '' &&
        (typeof nextCode !== 'string' || !isLanguageCode(nextCode))
      )
        return;
      idiomaDestino = nextCode;
      updateWindowTitle();
    },
  );

  let finalQueue = Promise.resolve();
  let requestedCodigo = codigo;
  while (!isQuitting) {
    const controller = new AbortController();
    audioController = controller;
    try {
      const listen =
        requestedAudioSource === 'microphone'
          ? listenMicrophone
          : listenSpeaker;
      await listen({
        language: () => requestedCodigo,
        deviceIndex: indiceMic,
        signal: controller.signal,
        onPartial: (partial) => {
          if (mainWindow) mainWindow.webContents.send('parcial', partial);
        },
        onLanguageChanged: (nextCode) => {
          codigo = nextCode;
          updateWindowTitle();
          if (mainWindow)
            mainWindow.webContents.send('input-language-changed', codigo);
        },
        onLanguageError: (error, currentCode) => {
          console.error('Error al cambiar el idioma de entrada:', error);
          requestedCodigo = currentCode;
          if (mainWindow)
            mainWindow.webContents.send('input-language-error', currentCode);
        },
        onFinal: (text, sourceCode) => {
          const targetCode = idiomaDestino;
          const completeFinal = async () => {
            let textoTraducido = '';
            if (targetCode) {
              try {
                textoTraducido = await translate(text, sourceCode, targetCode);
              } catch (err) {
                console.error('Error en traducción:', err);
              }
            }

            if (mainWindow) {
              mainWindow.webContents.send('final', {
                original: text,
                traducido: textoTraducido,
              });
            }
          };
          finalQueue = finalQueue
            .then(completeFinal)
            .catch((err) =>
              console.error('Error al procesar transcripción:', err),
            );
        },
      });
    } catch (err) {
      if (!controller.signal.aborted) {
        console.error(
          'Error de micrófono o reconocimiento:',
          err instanceof Error ? err.message : err,
        );
        app.quit();
        break;
      }
    } finally {
      if (audioController === controller) audioController = null;
    }
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', (event) => {
  isQuitting = true;
  if (audioController) audioController.abort();
  if (isShuttingDownOllama) return;

  isShuttingDownOllama = true;
  event.preventDefault();
  void shutdownOllama()
    .then(() => app.quit())
    .catch((error: unknown) => {
      const message =
        error instanceof Error ? error.message : 'Error desconocido.';
      console.error('No se pudo apagar Ollama:', error);
      dialog.showErrorBox('No se pudo apagar Ollama', message);
      app.exit(1);
    });
});
