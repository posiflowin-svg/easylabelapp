const ThemeColor = require('../models/ThemeColor');

// Get all themes
exports.getAllThemes = async (req, res) => {
  try {
    const themes = await ThemeColor.find();
    res.json(themes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get single theme
exports.getTheme = async (req, res) => {
  try {
    const theme = await ThemeColor.findById(req.params.id);
    if (!theme) return res.status(404).json({ message: 'Theme not found' });
    res.json(theme);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create new theme
exports.createTheme = async (req, res) => {
  const { themeName, primaryColor, secondaryColor, textColor, iconTint } = req.body;
  
  try {
    const newTheme = new ThemeColor({
      themeName,
      primaryColor,
      secondaryColor,
      textColor,
      iconTint
    });
    
    const savedTheme = await newTheme.save();
    res.status(201).json(savedTheme);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Update theme
exports.updateTheme = async (req, res) => {
  try {
    const updatedTheme = await ThemeColor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedTheme) return res.status(404).json({ message: 'Theme not found' });
    res.json(updatedTheme);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// Delete theme
exports.deleteTheme = async (req, res) => {
  try {
    const deletedTheme = await ThemeColor.findByIdAndDelete(req.params.id);
    if (!deletedTheme) return res.status(404).json({ message: 'Theme not found' });
    res.json({ message: 'Theme deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};