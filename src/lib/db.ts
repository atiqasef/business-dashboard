import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/business-management-dashboard";
const databaseName = process.env.MONGODB_DB || "business-management-dashboard";

type MongoState = {
  client: MongoClient;
  connection?: Promise<MongoClient>;
};

const globalMongo = globalThis as typeof globalThis & {
  __businessManagementMongo?: MongoState;
};

const mongoState = globalMongo.__businessManagementMongo ??= {
  client: new MongoClient(uri),
};

export const mongoClient = mongoState.client;
export const db = mongoClient.db(databaseName);

export async function connectMongo() {
  if (!mongoState.connection) {
    mongoState.connection = mongoClient.connect().catch((error) => {
      mongoState.connection = undefined;
      throw error;
    });
  }

  await mongoState.connection;
  return db;
}
