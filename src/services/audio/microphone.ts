import { PvRecorder } from '@picovoice/pvrecorder-node';
import type { AudioInput, ListenOptions } from './recognition';
import { recognize } from './recognition';

const FRAME_LENGTH = 512;

function createMicrophoneInput(deviceIndex: number): AudioInput {
  const recorder = new PvRecorder(FRAME_LENGTH, deviceIndex);

  return {
    start() {
      recorder.start();
      return Promise.resolve();
    },
    async read() {
      const frame = await recorder.read();
      return Buffer.from(
        new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength),
      );
    },
    stop() {
      try {
        recorder.stop();
      } catch (_) {
        // The recorder may already have stopped because of a read error.
      }
    },
    release() {
      try {
        recorder.release();
      } catch (_) {
        // Cleanup should continue even if the device has already been released.
      }
    },
  };
}

export function listenMicrophone(options: ListenOptions): Promise<string> {
  return recognize(options, () =>
    createMicrophoneInput(options.deviceIndex ?? -1),
  );
}
