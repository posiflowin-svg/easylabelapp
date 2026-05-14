const mongoose = require("mongoose");
const Order = require("../models/Order"); // adjust path
require('dotenv').config();
// 🔗 1. Connect to database
async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGO_URL, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("✅ MongoDB Connected");
    } catch (error) {
        console.error("❌ DB Connection Error:", error);
        process.exit(1);
    }
}

// 🔄 2. Update orders
async function markOldInTransitOrders() {
    try {
        const cutoffDate = new Date("2025-12-01"); // 1st Dec 2025

        const result = await Order.updateMany(
            {
                status: "in_transit",
                expectedDeliveryDate: { $lt: cutoffDate }
            },
            {
                $set: { status: "completed" }
            }
        );

        console.log(`🔄 Orders updated: ${result.modifiedCount}`);
    } catch (error) {
        console.error("❌ Update Error:", error);
    } finally {
        mongoose.connection.close();
        console.log("🔌 MongoDB Connection Closed");
    }
}

// ▶️ Run Script
(async () => {
    await connectDB();
    await markOldInTransitOrders();
})();
