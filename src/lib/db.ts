import { MongoClient, type Db } from "mongodb";

const defaultUri = "mongodb://127.0.0.1:27017/business-management-dashboard";
const defaultDatabaseName = "business-management-dashboard";

type MongoState = {
  client: MongoClient;
  connection?: Promise<MongoClient>;
  uri: string;
  databaseName: string;
};

const globalMongo = globalThis as typeof globalThis & {
  __businessManagementMongo?: MongoState;
};

function resolveUri() {
  return process.env.MONGODB_URI || defaultUri;
}

function resolveDatabaseName() {
  return process.env.MONGODB_DB || defaultDatabaseName;
}

function getMongoState(): MongoState {
  const uri = resolveUri();
  const databaseName = resolveDatabaseName();
  const existing = globalMongo.__businessManagementMongo;

  if (!existing || existing.uri !== uri || existing.databaseName !== databaseName) {
    if (existing?.connection) {
      void existing.client.close().catch(() => undefined);
    }

    globalMongo.__businessManagementMongo = {
      client: new MongoClient(uri),
      uri,
      databaseName,
    };
  }

  return globalMongo.__businessManagementMongo!;
}

export const mongoClient = new Proxy({} as MongoClient, {
  get(_target, property, receiver) {
    const client = getMongoState().client;
    const value = Reflect.get(client, property, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export const db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    const database = getMongoState().client.db(getMongoState().databaseName);
    const value = Reflect.get(database, property, receiver);
    return typeof value === "function" ? value.bind(database) : value;
  },
});

export async function connectMongo() {
  const mongoState = getMongoState();

  if (!mongoState.connection) {
    mongoState.connection = mongoState.client.connect().catch((error) => {
      mongoState.connection = undefined;
      throw error;
    });
  }

  await mongoState.connection;
  return db;
}
