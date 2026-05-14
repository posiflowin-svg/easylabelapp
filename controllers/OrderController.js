const Order = require('../models/Order');
// const { sendOrderStatusEmail } = require('../services/emailService');
const ExcelJS = require('exceljs');

// Generate Order ID with prefix and timestamp
const generateOrderId = () => {
    const prefix = 'ORD';
    const timestamp = Date.now().toString();
    const random = Math.floor(100 + Math.random() * 900); // 3-digit random
    return `${prefix}${timestamp.slice(-6)}${random}`;
};

const getCurrentTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
};

// 1. Create Order (Enhanced with validation)
const createOrder = async (req, res) => {
    try {
        const { customer, products, couponCode, expectedDeliveryDate, paymentMethod } = req.body;

        // Validate required fields
        if (!customer || !customer.name || !customer.phone || !products || products.length === 0) {
            return res.status(400).json({ 
                success: false,
                message: 'Customer name, phone, and at least one product are required' 
            });
        }

        // Calculate order totals
        const subtotal = products.reduce((sum, product) => sum + (product.price * product.quantity), 0);
        const totalAmount = subtotal - (req.body.discount || 0);

        const order = new Order({
            orderId: generateOrderId(),
            date: new Date(),
            time: getCurrentTime(),
            customer,
            products,
            subtotal,
            couponCode,
            discount: req.body.discount || 0,
            totalAmount,
            expectedDeliveryDate: new Date(expectedDeliveryDate),
            paymentMethod: paymentMethod || 'COD'
        });

        await order.save();
        
        // Send confirmation email (async)
        // sendOrderStatusEmail(order.customer.email, order.orderId, 'created', order.status);

        res.status(201).json({ 
            success: true,
            message: 'Order created successfully',
            order 
        });
    } catch (error) {
        console.error('Order creation error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Error creating order',
            error: error.message 
        });
    }
};

// 2. Get All Orders (with pagination, filtering, and sorting)
const getOrders = async (req, res) => {
    try {
        const { page = 1, limit = 10, status, sortBy = '-createdAt', search } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } },
                { 'customer.phone': { $regex: search, $options: 'i' } },
                { 'customer.name': { $regex: search, $options: 'i' } }
            ];
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: sortBy,
            lean: true
        };

        const orders = await Order.paginate(query, options);

        res.json({
            success: true,
            message: 'Orders retrieved successfully',
            data: orders
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching orders',
            error: error.message
        });
    }
};

// 3. Filter Orders with Advanced Querying
const filterOrders = async (req, res) => {
    try {
        const { 
            status, 
            startDate, 
            endDate, 
            minAmount, 
            maxAmount,
            paymentMethod,
            page = 1,
            limit = 10
        } = req.query;

        const query = {};
        
        if (status) query.status = status;
        if (paymentMethod) query.paymentMethod = paymentMethod;
        
        // Date range filter
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }
        
        // Amount range filter
        if (minAmount || maxAmount) {
            query.totalAmount = {};
            if (minAmount) query.totalAmount.$gte = parseFloat(minAmount);
            if (maxAmount) query.totalAmount.$lte = parseFloat(maxAmount);
        }

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: '-date',
            lean: true
        };

        const result = await Order.paginate(query, options);

        res.json({
            success: true,
            message: 'Orders filtered successfully',
            data: result
        });
    } catch (error) {
        console.error('Error filtering orders:', error);
        res.status(500).json({
            success: false,
            message: 'Error filtering orders',
            error: error.message
        });
    }
};

// 4. Get Order Statistics
const getOrderStats = async (req, res) => {
    try {
        const stats = await Order.aggregate([
            {
                $group: {
                    _id: null,
                    totalOrders: { $sum: 1 },
                    totalRevenue: { $sum: "$totalAmount" },
                    pendingOrders: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
                    processingOrders: { $sum: { $cond: [{ $eq: ["$status", "Processing"] }, 1, 0] } },
                    shippedOrders: { $sum: { $cond: [{ $eq: ["$status", "Shipped"] }, 1, 0] } },
                    deliveredOrders: { $sum: { $cond: [{ $eq: ["$status", "Delivered"] }, 1, 0] } }
                }
            },
            {
                $project: {
                    _id: 0,
                    totalOrders: 1,
                    totalRevenue: 1,
                    statusCounts: {
                        pending: "$pendingOrders",
                        processing: "$processingOrders",
                        shipped: "$shippedOrders",
                        delivered: "$deliveredOrders"
                    }
                }
            }
        ]);

        // Get daily sales for last 7 days
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const dailySales = await Order.aggregate([
            {
                $match: {
                    date: { $gte: sevenDaysAgo },
                    status: { $in: ["Delivered", "Shipped"] }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$date" } },
                    total: { $sum: "$totalAmount" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            success: true,
            message: 'Order statistics retrieved',
            data: {
                summary: stats[0] || {},
                dailySales
            }
        });
    } catch (error) {
        console.error('Error getting order stats:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting order statistics',
            error: error.message
        });
    }
};

// 5. Update Order Status (Enhanced with validation)
const updateOrderStatus = async (req, res) => {
    // Debug: Log the complete incoming request
    console.log('Incoming request:', {
        method: req.method,
        url: req.originalUrl,
        params: req.params,
        query: req.query,
        body: req.body,
        headers: {
            'content-type': req.headers['content-type'],
            authorization: req.headers.authorization ? 'present' : 'missing'
        }
    });

    try {
        // Get orderId from both params and query for compatibility
        const orderId = req.params.orderId || req.query.id;
        
        if (!orderId) {
            console.error('Missing orderId');
            return res.status(400).json({
                success: false,
                message: 'Order ID is required',
                received: {
                    params: req.params,
                    query: req.query
                }
            });
        }

        const { status, trackingId, notes } = req.body;

        if (!status) {
            console.error('Missing status for order:', orderId);
            return res.status(400).json({
                success: false,
                message: 'Status is required',
                receivedBody: req.body
            });
        }

        // Debug: Log the received data
        console.log('Processing update for order:', orderId, 'with data:', {
            status,
            trackingId,
            notes
        });

        const validStatuses = ['active', 'Processing', 'in_transit', 'completed', 'Cancelled'];
        if (!validStatuses.includes(status)) {
            console.error('Invalid status:', status, 'for order:', orderId);
            return res.status(400).json({
                success: false,
                message: 'Invalid status value',
                validStatuses,
                receivedStatus: status
            });
        }

        // Build update object
        const updateData = { 
            status,
            updatedAt: new Date()
        };

        // Explicitly handle notes - update even if empty string
        if (notes !== undefined) {
            updateData.notes = notes;
        }

        if (trackingId !== undefined) {
            updateData.trackingId = trackingId;
        }

        // Debug: Log the final update data
        console.log('Final update data for order', orderId, ':', updateData);

        // Perform the update with additional options
        const updateOptions = {
            new: true,
            runValidators: true,
            context: 'query', // Needed for some validations
            setDefaultsOnInsert: true
        };

        const order = await Order.findOneAndUpdate(
            { orderId: orderId },
            updateData,
            updateOptions
        ).lean();

        if (!order) {
            console.error('Order not found:', orderId);
            return res.status(404).json({
                success: false,
                message: 'Order not found',
                searchedOrderId: orderId
            });
        }

        // Debug: Verify the updated document
        const verifiedUpdate = await Order.findOne({ orderId: orderId }).lean();
        console.log('Verified updated order:', verifiedUpdate);

        return res.json({
            success: true,
            message: 'Order updated successfully',
            order: verifiedUpdate // Return the verified document
        });

    } catch (error) {
        console.error('Update failed:', {
            error: error.message,
            stack: error.stack,
            fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });

        // Handle specific MongoDB errors
        if (error.name === 'ValidationError') {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors
            });
        }

        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid data format',
                error: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message,
            errorType: error.name
        });
    }
};
// 6. Update Tracking Information
const updateTracking = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { trackingId, carrier } = req.body;

        if (!orderId || !trackingId) {
            return res.status(400).json({
                success: false,
                message: 'Order ID and tracking ID are required'
            });
        }

        const order = await Order.findOneAndUpdate(
            { orderId, status: { $in: ['Processing', 'Shipped'] } },
            { 
                trackingId,
                $set: { status: 'Shipped' },
                $push: { 
                    trackingHistory: {
                        date: new Date(),
                        status: 'Shipped',
                        trackingId,
                        carrier: carrier || 'Standard'
                    }
                }
            },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found or not eligible for tracking update'
            });
        }

        res.json({
            success: true,
            message: 'Tracking information updated',
            order
        });
    } catch (error) {
        console.error('Error updating tracking:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating tracking information',
            error: error.message
        });
    }
};

// 7. Export Orders to Excel
const exportOrders = async (req, res) => {
    try {
        const { startDate, endDate, status } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const orders = await Order.find(query).sort({ date: -1 });

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Orders');

        // Add headers
        worksheet.columns = [
            { header: 'Order ID', key: 'orderId', width: 15 },
            { header: 'Date', key: 'date', width: 15 },
            { header: 'Customer', key: 'customer', width: 25 },
            { header: 'Phone', key: 'phone', width: 15 },
            { header: 'Products', key: 'products', width: 40 },
            { header: 'Total Amount', key: 'total', width: 15 },
            { header: 'Status', key: 'status', width: 15 },
            { header: 'Payment', key: 'payment', width: 15 }
        ];

        // Add data rows
        orders.forEach(order => {
            worksheet.addRow({
                orderId: order.orderId,
                date: order.date.toISOString().split('T')[0],
                customer: order.customer.name,
                phone: order.customer.phone,
                products: order.products.map(p => `${p.name} (${p.quantity})`).join(', '),
                total: order.totalAmount,
                status: order.status,
                payment: order.paymentMethod
            });
        });

        // Set response headers
        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
            'Content-Disposition',
            'attachment; filename=orders_export.xlsx'
        );

        // Send the workbook
        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error('Error exporting orders:', error);
        res.status(500).json({
            success: false,
            message: 'Error exporting orders',
            error: error.message
        });
    }
};

// 8. Get Order by ID (Enhanced)
const getOrderById = async (req, res) => {
    try {
        const { id } = req.query;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Order ID is required'
            });
        }

        const order = await Order.findOne({ orderId: id })
            .populate('products.productId', 'name images');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.json({
            success: true,
            message: 'Order retrieved successfully',
            order
        });
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching order',
            error: error.message
        });
    }
};

// 9. Get Orders by Phone (Enhanced)
const getOrdersByPhone = async (req, res) => {
    try {
        const { phone } = req.query;

        if (!phone) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        const orders = await Order.find({ 'customer.phone': phone })
            .sort({ date: -1 })
            .limit(10);

        res.json({
            success: true,
            message: orders.length > 0 
                ? 'Orders retrieved successfully' 
                : 'No orders found for this phone number',
            orders
        });
    } catch (error) {
        console.error('Error fetching orders by phone:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching orders',
            error: error.message
        });
    }
};

// **4. Update Order Status**
const updateOrder = async (req, res) => {
    try {
        const { id } = req.query;
        const { status, trackingId } = req.body;

        const order = await Order.findOneAndUpdate({ orderId: id }, { status, trackingId }, { new: true });

        if (!order) return res.status(404).json({ message: 'Order not found' });

        res.json({ message: 'Order status updated successfully!', order });
    } catch (error) {
        res.status(500).json({ message: 'Error updating order', error: error.message });
    }
};

// **5. Delete Order**
const deleteOrder = async (req, res) => {
    try {
        const { id } = req.query;

        const order = await Order.findOneAndDelete({ orderId: id });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        res.json({ message: 'Order deleted successfully!' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting order', error: error.message });
    }
};

module.exports = {
    createOrder,
    getOrders,
    filterOrders,
    getOrderStats,
    updateOrderStatus,
    updateTracking,
    exportOrders,
    getOrderById,
    getOrdersByPhone,
    deleteOrder,
    updateOrder
};