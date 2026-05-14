const express = require('express');
const router = express.Router();
const OrderController = require('../controllers/OrderController');
const Order = require('../models/Order');

// Public routes
router.post('/create', OrderController.createOrder);
router.get('/getById', OrderController.getOrderById);
router.get('/getOrdersByPhone', OrderController.getOrdersByPhone);

// Admin protected routes
router.get('/all', OrderController.getOrders);
router.get('/filter', OrderController.filterOrders);
router.get('/stats', OrderController.getOrderStats);
router.put('/update-status/:orderId', OrderController.updateOrderStatus);
router.put('/update-tracking', OrderController.updateTracking);
router.put('/:id', OrderController.updateOrder);
router.delete('/delete', OrderController.deleteOrder);
router.get('/export', OrderController.exportOrders);

// Update order status and add payment ID to notes
router.put('/update-order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, paymentId } = req.body;

        // Validate required fields
        if (!orderId || !status || !paymentId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID, status, and payment ID are required'
            });
        }

        // Find the order first to get existing notes
        const order = await Order.findOne({ orderId });
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        // Prepare the update
        const updateData = {
            status,
            updatedAt: new Date()
        };

        // Create a timestamp for the payment note
        const paymentNote = `[${new Date().toISOString()}] Payment processed. ${paymentId}`;
        
        // Append to existing notes or create new notes
        updateData.notes = order.notes 
            ? `${order.notes}\n${paymentNote}`
            : paymentNote;

        // Perform the update
        const updatedOrder = await Order.findOneAndUpdate(
            { orderId },
            updateData,
            { new: true, runValidators: true }
        );

        res.json({
            success: true,
            message: 'Order updated successfully',
            order: updatedOrder
        });

    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
});

module.exports = router;