import { askOllama } from './ollama';

const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL || 'translategemma';

async function translate(
  text: string,
  source: string,
  target: string,
): Promise<string> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new TypeError('"text" debe ser un texto no vacío.');
  }
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw new TypeError('"source" debe ser un idioma no vacío.');
  }
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new TypeError('"target" debe ser un idioma no vacío.');
  }

  return askOllama(
    `Translate the following text from ${source.trim()} to ${target.trim()}. Return only the translated text, without explanations or additional formatting:\n\n${text.trim()}`,
    { model: TRANSLATION_MODEL },
  );
}

export { translate };
