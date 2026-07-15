const Banner = require('../models/Banner');

function boolValue(value, fallback = false) {
    if (value === undefined || value === null || value === '') return fallback;
    return value === true || value === 'true' || value === '1' || value === 'on';
}

function publicBaseUrl(req) {
    const configured = String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '');
    return configured || `${req.protocol}://${req.get('host')}`;
}

function publicBanner(banner, req) {
    const base = publicBaseUrl(req);
    const hasStoredImage = Boolean(banner.imageContentType);
    const url = hasStoredImage
        ? `${base}/api/shopping/banners/${banner._id}/image`
        : banner.link;

    return {
        _id: banner._id,
        id: banner._id,
        title: banner.title || '',
        type: banner.type || 'image',
        url,
        link: url,
        active: Boolean(banner.isActive),
        isActive: Boolean(banner.isActive),
        position: Number(banner.position || 1),
        clickType: banner.clickType || 'shop',
        clickUrl: banner.clickUrl || '',
        startDate: banner.startDate,
        endDate: banner.endDate
    };
}

function buildUpdate(req) {
    const update = {
        title: String(req.body.title || '').trim(),
        type: req.file ? 'image' : (req.body.type || 'image'),
        link: String(req.body.link || '').trim(),
        position: Math.min(3, Math.max(1, Number(req.body.position || 1))),
        isActive: boolValue(req.body.isActive, true),
        clickType: ['shop', 'url', 'none'].includes(req.body.clickType) ? req.body.clickType : 'shop',
        clickUrl: String(req.body.clickUrl || '').trim(),
        startDate: req.body.startDate ? new Date(req.body.startDate) : null,
        endDate: req.body.endDate ? new Date(req.body.endDate) : null
    };

    if (req.file) {
        update.imageData = req.file.buffer;
        update.imageContentType = req.file.mimetype;
        update.link = '';
        update.type = 'image';
    }
    return update;
}

// Existing JSON endpoint remains supported.
exports.addBanner = async (req, res) => {
    try {
        const update = buildUpdate(req);
        if (!req.file && req.body.link) update.link = req.body.link;
        const banner = await Banner.create(update);
        res.json({ success: true, message: 'Banner added successfully!', banner: publicBanner(banner, req) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.editBanner = async (req, res) => {
    try {
        const id = req.params.id || req.query.id;
        const current = await Banner.findById(id).select('+imageData');
        if (!current) return res.status(404).json({ success: false, message: 'Banner not found' });
        Object.assign(current, buildUpdate(req));
        await current.save();
        res.json({ success: true, message: 'Banner updated successfully!', banner: publicBanner(current, req) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.deleteBanner = async (req, res) => {
    try {
        const id = req.params.id || req.query.id;
        const banner = await Banner.findByIdAndDelete(id);
        if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
        res.json({ success: true, message: 'Banner deleted successfully!' });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

exports.toggleBanner = async (req, res) => {
    try {
        const banner = await Banner.findByIdAndUpdate(
            req.params.id,
            { isActive: boolValue(req.body.isActive) },
            { new: true, runValidators: true }
        );
        if (!banner) return res.status(404).json({ success: false, message: 'Banner not found' });
        res.json({ success: true, banner: publicBanner(banner, req) });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// Android public API: maximum three active banners, ordered 1-3.
exports.getBanners = async (req, res) => {
    try {
        const now = new Date();
        const banners = await Banner.find({
            isActive: true,
            $and: [
                { $or: [{ startDate: null }, { startDate: { $lte: now } }] },
                { $or: [{ endDate: null }, { endDate: { $gte: now } }] }
            ]
        }).sort({ position: 1, createdAt: -1 }).limit(3).lean();
        res.json({ success: true, banners: banners.map(b => publicBanner(b, req)) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message, banners: [] });
    }
};

exports.getBannerImage = async (req, res) => {
    try {
        const banner = await Banner.findById(req.params.id).select('+imageData imageContentType');
        if (!banner || !banner.imageData) return res.status(404).send('Banner image not found');
        res.set('Content-Type', banner.imageContentType || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(banner.imageData);
    } catch (error) {
        res.status(404).send('Banner image not found');
    }
};
