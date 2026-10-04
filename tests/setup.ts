import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";

const testEnv = process.env as Record<string, string | undefined>;
testEnv.NODE_ENV = "test";
testEnv.BETTER_AUTH_SECRET = "test-only-secret-not-for-production";
testEnv.BETTER_AUTH_URL = "http://localhost:3000";
testEnv.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
// Force an isolated URI placeholder until the memory server starts.
testEnv.MONGODB_URI = "mongodb://127.0.0.1:0/business-management-dashboard-test-uninitialized";
testEnv.MONGODB_DB = "business-management-dashboard-test";

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();

  if (uri.includes("mongodb+srv") || uri.includes("mongodb.net")) {
    throw new Error("Refusing to run tests against a remote MongoDB URI");
  }

  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = "business-management-dashboard-test";

  const globalMongo = globalThis as typeof globalThis & {
    __businessManagementMongo?: unknown;
  };
  delete globalMongo.__businessManagementMongo;

  const { connectMongo } = await import("@/lib/db");
  await connectMongo();
}, 120_000);

afterEach(async () => {
  const { db } = await import("@/lib/db");
  const collections = await db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
  vi.clearAllMocks();
});

afterAll(async () => {
  const { mongoClient } = await import("@/lib/db");
  await mongoClient.close();
  if (mongod) await mongod.stop();
}, 120_000);
