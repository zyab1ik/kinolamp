import { install, nameExtension } from './install.js';
import { createClient } from './client.js';
import { escapeText, httpsURL } from './text.js';
import {
  streams,
  audioTitle,
  matchItem,
  mediaKey,
  episodeQueue,
  voiceIdentity
} from './media.js';
import { createNativePages } from './pages.js';
import { createProgress } from './progress.js';
import { createDiagnostics } from './diagnostics.js';

// Keep the public CommonJS API used by integration tests and existing consumers.
export default {
  install: install,
  createClient: createClient,
  escapeText: escapeText,
  httpsURL: httpsURL,
  streams: streams,
  audioTitle: audioTitle,
  matchItem: matchItem,
  createNativePages: createNativePages,
  nameExtension: nameExtension,
  mediaKey: mediaKey,
  createProgress: createProgress,
  episodeQueue: episodeQueue,
  voiceIdentity: voiceIdentity,
  createDiagnostics: createDiagnostics
};
