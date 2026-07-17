require('dotenv').config();
const mongoose = require('mongoose');
const Template = require('../models/Template');

async function run() {
  if (process.env.CONFIRM_DELETE_TEMPLATES !== 'YES') {
    throw new Error(
      'Safety check failed. Set CONFIRM_DELETE_TEMPLATES=YES before running.'
    );
  }

  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is missing from .env');
  }

  await mongoose.connect(mongoUri);

  const before = await Template.countDocuments({});
  console.log(`Templates before delete: ${before}`);

  const result = await Template.deleteMany({});
  console.log(`Deleted templates: ${result.deletedCount}`);

  const after = await Template.countDocuments({});
  console.log(`Templates remaining: ${after}`);

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error(error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exit(1);
});
