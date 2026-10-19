import fs from 'node:fs';
import path from 'node:path';
import * as vosk from 'vosk-koffi';
import { isLanguageCode, type LanguageCode } from '../../types/language';

export const SAMPLE_RATE = 16000;

export interface ListenOptions {
  language: LanguageCode | (() => LanguageCode);
  deviceIndex?: number;
  onPartial?: (partial: string, language: LanguageCode) => void | Promise<void>;
  onFinal?: (text: string, language: LanguageCode) => void | Promise<void>;
  onLanguageChanged?: (language: LanguageCode) => void | Promise<void>;
  onLanguageError?: (
    error: unknown,
    language: LanguageCode,
  ) => void | Promise<void>;
  signal: AbortSignal;
}

export interface AudioInput {
  start(): Promise<void>;
  read(): Promise<Buffer | null>;
  stop(): void;
  release(): void;
}

function createRecognizer(model: vosk.Model) {
  return new vosk.Recognizer({ model, sampleRate: SAMPLE_RATE });
}

function getResultText(result: string | null): string {
  if (result === null) return '';

  const parsed: unknown = JSON.parse(result);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('text' in parsed) ||
    typeof parsed.text !== 'string'
  ) {
    throw new Error('Vosk returned an unexpected recognition result.');
  }
  return parsed.text;
}

export async function recognize(
  {
    language,
    onPartial = () => {},
    onFinal = () => {},
    onLanguageChanged = () => {},
    onLanguageError = () => {},
    signal,
  }: ListenOptions,
  createInput: () => AudioInput,
): Promise<string> {
  if (!signal)
    throw new Error(
      'An AbortSignal is required to manage the audio lifecycle.',
    );
  if (signal.aborted) return '';

  vosk.setLogLevel(-1);

  let activeLanguage = typeof language === 'function' ? language() : language;
  let attemptedLanguage = activeLanguage;
  let model: vosk.Model | undefined;
  let recognizer: ReturnType<typeof createRecognizer> | undefined;
  let input: AudioInput | undefined;
  let lastRecognized = '';
  let stopping = false;

  const notify = <Args extends unknown[]>(
    callback: (...args: Args) => unknown,
    ...args: Args
  ): void => {
    try {
      const result = callback(...args);
      if (result instanceof Promise) {
        result.catch((error) => console.error('Audio callback failed:', error));
      }
    } catch (error) {
      console.error('Audio callback failed:', error);
    }
  };

  const stopRecorder = () => {
    if (!input || stopping) return;
    stopping = true;
    input.stop();
  };

  signal.addEventListener('abort', stopRecorder, { once: true });

  try {
    const modelPath = (code: string): string => {
      if (!isLanguageCode(code)) {
        throw new Error(`Unsupported input language: "${code}".`);
      }
      return path.join(
        __dirname,
        '..',
        '..',
        '..',
        'src',
        'services',
        'audio',
        'speech-models',
        code,
        'small',
      );
    };

    const initialModelPath = modelPath(activeLanguage);
    if (!fs.existsSync(initialModelPath)) {
      throw new Error(`Missing Vosk model: ${initialModelPath}`);
    }
    model = new vosk.Model(initialModelPath);
    recognizer = createRecognizer(model);

    input = createInput();
    await input.start();

    while (!signal.aborted) {
      const requestedLanguage =
        typeof language === 'function' ? language() : language;
      if (
        requestedLanguage !== activeLanguage &&
        requestedLanguage !== attemptedLanguage
      ) {
        attemptedLanguage = requestedLanguage;
        let nextModel: vosk.Model | undefined;
        let nextRecognizer: ReturnType<typeof createRecognizer> | undefined;
        try {
          const nextModelPath = modelPath(requestedLanguage);
          if (!fs.existsSync(nextModelPath)) {
            throw new Error(`Missing Vosk model: ${nextModelPath}`);
          }
          nextModel = new vosk.Model(nextModelPath);
          nextRecognizer = createRecognizer(nextModel);

          const previousModel = model;
          const previousRecognizer = recognizer;
          model = nextModel;
          recognizer = nextRecognizer;
          activeLanguage = requestedLanguage;
          if (previousRecognizer) {
            try {
              previousRecognizer.free();
            } catch (error) {
              console.error('Unable to free previous recognizer:', error);
            }
          }
          if (previousModel) {
            try {
              previousModel.free();
            } catch (error) {
              console.error('Unable to free previous model:', error);
            }
          }
          notify(onLanguageChanged, activeLanguage);
        } catch (error) {
          if (nextRecognizer && nextRecognizer !== recognizer) {
            try {
              nextRecognizer.free();
            } catch (freeError) {
              console.error('Unable to free unused recognizer:', freeError);
            }
          }
          if (nextModel && nextModel !== model) {
            try {
              nextModel.free();
            } catch (freeError) {
              console.error('Unable to free unused model:', freeError);
            }
          }
          attemptedLanguage = activeLanguage;
          notify(onLanguageError, error, activeLanguage);
        }
      }

      let chunk: Buffer | null;
      try {
        chunk = (await input?.read()) ?? null;
      } catch (error) {
        if (signal.aborted) break;
        throw error;
      }
      if (signal.aborted || chunk === null) break;

      if (recognizer.acceptWaveform(chunk)) {
        const text = getResultText(recognizer.resultString());
        if (text) {
          lastRecognized = text;
          notify(onFinal, text, activeLanguage);
        }
      } else {
        const { partial } = recognizer.partialResult();
        if (partial) notify(onPartial, partial, activeLanguage);
      }
    }
  } finally {
    signal.removeEventListener('abort', stopRecorder);
    stopRecorder();
    input?.release();
    if (recognizer) {
      try {
        recognizer.free();
      } catch (error) {
        console.error('Unable to free recognizer:', error);
      }
    }
    if (model) {
      try {
        model.free();
      } catch (error) {
        console.error('Unable to free model:', error);
      }
    }
  }

  return lastRecognized;
}
