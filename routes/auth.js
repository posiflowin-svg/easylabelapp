const express = require('express')
const r̥outer  = express.Router()
const User   = require('../models/User')
const AuthController = require('../controllers/AuthController')

r̥outer.post('/register', AuthController.register)
r̥outer.put('/update-status', AuthController.updateUserStatus);
r̥outer.get('/referred-users', AuthController.getReferredUsers);
r̥outer.post('/login', AuthController.login)
r̥outer.post('/quickLogin', AuthController.quickLogin)
r̥outer.get("/users", async (req, res) => {
    const { from, to } = req.query;
  
    try {
      let query = {};
  
      if (from && to) {
        query.createdAt = { $gte: new Date(from), $lte: new Date(to) };
      }
  
      const users = await User.find(query).select("name email phone createdAt");
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error); // Log the error to the console
      res.status(500).json({ message: "Error fetching users", error: error.message });
    }
});
  
module.exports = r̥outer