import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { config } from './index.js';

let memoryServer = null;

export async function connectDB() {
  mongoose.set('strictQuery', true);
  mongoose.set('sanitizeFilter', true);

  if (mongoose.connection.readyState === 1) return mongoose.connection;

  if (config.mongoUri) {
    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 30000 });
    return mongoose.connection;
  }

  if (config.isProduction) throw new Error('MONGODB_URI is required in production.');

  memoryServer = await MongoMemoryServer.create();
  await mongoose.connect(memoryServer.getUri(), { serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
