require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const templates = require(path.join(__dirname, '..', 'data', 'premium-templates-100.json'));
const Template = require(path.join(__dirname, '..', 'models', 'Template'));

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGO_URI or MONGODB_URI is missing from .env');
  }

  await mongoose.connect(mongoUri);

  let inserted = 0;
  let updated = 0;

  for (const item of templates) {
    const result = await Template.updateOne(
      { name: item.name, mainCategory: item.mainCategory },
      {
        $set: {
          name: item.name,
          mainCategory: item.mainCategory,
          templateCategory: item.templateCategory,
          jsonData: item.jsonData,
          accessType: 'premium',
          requiredPlan: 'premium',
          featuredOnHome: Boolean(item.featuredOnHome),
          isActive: true,
          displayOrder: Number(item.displayOrder || 0)
        }
      },
      { upsert: true }
    );

    if (result.upsertedCount) inserted += 1;
    else if (result.modifiedCount) updated += 1;
  }

  console.log(`Premium template seed complete. Inserted: ${inserted}, Updated: ${updated}`);
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
