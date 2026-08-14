const mongoose = require('mongoose');

const accountDeletionRequestSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    name: {
        type: String,
        default: ''
    },
    email: {
        type: String,
        default: '',
        trim: true,
        lowercase: true,
        index: true
    },
    phone: {
        type: String,
        default: '',
        index: true
    },
    reason: {
        type: String,
        default: '',
        maxlength: 1000
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'rejected', 'cancelled'],
        default: 'pending',
        index: true
    },
    requestedAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    completedAt: {
        type: Date,
        default: null
    },
    adminNotes: {
        type: String,
        default: '',
        maxlength: 2000
    }
}, { timestamps: true });

// Only one active deletion request per user at a time.
accountDeletionRequestSchema.index(
    { userId: 1, status: 1 },
    { partialFilterExpression: { status: { $in: ['pending', 'processing'] } } }
);

module.exports = mongoose.models.AccountDeletionRequest ||
    mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);
