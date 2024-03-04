import { CosmosClient } from "@azure/cosmos";
import { BSON, MongoClient } from "mongodb";

// Read Cosmos DB_NAME and CONTAINER_NAME from .env
const DB_NAME = process.env.AZURE_COSMOSDB_DB_NAME || "chat";
const CONTAINER_NAME = process.env.AZURE_COSMOSDB_CONTAINER_NAME || "history";
const CONFIG_CONTAINER_NAME =
  process.env.AZURE_COSMOSDB_CONFIG_CONTAINER_NAME || "config";

export const CosmosInstance = () => {
  const endpoint = process.env.AZURE_COSMOSDB_URI;
  const key = process.env.AZURE_COSMOSDB_KEY;

  if (!endpoint || !key) {
    throw new Error(
      "Azure Cosmos DB is not configured. Please configure it in the .env file."
    );
  }

  return new CosmosClient({ endpoint, key });
};

export const MongoDbInstance = async () => {
  const connectionString = process.env.MONGODB_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error(
      "MongoDB is not configured. Please configure it in the .env file."
    );
  }
  const client = new MongoClient(connectionString);
  await client.connect();
  return client;
};


export const ConfigContainer = async <T extends BSON.Document>() => {
  const client = MongoDbInstance();
  const database = (await client).db(DB_NAME);
  const container = database.collection<T>(CONFIG_CONTAINER_NAME);
  return container;
};

export const HistoryContainer = async <T extends BSON.Document>() => {
  const client = await MongoDbInstance();
  const database = client.db(DB_NAME);
  const container = database.collection<T>(CONTAINER_NAME);
  return container;
};