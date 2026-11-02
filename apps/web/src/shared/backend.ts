import { createContext, useContext } from 'react';
import type { MediaInfo } from '@de-trainer/core';
import type { LocalDb } from './db';

/** What differs between the owner app and the demo; the screens only talk to this. */
export type Backend = {
  kind: 'owner' | 'demo';
  db: LocalDb;
  userId: string;
  deviceId: string;
  /** URL an <img> can show offline. */
  mediaUrl(media: MediaInfo): Promise<string | null>;
  /** Called after local writes: the owner app schedules a sync, the demo does nothing. */
  onWrite(): void;
};

export const BackendContext = createContext<Backend | null>(null);

export function useBackend(): Backend {
  const b = useContext(BackendContext);
  if (!b) throw new Error('BackendContext is missing');
  return b;
}
