import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../src/config/db.js';
import { Offer } from '../src/models/Offer.js';
import { OfferRevision } from '../src/models/OfferRevision.js';

const termFields = ['title', 'description', 'budget', 'estimatedDays', 'startDate', 'endDate', 'expiresAt', 'terms', 'milestones'];

try {
  await connectDB();
  await OfferRevision.init();
  const offers = await Offer.find({ sentAt: mongoose.trusted({ $ne: null }), currentRevision: null });
  let migrated = 0;

  for (const offer of offers) {
    const snapshot = Object.fromEntries(termFields.map((field) => [field, offer[field] ?? null]));
    const revision = await OfferRevision.findOneAndUpdate(
      { offer: offer._id, number: offer.revision || 1 },
      {
        $setOnInsert: {
          createdBy: offer.client,
          ...snapshot,
          publishedAt: offer.sentAt || offer.createdAt || new Date(),
        },
      },
      { upsert: true, new: true, runValidators: true },
    );
    const update = { currentRevision: revision._id };
    if (offer.status === 'accepted') update.acceptedRevision = revision._id;
    await Offer.updateOne({ _id: offer._id, currentRevision: null }, { $set: update });
    migrated += 1;
  }

  console.log(`Offer history migration complete. Preserved ${migrated} existing published offer(s).`);
} catch (error) {
  console.error(`Offer history migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
