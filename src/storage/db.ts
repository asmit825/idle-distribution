import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { PersonalBestRecord, RoundRecord, RoundMode } from './types';

interface IdleDistributionDB extends DBSchema {
  rounds: { key: string; value: RoundRecord };
  personal_bests: { key: RoundMode; value: PersonalBestRecord };
}
let connection: Promise<IDBPDatabase<IdleDistributionDB>> | undefined;
/** Version 1 is the initial schema. Future migrations belong in this upgrade callback. */
export function openStorage() {
  return connection ??= openDB<IdleDistributionDB>('IdleDistributionDB', 1, {
    upgrade(db) {
      db.createObjectStore('rounds', { keyPath: 'id' });
      db.createObjectStore('personal_bests', { keyPath: 'mode' });
    },
    blocking() { void connection?.then(db => db.close()); connection = undefined; },
    terminated() { connection = undefined; },
  }).catch(error => { connection = undefined; throw error; });
}
