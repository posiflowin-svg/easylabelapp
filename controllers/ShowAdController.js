'use strict';

const mongoose = require('mongoose');
const ShowAd = require('../models/Showad');

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Return all ads. Keep both `response` and `ads` for backward compatibility.
const index = async (req, res) => {
  try {
    const ads = await ShowAd.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json({
      success: true,
      response: ads,
      ads
    });
  } catch (error) {
    console.error('Failed to fetch Show Ads:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch ads.',
      response: [],
      ads: []
    });
  }
};

const show = async (req, res) => {
  try {
    const ShowAdID = req.body.ShowAdID;
    if (!isValidId(ShowAdID)) {
      return res.status(400).json({ success: false, message: 'Valid ShowAdID is required.', response: null });
    }

    const ad = await ShowAd.findById(ShowAdID).lean();
    if (!ad) {
      return res.status(404).json({ success: false, message: 'Ad not found.', response: null });
    }

    return res.status(200).json({ success: true, response: ad, ad });
  } catch (error) {
    console.error('Failed to fetch Show Ad:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch ad.', response: null });
  }
};

const store = async (req, res) => {
  try {
    const imageUrl = String(req.body.image_url || '').trim();
    const targetUrl = String(req.body.target_url || '').trim();

    if (!imageUrl || !targetUrl) {
      return res.status(400).json({
        success: false,
        message: 'Image URL and target URL are required.'
      });
    }

    const ad = await ShowAd.create({ image_url: imageUrl, target_url: targetUrl });
    return res.status(201).json({
      success: true,
      message: 'ShowAd Added Successfully!',
      data: ad
    });
  } catch (error) {
    console.error('Error saving ShowAd:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to save ad.',
      error: error.message
    });
  }
};

const update = async (req, res) => {
  try {
    const ShowAdID = req.body.ShowAdID;
    if (!isValidId(ShowAdID)) {
      return res.status(400).json({ success: false, message: 'Valid ShowAdID is required.' });
    }

    const imageUrl = String(req.body.image_url || '').trim();
    const targetUrl = String(req.body.target_url || '').trim();
    if (!imageUrl || !targetUrl) {
      return res.status(400).json({ success: false, message: 'Image URL and target URL are required.' });
    }

    const ad = await ShowAd.findByIdAndUpdate(
      ShowAdID,
      { $set: { target_url: targetUrl, image_url: imageUrl } },
      { new: true, runValidators: true }
    );

    if (!ad) {
      return res.status(404).json({ success: false, message: 'Ad not found.' });
    }

    return res.status(200).json({
      success: true,
      message: 'ShowAd Updated Successfully!',
      data: ad
    });
  } catch (error) {
    console.error('Failed to update ShowAd:', error);
    return res.status(500).json({ success: false, message: 'Failed to update ad.', error: error.message });
  }
};

const destroy = async (req, res) => {
  try {
    const ShowAdID = req.body.ShowAdID;
    if (!isValidId(ShowAdID)) {
      return res.status(400).json({ success: false, message: 'Valid ShowAdID is required.' });
    }

    const ad = await ShowAd.findByIdAndDelete(ShowAdID);
    if (!ad) {
      return res.status(404).json({ success: false, message: 'Ad not found.' });
    }

    return res.status(200).json({ success: true, message: 'ShowAd Deleted Successfully!' });
  } catch (error) {
    console.error('Failed to delete ShowAd:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete ad.', error: error.message });
  }
};

module.exports = { index, show, store, update, destroy };
