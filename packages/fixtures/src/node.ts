import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Node-only helpers: the browser build gets media files from the Vite plugin instead. */
export const mediaDir = fileURLToPath(new URL('../media/', import.meta.url));
export const readMedia = (file: string) => readFileSync(new URL(`../media/${file}`, import.meta.url));
