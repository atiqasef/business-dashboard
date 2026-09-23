import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/business-management-dashboard";
const databaseName = process.env.MONGODB_DB || "business-management-dashboard";

export const mongoClient = new MongoClient(uri);
export const db = mongoClient.db(databaseName);

export async function connectMongo() {
  await mongoClient.connect();
  return db;
}
