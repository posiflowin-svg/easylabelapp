require('dotenv').config();
const mongoose = require('mongoose');
const Template = require('../models/Template');

(async () => {
    if (process.env.CONFIRM_DELETE_TEMPLATES !== 'YES') {
        throw new Error(
            'Set CONFIRM_DELETE_TEMPLATES=YES before running.'
        );
    }

    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) throw new Error('MongoDB URI is missing.');

    await mongoose.connect(uri);

    const result = await Template.deleteMany({});
    console.log(`Deleted ${result.deletedCount} templates.`);

    await mongoose.disconnect();
})().catch(async error => {
    console.error(error);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
});
