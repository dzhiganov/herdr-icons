// Entry point of the `[[startup]]` hook: animates the icons until herdr goes away.
import { runDaemon } from '../daemon.js';
import { createClient, socketPath } from '../herdr.js';

const socket = socketPath();
await runDaemon(createClient(socket), socket);
process.exit(0);
