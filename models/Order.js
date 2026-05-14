const mongoose = require('mongoose');
const mongoosePaginate = require('mongoose-paginate-v2');

const OrderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true, required: true },
    date: { type: Date, default: Date.now },
    time: { type: String, required: true },
    customer: {
        name: { type: String, required: true },
        phone: { type: String, required: true },
        gstin: { 
            type: String, 
            trim: true,
            uppercase: true,
            validate: {
                validator: function(v) {
                    // GSTIN validation regex (basic format check)
                    return !v || /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(v);
                },
                message: props => `${props.value} is not a valid GSTIN!`
            }
        },
        address: {
            houseFloor: String,
            buildingBlock: String,
            landmarkArea: String,
            city: String,
            state: String,
            postalCode: String,
            location: String
        }
    },
    products: [
        {
            name: { type: String, required: true },
            category: { type: String, required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
            productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }
        }
    ],
    subtotal: { type: Number, required: true },
    couponCode: { type: String, default: null },
    discount: { type: Number, default: 0 },
    totalAmount: { type: Number, required: true },
    trackingId: { type: String, default: '' },
    status: { 
        type: String, 
        enum: ['active', 'Processing', 'in_transit', 'completed', 'Cancelled'], 
        default: 'active',
        index: true
    },
    expectedDeliveryDate: { type: Date, required: true },
    paymentMethod: { type: String, enum: ['COD', 'Online'], default: 'Online' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Paid' },
    notes: { type: String, default: '' }
}, { timestamps: true });

OrderSchema.plugin(mongoosePaginate);

module.exports = mongoose.model('Order', OrderSchema);