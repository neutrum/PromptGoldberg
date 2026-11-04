// A worker that answers each task after the time it is told to wait.
import { parentPort } from 'node:worker_threads';
parentPort.on('message', (ms) => setTimeout(() => parentPort.postMessage({ type: 'done', result: ms }), ms));
