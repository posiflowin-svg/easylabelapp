const UserTemplate = require('../models/UserTemplate');
const User = require('../models/User');
const crypto = require('crypto');

// Helper function to generate checksum
const generateChecksum = (data) => {
    return crypto.createHash('md5').update(data).digest('hex');
};

// Get all templates for a user with optional filtering
const index = async (req, res) => {
    try {
        const { userIdentifier, identifierType = 'email', category, device, source } = req.query;

        if (!userIdentifier) {
            return res.status(400).json({
                success: false,
                message: "User identifier (email/phone) is required."
            });
        }

        // Build query
        const query = { 
            userIdentifier,
            identifierType,
            isActive: true 
        };

        if (category) query.mainCategory = category;
        if (device) query.templateDevice = device;
        if (source) query.templateSource = source;

        const templates = await UserTemplate.find(query).sort({ name: 1 });

        res.status(200).json({
            success: true,
            data: templates,
            count: templates.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while fetching user templates.',
            error: error.message
        });
    }
};

// Create or Update template (Upsert functionality)
const store = async (req, res) => {
    const { 
        userIdentifier, 
        identifierType = 'email', 
        name, 
        mainCategory, 
        templateCategory, 
        templateDevice = 'Unknown',
        templateSource = 'LocalTemplates',
        templateUser = 'AllUser',
        jsonData,
        localId,
        forceUpdate = false
    } = req.body;

    if (!userIdentifier || !name || !mainCategory || !templateCategory || !jsonData) {
        return res.status(400).json({ 
            success: false, 
            message: 'userIdentifier, name, mainCategory, templateCategory, and jsonData are required.' 
        });
    }

    try {
        // Verify user exists
        const user = await User.findOne({
            $or: [
                { email: userIdentifier },
                { phone: userIdentifier }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const checksum = generateChecksum(jsonData);

        // Check if template with same name and category exists
        const existingTemplate = await UserTemplate.findOne({
            userIdentifier,
            identifierType,
            name,
            mainCategory,
            templateCategory,
            isActive: true
        });

        let result;
        let message;

        if (existingTemplate) {
            if (forceUpdate || existingTemplate.checksum !== checksum) {
                // Update existing template
                result = await UserTemplate.findOneAndUpdate(
                    { 
                        userIdentifier,
                        identifierType,
                        name,
                        mainCategory,
                        templateCategory
                    },
                    { 
                        templateDevice,
                        templateSource,
                        templateUser,
                        jsonData,
                        localId,
                        checksum,
                        syncStatus: 'synced',
                        lastModified: new Date()
                    },
                    { new: true, runValidators: true }
                );
                message = 'Template updated successfully.';
            } else {
                // No changes detected
                result = existingTemplate;
                message = 'Template already exists with same content.';
            }
        } else {
            // Create new template
            result = new UserTemplate({ 
                userIdentifier, 
                identifierType, 
                name, 
                mainCategory, 
                templateCategory,
                templateDevice,
                templateSource,
                templateUser,
                jsonData,
                localId,
                checksum
            });
            await result.save();
            message = 'Template created successfully.';
        }

        res.status(200).json({ 
            success: true, 
            message,
            data: result 
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Template with same name and category already exists.'
            });
        }
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while saving the template.', 
            error: error.message 
        });
    }
};

// Bulk upload/update templates
const bulkUpload = async (req, res) => {
    const { 
        userIdentifier, 
        identifierType = 'email',
        templates = [],
        syncStrategy = 'upsert' // 'upsert', 'replace', 'merge'
    } = req.body;

    if (!userIdentifier || !Array.isArray(templates)) {
        return res.status(400).json({
            success: false,
            message: 'userIdentifier and templates array are required.'
        });
    }

    try {
        // Verify user exists
        const user = await User.findOne({
            $or: [
                { email: userIdentifier },
                { phone: userIdentifier }
            ]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found."
            });
        }

        const results = {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [],
            details: []
        };

        // Process each template
        for (const template of templates) {
            try {
                const {
                    name,
                    mainCategory,
                    templateCategory,
                    templateDevice = 'Unknown',
                    templateSource = 'LocalTemplates',
                    templateUser = 'AllUser',
                    jsonData,
                    localId
                } = template;

                if (!name || !mainCategory || !templateCategory || !jsonData) {
                    results.errors.push(`Invalid template data: ${name || 'Unknown'}`);
                    continue;
                }

                const checksum = generateChecksum(jsonData);

                // Find existing template
                const existingTemplate = await UserTemplate.findOne({
                    userIdentifier,
                    identifierType,
                    name,
                    mainCategory,
                    templateCategory,
                    isActive: true
                });

                let operation;
                let savedTemplate;

                if (existingTemplate) {
                    if (existingTemplate.checksum !== checksum) {
                        // Update existing
                        savedTemplate = await UserTemplate.findOneAndUpdate(
                            { 
                                userIdentifier,
                                identifierType,
                                name,
                                mainCategory,
                                templateCategory
                            },
                            { 
                                templateDevice,
                                templateSource,
                                templateUser,
                                jsonData,
                                localId,
                                checksum,
                                syncStatus: 'synced',
                                lastModified: new Date()
                            },
                            { new: true, runValidators: true }
                        );
                        operation = 'updated';
                        results.updated++;
                    } else {
                        // No changes
                        operation = 'skipped';
                        results.skipped++;
                        savedTemplate = existingTemplate;
                    }
                } else {
                    // Create new
                    savedTemplate = new UserTemplate({
                        userIdentifier,
                        identifierType,
                        name,
                        mainCategory,
                        templateCategory,
                        templateDevice,
                        templateSource,
                        templateUser,
                        jsonData,
                        localId,
                        checksum
                    });
                    await savedTemplate.save();
                    operation = 'created';
                    results.created++;
                }

                results.details.push({
                    name,
                    mainCategory,
                    templateCategory,
                    operation,
                    templateId: savedTemplate._id
                });

            } catch (error) {
                results.errors.push(`Error processing ${template.name}: ${error.message}`);
            }
        }

        res.status(200).json({
            success: true,
            message: `Bulk upload completed. Created: ${results.created}, Updated: ${results.updated}, Skipped: ${results.skipped}`,
            data: results
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred during bulk upload.',
            error: error.message
        });
    }
};

// Sync templates - compares local and cloud versions
const syncTemplates = async (req, res) => {
    const { 
        userIdentifier, 
        identifierType = 'email',
        localTemplates = [] // Array of local templates with checksums
    } = req.body;

    if (!userIdentifier) {
        return res.status(400).json({
            success: false,
            message: 'User identifier is required.'
        });
    }

    try {
        // Get all cloud templates for user
        const cloudTemplates = await UserTemplate.find({
            userIdentifier,
            identifierType,
            isActive: true
        });

        const syncResult = {
            toUpload: [], // Local templates not in cloud or newer
            toDownload: [], // Cloud templates not in local or newer
            conflicts: [], // Templates with conflicts
            inSync: [] // Templates that are identical
        };

        const localMap = new Map();
        localTemplates.forEach(template => {
            const key = `${template.name}|${template.mainCategory}|${template.templateCategory}`;
            localMap.set(key, template);
        });

        const cloudMap = new Map();
        cloudTemplates.forEach(template => {
            const key = `${template.name}|${template.mainCategory}|${template.templateCategory}`;
            cloudMap.set(key, template);
        });

        // Compare templates
        for (const [key, localTemplate] of localMap) {
            const cloudTemplate = cloudMap.get(key);

            if (!cloudTemplate) {
                // Template exists only locally - needs upload
                syncResult.toUpload.push(localTemplate);
            } else {
                const localChecksum = generateChecksum(localTemplate.jsonData);
                if (localChecksum !== cloudTemplate.checksum) {
                    // Conflict - both versions have changes
                    syncResult.conflicts.push({
                        name: localTemplate.name,
                        mainCategory: localTemplate.mainCategory,
                        templateCategory: localTemplate.templateCategory,
                        local: localTemplate,
                        cloud: cloudTemplate
                    });
                } else {
                    // In sync
                    syncResult.inSync.push(localTemplate);
                }
            }
        }

        // Find cloud templates not in local
        for (const [key, cloudTemplate] of cloudMap) {
            if (!localMap.has(key)) {
                // Template exists only in cloud - needs download
                syncResult.toDownload.push(cloudTemplate);
            }
        }

        res.status(200).json({
            success: true,
            data: syncResult
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred during template sync.',
            error: error.message
        });
    }
};

// Get template by name and category
const getByName = async (req, res) => {
    const { 
        userIdentifier, 
        identifierType = 'email',
        name,
        mainCategory,
        templateCategory
    } = req.query;

    if (!userIdentifier || !name || !mainCategory || !templateCategory) {
        return res.status(400).json({
            success: false,
            message: 'userIdentifier, name, mainCategory, and templateCategory are required.'
        });
    }

    try {
        const template = await UserTemplate.findOne({
            userIdentifier,
            identifierType,
            name,
            mainCategory,
            templateCategory,
            isActive: true
        });

        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found.'
            });
        }

        res.status(200).json({
            success: true,
            data: template
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while fetching the template.',
            error: error.message
        });
    }
};

// Export user templates (for backup)
const exportTemplates = async (req, res) => {
    const { userIdentifier, identifierType = 'email' } = req.query;

    if (!userIdentifier) {
        return res.status(400).json({
            success: false,
            message: "User identifier is required."
        });
    }

    try {
        const templates = await UserTemplate.find({ 
            userIdentifier,
            identifierType,
            isActive: true 
        }).select('-__v -_id -checksum -syncStatus');

        // Create a backup package
        const backupData = {
            exportDate: new Date().toISOString(),
            userIdentifier,
            identifierType,
            templateCount: templates.length,
            templates: templates
        };

        res.status(200).json({
            success: true,
            data: backupData,
            message: `Exported ${templates.length} templates successfully.`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while exporting templates.',
            error: error.message
        });
    }
};

// Get user templates by main category
const getByMainCategory = async (req, res) => {
    try {
        const { userIdentifier, identifierType = 'email', mainCategory } = req.query;

        if (!userIdentifier || !mainCategory) {
            return res.status(400).json({
                success: false,
                message: "User identifier and main category are required."
            });
        }

        const templates = await UserTemplate.find({ 
            userIdentifier,
            identifierType,
            mainCategory,
            isActive: true 
        });

        res.status(200).json({
            success: true,
            data: templates
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching templates.",
            error: error.message
        });
    }
};

// Get user templates by template category
const getByTemplateCategory = async (req, res) => {
    try {
        const { userIdentifier, identifierType = 'email', templateCategory } = req.query;

        if (!userIdentifier || !templateCategory) {
            return res.status(400).json({
                success: false,
                message: "User identifier and template category are required."
            });
        }

        const templates = await UserTemplate.find({ 
            userIdentifier,
            identifierType,
            templateCategory,
            isActive: true 
        });

        res.status(200).json({
            success: true,
            data: templates
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: "An error occurred while fetching templates.",
            error: error.message
        });
    }
};

// Get categories for a user
const categories = async (req, res) => {
    try {
        const { userIdentifier, identifierType = 'email' } = req.query;

        if (!userIdentifier) {
            return res.status(400).json({
                success: false,
                message: "User identifier is required."
            });
        }

        const mainCategories = await UserTemplate.distinct('mainCategory', { 
            userIdentifier,
            identifierType,
            isActive: true 
        });
        
        const templateCategories = await UserTemplate.distinct('templateCategory', { 
            userIdentifier,
            identifierType,
            isActive: true 
        });

        res.json({
            success: true,
            mainCategories,
            templateCategories
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error',
            error: error.message 
        });
    }
};

// Get single user template
const show = async (req, res) => {
    const { templateID, userIdentifier, identifierType = 'email' } = req.body;
    
    if (!templateID || !userIdentifier) {
        return res.status(400).json({ 
            success: false, 
            message: 'templateID and userIdentifier are required.' 
        });
    }

    try {
        const template = await UserTemplate.findOne({ 
            _id: templateID,
            userIdentifier,
            identifierType,
            isActive: true 
        });
        
        if (!template) {
            return res.status(404).json({ 
                success: false, 
                message: 'Template not found.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            data: template 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while fetching the template.',
            error: error.message
        });
    }
};

// Update user template
const update = async (req, res) => {
    const { 
        templateID, 
        userIdentifier, 
        identifierType = 'email',
        name, 
        mainCategory, 
        templateCategory, 
        jsonData 
    } = req.body;

    if (!templateID || !userIdentifier || !name || !mainCategory || !jsonData) {
        return res.status(400).json({ 
            success: false, 
            message: 'All fields are required.' 
        });
    }

    try {
        const updatedTemplate = await UserTemplate.findOneAndUpdate(
            { 
                _id: templateID,
                userIdentifier,
                identifierType 
            },
            { name, mainCategory, templateCategory, jsonData },
            { new: true, runValidators: true }
        );

        if (!updatedTemplate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Template not found or you do not have permission to update it.' 
            });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Template updated successfully.', 
            data: updatedTemplate 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while updating the template.', 
            error: error.message 
        });
    }
};

// Delete user template (soft delete)
const destroy = async (req, res) => {
    const { templateID, userIdentifier, identifierType = 'email' } = req.body;

    if (!templateID || !userIdentifier) {
        return res.status(400).json({ 
            success: false, 
            message: 'templateID and userIdentifier are required.' 
        });
    }

    try {
        const deletedTemplate = await UserTemplate.findOneAndUpdate(
            { 
                _id: templateID,
                userIdentifier,
                identifierType 
            },
            { isActive: false },
            { new: true }
        );
        
        if (!deletedTemplate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Template not found or you do not have permission to delete it.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Template deleted successfully.' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while deleting the template.',
            error: error.message
        });
    }
};

// Hard delete user template (optional - use with caution)
const hardDelete = async (req, res) => {
    const { templateID, userIdentifier, identifierType = 'email' } = req.body;

    if (!templateID || !userIdentifier) {
        return res.status(400).json({ 
            success: false, 
            message: 'templateID and userIdentifier are required.' 
        });
    }

    try {
        const deletedTemplate = await UserTemplate.findOneAndDelete({ 
            _id: templateID,
            userIdentifier,
            identifierType 
        });
        
        if (!deletedTemplate) {
            return res.status(404).json({ 
                success: false, 
                message: 'Template not found or you do not have permission to delete it.' 
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Template permanently deleted successfully.' 
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            message: 'An error occurred while deleting the template.',
            error: error.message
        });
    }
};

module.exports = { 
    index, 
    show, 
    getByName,
    getByMainCategory, 
    store, 
    update, 
    destroy, 
    categories, 
    getByTemplateCategory,
    bulkUpload,
    syncTemplates,
    exportTemplates
};