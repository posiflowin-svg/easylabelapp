const Template = require('../models/Template');

// Show all templates
const index = async (req, res) => {
    try {
        const templates = await Template.find();
        res.status(200).json({
            success: true,
            data: templates,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'An error occurred while fetching templates.',
        });
    }
};

// Get templates by main category
const getByMainCategory = async (req, res) => {
    try {
        const { mainCategory } = req.query;

        if (!mainCategory) {
            return res.status(400).json({
                success: false,
                message: "Main category is required."
            });
        }

        const templates = await Template.find({ mainCategory });

        if (templates.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No templates found for this main category."
            });
        }

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

// Get templates by template category
const getByTemplateCategory = async (req, res) => {
    try {
        const { templateCategory } = req.query;

        if (!templateCategory) {
            return res.status(400).json({
                success: false,
                message: "Template category is required."
            });
        }

        const templates = await Template.find({ templateCategory });

        if (templates.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No templates found for this template category."
            });
        }

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

const category = async (req, res) => {
    try {
        // Fetch distinct values for mainCategory and templateCategory
        const mainCategories = await Template.distinct('mainCategory');
        const templateCategories = await Template.distinct('templateCategory');

        res.json({
            success: true,
            mainCategories,
            templateCategories
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
}
// Show a single template
const show = async (req, res) => {
    const { templateID } = req.body;
    if (!templateID) {
        return res.status(400).json({ success: false, message: 'templateID is required.' });
    }

    try {
        const template = await Template.findById(templateID);
        if (!template) {
            return res.status(404).json({ success: false, message: 'Template not found.' });
        }
        res.status(200).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'An error occurred while fetching the template.' });
    }
};

// Add new template
const store = async (req, res) => {
    const { name, mainCategory, templateCategory, jsonData } = req.body;

    if (!name || !mainCategory || !templateCategory || !jsonData) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        const newTemplate = new Template({ name, mainCategory, templateCategory, jsonData });
        await newTemplate.save();

        res.status(201).json({ 
            success: true, 
            message: 'Template added successfully.', 
            data: newTemplate 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'An error occurred while adding the template.', error: error.message });
    }
};

// Update existing template
const update = async (req, res) => {
    const { templateID, name, mainCategory, templateCategory, jsonData } = req.body;

    if (!templateID || !name || !mainCategory || !templateCategory || !jsonData) {
        return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    try {
        const updatedTemplate = await Template.findByIdAndUpdate(
            templateID,
            { name, mainCategory, templateCategory, jsonData },
            { new: true } // Returns the updated document
        );

        if (!updatedTemplate) {
            return res.status(404).json({ success: false, message: 'Template not found.' });
        }

        res.status(200).json({ 
            success: true, 
            message: 'Template updated successfully.', 
            data: updatedTemplate 
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'An error occurred while updating the template.', error: error.message });
    }
};


// Delete template
const destroy = async (req, res) => {
    const { templateID } = req.body;

    if (!templateID) {
        return res.status(400).json({ success: false, message: 'templateID is required.' });
    }

    try {
        const deletedTemplate = await Template.findByIdAndDelete(templateID);
        if (!deletedTemplate) {
            return res.status(404).json({ success: false, message: 'Template not found.' });
        }
        res.status(200).json({ success: true, message: 'Template deleted successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'An error occurred while deleting the template.' });
    }
};

module.exports = { index, show, getByMainCategory, store, update, destroy, category, getByTemplateCategory };
