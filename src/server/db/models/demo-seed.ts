import type { Collection } from "mongodb";
import { db } from "@/lib/db";

export interface DemoSeedDocument {
  seedKey: string;
  version: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

let indexesPromise: Promise<void> | null = null;

export function getDemoSeedsCollection(): Collection<DemoSeedDocument> {
  return db.collection<DemoSeedDocument>("demoSeeds");
}

export async function ensureDemoSeedIndexes() {
  if (!indexesPromise) {
    indexesPromise = getDemoSeedsCollection()
      .createIndexes([
        { key: { seedKey: 1 }, name: "seed_key_unique", unique: true },
        { key: { userId: 1 }, name: "user_id_unique", unique: true },
      ])
      .then(() => undefined);
  }

  return indexesPromise;
}