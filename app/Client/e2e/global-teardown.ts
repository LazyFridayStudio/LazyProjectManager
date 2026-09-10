import { stopWorker } from './run-worker.js';

export default function globalTeardown(): void {
  stopWorker();
}
