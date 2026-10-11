import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { PaymentTransaction } from '../src/models/PaymentTransaction.js';

// Older deployments created this optional field as a non-sparse unique index.
// Build the replacement constraint before removing the legacy constraint.
try {
  await connectDB();
  const collection = mongoose.connection.db.collection(PaymentTransaction.collection.name);
  const indexes = await collection.indexes();
  const legacy = indexes.find(i => i.name === 'providerTransactionId_1' && i.unique && !i.sparse && Object.keys(i.key).length === 1 && i.key.providerTransactionId === 1);
  if (legacy) {
    await collection.createIndex({ providerTransactionId: 1 }, { name: 'providerTransactionId_present_unique', unique: true, sparse: true });
    await collection.dropIndex(legacy.name);
    console.log('Replaced the legacy provider transaction constraint without removing payment records.');
  }
  // Keep this name in the schema: MongoDB rejects equivalent indexes under
  // different names, so trying to rename it would require a constraint gap.
  await collection.createIndex({ providerTransactionId: 1 }, { name: 'providerTransactionId_present_unique', unique: true, sparse: true });
  console.log('Payment provider index is compatible with optional IDs and retains uniqueness.');
} catch (error) {
  console.error('Payment index repair failed', { name: error.name, code: error.code, codeName: error.codeName });
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
