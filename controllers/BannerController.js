const Banner   = require('../models/Banner')
// Banner Controller
const addBanner = async (req, res) => {
    try {
        const { type, link, isActive } = req.body;
        const banner = new Banner({ type, link, isActive });
        await banner.save();
        res.json({ message: 'Banner added successfully!', banner });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

const editBanner = async (req, res) => {
    try {
        const { id } = req.query;
        const { type, link, isActive } = req.body;
        const banner = await Banner.findByIdAndUpdate(id, { type, link, isActive }, { new: true });
        if (!banner) return res.status(404).json({ message: 'Banner not found' });
        res.json({ message: 'Banner updated successfully!', banner });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

const deleteBanner = async (req, res) => {
    try {
        const { id } = req.query;
        const banner = await Banner.findByIdAndDelete(id);
        if (!banner) return res.status(404).json({ message: 'Banner not found' });
        res.json({ message: 'Banner deleted successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};

const getBanners = async (req, res) => {
    try {
        const banners = await Banner.find();
        res.json({ banners });
    } catch (error) {
        res.status(500).json({ message: 'An error occurred!', error: error.message });
    }
};
module.exports = {
    addBanner, editBanner, deleteBanner, getBanners
}