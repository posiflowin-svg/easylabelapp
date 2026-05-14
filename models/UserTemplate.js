const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const userTemplateSchema = new Schema({
    userIdentifier: {
        type: String,
        required: true,
        index: true
    },
    identifierType: {
        type: String,
        enum: ['email', 'phone'],
        required: true
    },
    name: {
        type: String,
        required: true
    },
    mainCategory: {
        type: String,
        required: true
    },
    templateCategory: {
        type: String,
        required: true
    },
    templateDevice: {
        type: String,
        default: 'Unknown'
    },
    templateSource: {
        type: String,
        default: 'LocalTemplates'
    },
    templateUser: {
        type: String,
        default: 'AllUser'
    },
    jsonData: {
        type: String,
        required: true
    },
    localId: {
        type: String, // For tracking local template ID if needed
        index: true
    },
    checksum: {
        type: String, // For detecting changes
        index: true
    },
    lastModified: {
        type: Date,
        default: Date.now
    },
    isActive: {
        type: Boolean,
        default: true
    },
    syncStatus: {
        type: String,
        enum: ['synced', 'pending', 'conflict'],
        default: 'synced'
    }
}, { timestamps: true });

// Compound index for unique template per user
userTemplateSchema.index({ 
    userIdentifier: 1, 
    identifierType: 1, 
    name: 1, 
    mainCategory: 1,
    templateCategory: 1
}, { unique: true });

// Index for efficient querying
userTemplateSchema.index({ userIdentifier: 1, identifierType: 1 });
userTemplateSchema.index({ userIdentifier: 1, mainCategory: 1 });
userTemplateSchema.index({ userIdentifier: 1, templateCategory: 1 });
userTemplateSchema.index({ userIdentifier: 1, lastModified: -1 });

// Pre-save middleware to update lastModified and generate checksum
userTemplateSchema.pre('save', function(next) {
    this.lastModified = new Date();
    
    // Generate simple checksum from jsonData for change detection
    if (this.jsonData) {
        let checksum = 0;
        for (let i = 0; i < this.jsonData.length; i++) {
            checksum = ((checksum << 5) - checksum) + this.jsonData.charCodeAt(i);
            checksum = checksum & checksum; // Convert to 32-bit integer
        }
        this.checksum = checksum.toString(16);
    }
    
    next();
});

const UserTemplate = mongoose.model('UserTemplate', userTemplateSchema);
module.exports = UserTemplate;