require('dotenv').config();
const mongoose = require('mongoose');
const templates = require('../data/studio-v2-templates-100.json');
const Template = require('../models/Template');

async function run() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGO_URI or MONGODB_URI is missing');

  await mongoose.connect(mongoUri);

  let inserted = 0;
  let updated = 0;

  for (const item of templates) {
    const result = await Template.updateOne(
      { name: item.name, collection: 'EasyLabel Studio V2' },
      {
        $set: {
          name: item.name,
          mainCategory: item.mainCategory,
          templateCategory: item.templateCategory,
          jsonData: item.jsonData || '',
          accessType: item.accessType,
          requiredPlan: item.requiredPlan,
          featuredOnHome: Boolean(item.featuredOnHome),
          isActive: item.isActive !== false,
          displayOrder: Number(item.displayOrder || 0),
          previewImageUrl: item.previewImageUrl,
          svgImageUrl: item.svgImageUrl,
          sizeWidthMm: Number(item.sizeWidthMm || 0),
          sizeHeightMm: Number(item.sizeHeightMm || 0),
          designFormat: item.designFormat || 'svg',
          previewOnly: Boolean(item.previewOnly),
          collection: 'EasyLabel Studio V2',
          version: 2
        }
      },
      { upsert: true }
    );
    if (result.upsertedCount) inserted++;
    else if (result.modifiedCount) updated++;
  }

  console.log(`Studio V2 complete. Inserted: ${inserted}, Updated: ${updated}`);
  await mongoose.disconnect();
}

run().catch(async error => {
  console.error(error);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
