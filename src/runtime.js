// Detects whether this process is a Node "Single Executable Application"
// (the packaged .exe/binary produced for releases) rather than a normal
// `node bin/subchain.mjs` invocation. A packaged binary has no sibling
// source files to resolve paths against via import.meta.url, so anything
// that locates project files (chain.config.json, .env, webui/) needs to
// know to look next to the executable instead.
import { isSea } from 'node:sea';
import path from 'node:path';

export const IS_SEA = isSea();
export const EXE_DIR = IS_SEA ? path.dirname(process.execPath) : null;
