import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Offer } from '../src/models/Offer.js';

function isLegacyProposalIndex(index) {
  return (
    index.name === 'proposal_1' &&
    index.key?.proposal === 1 &&
    Object.keys(index.key).length === 1 &&
    !index.unique &&
    !index.partialFilterExpression
  );
}

try {
  await connectDB();

  const collectionExists = await mongoose.connection.db.listCollections({ name: Offer.collection.name }).hasNext();
  if (collectionExists) {
    const duplicates = await Offer.aggregate([
      { $match: { active: true } },
      { $group: { _id: '$proposal', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]);

    if (duplicates.length > 0) {
      throw new Error('Cannot create the active-offer constraint while a proposal has multiple active offers.');
    }

    const indexes = await Offer.collection.indexes();
    const legacyIndex = indexes.find(isLegacyProposalIndex);
    if (legacyIndex) {
      await Offer.collection.dropIndex(legacyIndex.name);
      console.log('Removed the obsolete offer proposal index.');
    }
  }

  await Offer.createIndexes();
  console.log('Offer indexes are ready.');
} catch (error) {
  console.error(`Offer index repair failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
