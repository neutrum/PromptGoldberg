import { parentPort, workerData } from 'node:worker_threads';
import { initPhysics, simulateSync, traceHash } from '../src';

// A fresh engine instance in its own thread must reproduce the main thread's trace exactly.
await initPhysics();
parentPort!.postMessage(traceHash(simulateSync(workerData)));
