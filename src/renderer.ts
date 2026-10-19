interface FinalResult {
  original: string;
  traducido: string;
}

interface ElectronIpcRenderer {
  send(channel: string, ...args: string[]): void;
  on(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => void,
  ): void;
}

declare const languageNames: Readonly<Record<string, string>>;

const { ipcRenderer } = require('electron') as {
  ipcRenderer: ElectronIpcRenderer;
};
function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`No se encontró el elemento "${selector}".`);
  }
  return element;
}

const box = requireElement<HTMLDivElement>('#transcripcion');
const audioSource = requireElement<HTMLSelectElement>('#fuente-audio');
const inputLanguage = requireElement<HTMLSelectElement>('#idioma-entrada');
const outputLanguage = requireElement<HTMLSelectElement>('#idioma-salida');
const swapLanguages = requireElement<HTMLButtonElement>('#invertir-idiomas');
const statusElement = requireElement<HTMLHeadingElement>('#estado');

type LanguageCode = keyof typeof languageNames;
let textoFinal = '';

const audioSourceNames = {
  microphone: 'micrófono',
  speaker: 'parlante',
} as const;
type AudioSource = keyof typeof audioSourceNames;

function isLanguageCode(code: string): code is LanguageCode {
  return Object.hasOwn(languageNames, code);
}

function isAudioSource(source: string): source is AudioSource {
  return Object.hasOwn(audioSourceNames, source);
}

function isFinalResult(value: unknown): value is FinalResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'original' in value &&
    typeof value.original === 'string' &&
    'traducido' in value &&
    typeof value.traducido === 'string'
  );
}

function updateStatus(): void {
  const sourceName = isAudioSource(audioSource.value)
    ? audioSourceNames[audioSource.value]
    : '';
  const inputName = isLanguageCode(inputLanguage.value)
    ? languageNames[inputLanguage.value]
    : '';
  const outputName = isLanguageCode(outputLanguage.value)
    ? languageNames[outputLanguage.value]
    : '';
  statusElement.innerHTML = `<div class="pulse"></div> Escuchando por ${sourceName} en ${inputName}${outputName ? ` -> Traduciendo a ${outputName}` : ''}`;
}

audioSource.addEventListener('change', () => {
  ipcRenderer.send('set-audio-source', audioSource.value);
  updateStatus();
});
inputLanguage.addEventListener('change', () => {
  ipcRenderer.send('set-input-language', inputLanguage.value);
});
outputLanguage.addEventListener('change', () => {
  swapLanguages.disabled = outputLanguage.value === '';
  ipcRenderer.send('set-output-language', outputLanguage.value);
  updateStatus();
});
swapLanguages.addEventListener('click', () => {
  if (!isLanguageCode(outputLanguage.value)) return;

  const previousInputLanguage = inputLanguage.value;
  inputLanguage.value = outputLanguage.value;
  outputLanguage.value = previousInputLanguage;
  ipcRenderer.send('set-input-language', inputLanguage.value);
  ipcRenderer.send('set-output-language', outputLanguage.value);
  updateStatus();
});
ipcRenderer.on('input-language-changed', (_event, value) => {
  if (typeof value !== 'string' || !isLanguageCode(value)) return;
  const code = value;
  inputLanguage.value = code;
  updateStatus();
});
ipcRenderer.on('input-language-error', (_event, value) => {
  if (typeof value !== 'string' || !isLanguageCode(value)) return;
  inputLanguage.value = value;
  updateStatus();
});

ipcRenderer.on('parcial', (_event, data) => {
  if (typeof data !== 'string') return;
  box.innerHTML = `${textoFinal}<span class="parcial"> ${data}</span>`;
  box.scrollTop = box.scrollHeight;
});

ipcRenderer.on('final', (_event, value) => {
  if (!isFinalResult(value)) return;
  const data = value;
  let htmlItem = `${data.original}<br>`;
  if (data.traducido) {
    htmlItem += `<span class="traducido">↳ ${data.traducido}</span>`;
  }
  textoFinal += `${htmlItem}<br>`;
  box.innerHTML = textoFinal;
  box.scrollTop = box.scrollHeight;
});
