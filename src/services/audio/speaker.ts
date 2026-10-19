import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, desktopCapturer, ipcMain } from 'electron';
import type { AudioInput, ListenOptions } from './recognition';
import { recognize, SAMPLE_RATE } from './recognition';

function createSpeakerInput(): AudioInput {
  const id = randomUUID();
  const frameChannel = `audio-speaker-frame-${id}`;
  const readyChannel = `audio-speaker-ready-${id}`;
  const errorChannel = `audio-speaker-error-${id}`;
  const frames: Buffer[] = [];
  const readers: Array<(frame: Buffer | null) => void> = [];
  let window: BrowserWindow | undefined;
  let capturePagePath: string | undefined;
  let closed = false;
  let captureError: Error | undefined;
  let resolveStartup: (() => void) | undefined;
  let rejectStartup: ((error: Error) => void) | undefined;

  const wakeReaders = () => {
    while (readers.length > 0) {
      const reader = readers.shift();
      reader?.(null);
    }
  };

  const onFrame = (event: Electron.IpcMainEvent, frame: unknown) => {
    if (!window || event.sender.id !== window.webContents.id) return;
    if (!(frame instanceof ArrayBuffer)) {
      captureError = new Error('Received an invalid speaker audio frame.');
      wakeReaders();
      return;
    }
    const buffer = Buffer.from(frame);
    const reader = readers.shift();
    if (reader) reader(buffer);
    else frames.push(buffer);
  };
  const onReady = (event: Electron.IpcMainEvent) => {
    if (!window || event.sender.id !== window.webContents.id) return;
    resolveStartup?.();
  };
  const onError = (event: Electron.IpcMainEvent, message: unknown) => {
    if (!window || event.sender.id !== window.webContents.id) return;
    const error = new Error(
      typeof message === 'string'
        ? message
        : "Unable to capture the computer's audio output.",
    );
    captureError = error;
    rejectStartup?.(error);
    wakeReaders();
  };

  const closeWindow = () => {
    if (window && !window.isDestroyed()) window.close();
  };
  const onWindowClosed = () => {
    window = undefined;
    if (capturePagePath) {
      try {
        fs.rmSync(capturePagePath, { force: true });
      } catch (error) {
        console.error('Unable to remove speaker capture page:', error);
      }
      capturePagePath = undefined;
    }
    if (!closed) {
      captureError = new Error('Speaker audio capture ended unexpectedly.');
    }
    closed = true;
    resolveStartup?.();
    wakeReaders();
  };

  return {
    async start() {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      });
      if (closed) return;
      const source = sources[0];
      if (!source) {
        throw new Error('No screen source is available for audio loopback.');
      }

      window = new BrowserWindow({
        show: false,
        webPreferences: {
          nodeIntegration: true,
          contextIsolation: false,
          backgroundThrottling: false,
        },
      });
      ipcMain.on(frameChannel, onFrame);
      ipcMain.on(readyChannel, onReady);
      ipcMain.on(errorChannel, onError);
      window.on('closed', onWindowClosed);

      const script = `
				const { ipcRenderer } = require("electron");
				const frameChannel = ${JSON.stringify(frameChannel)};
				const readyChannel = ${JSON.stringify(readyChannel)};
				const errorChannel = ${JSON.stringify(errorChannel)};
				const sourceId = ${JSON.stringify(source.id)};
				(async () => {
					try {
						const constraints = {
							audio: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId } },
							video: { mandatory: { chromeMediaSource: "desktop", chromeMediaSourceId: sourceId, maxWidth: 1, maxHeight: 1 } }
						};
						if (!navigator.mediaDevices?.getUserMedia) {
							throw new Error("Audio capture requires a secure page context.");
						}
						const stream = await navigator.mediaDevices.getUserMedia(constraints);
						const context = new AudioContext({ sampleRate: ${SAMPLE_RATE} });
						await context.resume();
						const input = context.createMediaStreamSource(stream);
						const processor = context.createScriptProcessor(1024, 1, 1);
						const mute = context.createGain();
						mute.gain.value = 0;
						processor.onaudioprocess = (event) => {
							const samples = event.inputBuffer.getChannelData(0);
							const pcm = new Int16Array(samples.length);
							for (let i = 0; i < samples.length; i++) {
								const sample = Math.max(-1, Math.min(1, samples[i]));
								pcm[i] = sample < 0 ? sample * 32768 : sample * 32767;
							}
							ipcRenderer.send(frameChannel, pcm.buffer);
						};
						input.connect(processor);
						processor.connect(mute);
						mute.connect(context.destination);
						stream.getVideoTracks().forEach((track) => track.stop());
						ipcRenderer.send(readyChannel);
					} catch (error) {
						ipcRenderer.send(errorChannel, error instanceof Error ? error.message : String(error));
					}
				})();
			`;

      try {
        const startup = new Promise<void>((resolve, reject) => {
          resolveStartup = resolve;
          rejectStartup = reject;
        });
        capturePagePath = path.join(
          app.getPath('temp'),
          `language-audio-${id}.html`,
        );
        fs.writeFileSync(capturePagePath, `<script>${script}</script>`);
        await Promise.all([window.loadFile(capturePagePath), startup]);
        if (captureError) throw captureError;
      } catch (error) {
        this.release();
        throw error;
      }
    },
    read() {
      if (captureError) return Promise.reject(captureError);
      const frame = frames.shift();
      if (frame) return Promise.resolve(frame);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => readers.push(resolve));
    },
    stop() {
      if (closed) return;
      closed = true;
      resolveStartup?.();
      wakeReaders();
      closeWindow();
    },
    release() {
      ipcMain.removeListener(frameChannel, onFrame);
      ipcMain.removeListener(readyChannel, onReady);
      ipcMain.removeListener(errorChannel, onError);
      closeWindow();
      frames.length = 0;
      wakeReaders();
    },
  };
}

export function listenSpeaker(options: ListenOptions): Promise<string> {
  return recognize(options, createSpeakerInput);
}
