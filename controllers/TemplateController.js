const Template = require('../models/Template');

const SUPPORTED_SIZES = new Set([
    '38x38', '38x25', '38x15',
    '50x25', '50x30', '50x50', '50x12',
    '75x25', '75x50',
    '100x50', '100x150', '100x15'
]);

const normalizeAccessType = value => {
    const normalized = String(value || 'free').trim().toLowerCase();
    return ['free', 'premium', 'business'].includes(normalized)
        ? normalized
        : 'free';
};

const booleanValue = (value, defaultValue = false) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
};

const integerValue = (value, defaultValue = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
};

const numberValue = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeExportedJson = value => {
    let parsed;

    try {
        parsed = typeof value === 'string' ? JSON.parse(value) : value;
    } catch (error) {
        const validationError = new Error('Exported label JSON is invalid.');
        validationError.statusCode = 400;
        throw validationError;
    }

    if (!parsed || parsed.dataFormat !== 'EPL') {
        const validationError = new Error(
            'Only EasyLabel EPL export files are supported.'
        );
        validationError.statusCode = 400;
        throw validationError;
    }

    if (!parsed.dataBase64 || typeof parsed.dataBase64 !== 'string') {
        const validationError = new Error(
            'Export file does not contain dataBase64.'
        );
        validationError.statusCode = 400;
        throw validationError;
    }

    return JSON.stringify(parsed);
};

const validateSize = (width, height) => {
    const key = `${width}x${height}`;
    if (!SUPPORTED_SIZES.has(key)) {
        const error = new Error(`Unsupported label size: ${key} mm.`);
        error.statusCode = 400;
        throw error;
    }
};

const buildPublicFilter = query => {
    const filter = { isActive: { $ne: false } };

    if (query.mainCategory) {
        filter.mainCategory = query.mainCategory;
    }

    if (query.templateCategory) {
        filter.templateCategory = query.templateCategory;
    }

    if (query.accessType) {
        const requested = String(query.accessType).toLowerCase();
        filter.accessType = requested === 'paid'
            ? { $in: ['premium', 'business'] }
            : normalizeAccessType(requested);
    }

    if (query.featuredOnHome !== undefined) {
        filter.featuredOnHome = booleanValue(query.featuredOnHome);
    }

    if (query.labelWidthMm) {
        filter.labelWidthMm = numberValue(query.labelWidthMm);
    }

    if (query.labelHeightMm) {
        filter.labelHeightMm = numberValue(query.labelHeightMm);
    }

    return filter;
};

const listTemplates = filter =>
    Template.find(filter)
        .sort({
            displayOrder: 1,
            mainCategory: 1,
            templateCategory: 1,
            createdAt: -1
        })
        .lean();

const payload = body => {
    const accessType = normalizeAccessType(body.accessType);
    const labelWidthMm = numberValue(body.labelWidthMm);
    const labelHeightMm = numberValue(body.labelHeightMm);

    validateSize(labelWidthMm, labelHeightMm);

    return {
        name: String(body.name || '').trim(),
        mainCategory: String(body.mainCategory || '').trim(),
        templateCategory: String(body.templateCategory || '').trim(),
        jsonData: normalizeExportedJson(body.jsonData),
        labelWidthMm,
        labelHeightMm,
        accessType,
        requiredPlan: accessType,
        featuredOnHome: booleanValue(body.featuredOnHome),
        isActive: booleanValue(body.isActive, true),
        displayOrder: integerValue(body.displayOrder)
    };
};

const index = async (req, res) => {
    try {
        const templates = await listTemplates(buildPublicFilter(req.query));
        res.json({ success: true, data: templates });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Unable to fetch templates.',
            error: error.message
        });
    }
};

const getFree = async (req, res) => {
    try {
        const filter = buildPublicFilter({
            ...req.query,
            accessType: 'free'
        });
        res.json({ success: true, data: await listTemplates(filter) });
    } catch (error) {
        res.status(500).json({
            success: false,
            data: [],
            message: error.message
        });
    }
};

const getPremium = async (req, res) => {
    try {
        const filter = buildPublicFilter(req.query);
        filter.accessType = { $in: ['premium', 'business'] };

        if (req.query.featuredOnHome === undefined) {
            filter.featuredOnHome = true;
        }

        res.json({ success: true, data: await listTemplates(filter) });
    } catch (error) {
        res.status(500).json({
            success: false,
            data: [],
            message: error.message
        });
    }
};

const getByMainCategory = async (req, res) => {
    if (!req.query.mainCategory) {
        return res.status(400).json({
            success: false,
            message: 'Main category is required.'
        });
    }

    try {
        res.json({
            success: true,
            data: await listTemplates(buildPublicFilter(req.query))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const getByTemplateCategory = async (req, res) => {
    if (!req.query.templateCategory) {
        return res.status(400).json({
            success: false,
            message: 'Template category is required.'
        });
    }

    try {
        res.json({
            success: true,
            data: await listTemplates(buildPublicFilter(req.query))
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

const category = async (req, res) => {
    try {
        const active = { isActive: { $ne: false } };

        res.json({
            success: true,
            mainCategories: await Template.distinct('mainCategory', active),
            templateCategories: await Template.distinct(
                'templateCategory',
                active
            )
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Unable to fetch categories.'
        });
    }
};

const show = async (req, res) => {
    if (!req.body.templateID) {
        return res.status(400).json({
            success: false,
            message: 'templateID is required.'
        });
    }

    try {
        const template = await Template.findById(req.body.templateID);

        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found.'
            });
        }

        res.json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Unable to fetch template.'
        });
    }
};

const store = async (req, res) => {
    try {
        const data = payload(req.body);

        if (
            !data.name ||
            !data.mainCategory ||
            !data.templateCategory
        ) {
            return res.status(400).json({
                success: false,
                message: 'Name and both categories are required.'
            });
        }

        const template = await Template.create(data);

        res.status(201).json({
            success: true,
            message: 'Template uploaded successfully.',
            data: template
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Unable to save template.'
        });
    }
};

const update = async (req, res) => {
    if (!req.body.templateID) {
        return res.status(400).json({
            success: false,
            message: 'templateID is required.'
        });
    }

    try {
        const data = payload(req.body);

        const template = await Template.findByIdAndUpdate(
            req.body.templateID,
            data,
            { new: true, runValidators: true }
        );

        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found.'
            });
        }

        res.json({
            success: true,
            message: 'Template updated successfully.',
            data: template
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Unable to update template.'
        });
    }
};

const destroy = async (req, res) => {
    if (!req.body.templateID) {
        return res.status(400).json({
            success: false,
            message: 'templateID is required.'
        });
    }

    try {
        const template = await Template.findByIdAndDelete(
            req.body.templateID
        );

        if (!template) {
            return res.status(404).json({
                success: false,
                message: 'Template not found.'
            });
        }

        res.json({
            success: true,
            message: 'Template deleted successfully.'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Unable to delete template.'
        });
    }
};

const destroyAll = async (req, res) => {
    if (req.body.confirmation !== 'DELETE ALL TEMPLATES') {
        return res.status(400).json({
            success: false,
            message: 'Confirmation text does not match.'
        });
    }

    try {
        const result = await Template.deleteMany({});

        res.json({
            success: true,
            message: `${result.deletedCount} templates deleted.`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Unable to delete all templates.'
        });
    }
};

module.exports = {
    index,
    getFree,
    getPremium,
    show,
    getByMainCategory,
    store,
    update,
    destroy,
    destroyAll,
    category,
    getByTemplateCategory
};
