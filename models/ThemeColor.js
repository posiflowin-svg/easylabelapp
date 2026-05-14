const mongoose = require('mongoose');

const themeColorSchema = new mongoose.Schema({
  themeName: {
    type: String,
    required: true,
    unique: true
  },
  primaryColor: {
    type: String,
    required: true,
    default: "#FF6200EE"
  },
  secondaryColor: {
    type: String,
    required: true,
    default: "#FF6200EE"
  },
  textColor: {
    type: String,
    required: true,
    default: "#FFFFFFFF"
  },
  iconTint: {
    type: String,
    required: true,
    default: "#FFFFFFFF"
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ThemeColor', themeColorSchema);