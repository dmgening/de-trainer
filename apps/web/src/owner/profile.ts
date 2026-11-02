import { LocalDb } from '../shared/db';
import { mediaCacheName } from './sync';

/** localStorage only remembers whose local database to open while offline; no learner data lives there. */
const POINTER = 'de-class:owner:user';

export const ownerDbName = (userId: string) => `de-class:owner:${userId}`;
export const currentProfileId = () => localStorage.getItem(POINTER);
export const setProfileId = (userId: string) => localStorage.setItem(POINTER, userId);

/** Logout: the personal bank, log, images and pointer leave the device before the demo can be opened (A10). */
export async function wipeLocalData(db: LocalDb | null, userId: string) {
  db?.close();
  await LocalDb.delete(ownerDbName(userId));
  await caches.delete(mediaCacheName(userId));
  if (currentProfileId() === userId) localStorage.removeItem(POINTER);
}
