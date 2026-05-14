const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Product name is required'],
        trim: true,
        maxlength: [100, 'Product name cannot exceed 100 characters']
    },
    price: {
        type: Number,
        required: [true, 'Product price is required'],
        min: [0, 'Price must be at least 0']
    },
    images: [{
        type: String,
        required: [true, 'At least one image is required']
    }],
    category: {
        name: {
            type: String,
            required: [true, 'Category name is required'],
            enum: [
                'Paper Rolls',
                'Label Printer',
                'Mobile Printer',
                'Receipt Printer',
                'Barcode Scanner',
                'Pos Machine'
            ]
        },
        imageUrl: {
            type: String,
            required: [true, 'Category image URL is required']
        }
    },
    description: {
        type: String,
        required: false,
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Product', productSchema);