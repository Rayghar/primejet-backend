// src/api/v2/customers/customer.controller.js
const User = require('../../../models/user.model');
const Order = require('../../../models/order.model');
const CustomerNote = require('../../../models/customerNote.model');
const HttpError = require('../../../utils/HttpError');
const { logger } = require('../../../config/logger.config');
const mongoose = require('mongoose');

// Get all users with role 'customer'
const getCustomers = async (req, res, next) => {
    try {
        const customers = await User.find({ role: 'customer' }).select('-password');
        res.status(200).json(customers);
    } catch (error) {
        logger.error('Error fetching customers:', error);
        next(new HttpError(500, 'Failed to fetch customers.'));
    }
};

// Add a new customer (assuming a simplified creation via User model)
const addCustomer = async (req, res, next) => {
    try {
        const { name, phone, email, type } = req.body;
        const newCustomer = new User({
            id: new mongoose.Types.ObjectId().toString(),
            name,
            phone,
            email: email ? email.toLowerCase() : undefined,
            role: 'customer',
            status: 'active',
        });
        await newCustomer.save();
        res.status(201).json({ message: 'Customer added successfully.', customer: newCustomer.toObject() });
    } catch (error) {
        logger.error('Error adding customer:', error);
        next(new HttpError(500, error.message || 'Failed to add customer.'));
    }
};

// Get detailed information for a single customer, including aggregated data
const getCustomerDetails = async (req, res, next) => {
    try {
        const { customerId } = req.params;
        const customer = await User.findOne({ id: customerId, role: 'customer' }).select('-password');
        if (!customer) {
            throw new HttpError(404, 'Customer not found.');
        }

        // Aggregate total orders and total spent
        const orderStats = await Order.aggregate([
            { $match: { customerId: customer.id, paymentStatus: 'Completed', status: 'Delivered' } },
            { $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalSpent: { $sum: '$grandTotal' },
                lastOrderDate: { $max: '$orderDate' }
            }}
        ]);

        const totalOrders = orderStats[0]?.totalOrders || 0;
        const totalSpent = orderStats[0]?.totalSpent || 0;
        const lastOrderDate = orderStats[0]?.lastOrderDate || null;

        // Fetch recent orders (e.g., last 5)
        const recentOrders = await Order.find({ customerId: customer.id })
            .sort({ orderDate: -1 })
            .limit(5)
            .select('id orderDate status grandTotal');

        // Fetch default address
        let defaultAddress = null;
        if (customer.defaultAddressId) {
            const Address = require('../../../models/address.model');
            defaultAddress = await Address.findOne({ id: customer.defaultAddressId });
        }

        res.status(200).json({
            ...customer.toObject(),
            totalOrders,
            totalSpent,
            lastOrderDate,
            recentOrders: recentOrders.map(order => order.toObject()),
            defaultAddress: defaultAddress ? defaultAddress.toObject() : null,
        });

    } catch (error) {
        logger.error(`Error fetching customer details for ${req.params.customerId}:`, error);
        next(new HttpError(500, 'Failed to fetch customer details.'));
    }
};

// Get customer's orders (separate endpoint for order history tab)
const getCustomerOrders = async (req, res, next) => {
    try {
        const { customerId } = req.params;
        const orders = await Order.find({ customerId, paymentStatus: 'Completed', status: 'Delivered' })
            .sort({ orderDate: -1 })
            .limit(10); // Limit for recent orders
        res.status(200).json(orders.map(order => order.toObject()));
    } catch (error) {
        logger.error(`Error fetching orders for customer ${req.params.customerId}:`, error);
        next(new HttpError(500, 'Failed to fetch customer orders.'));
    }
};

// Add a note to a customer
const addCustomerNote = async (req, res, next) => {
    try {
        const { customerId } = req.params;
        const { text, authorEmail } = req.body;
        const newNote = new CustomerNote({
            id: new mongoose.Types.ObjectId().toString(),
            customerId,
            text,
            authorEmail: authorEmail || req.user.email,
            createdAt: new Date(),
        });
        await newNote.save();
        res.status(201).json({ message: 'Note added successfully.', note: newNote.toObject() });
    } catch (error) {
        logger.error('Error adding customer note:', error);
        next(new HttpError(500, error.message || 'Failed to add note.'));
    }
};

// Get customer's notes
const getCustomerNotes = async (req, res, next) => {
    try {
        const { customerId } = req.params;
        const notes = await CustomerNote.find({ customerId }).sort({ createdAt: -1 });
        res.status(200).json(notes.map(note => note.toObject()));
    } catch (error) {
        logger.error(`Error fetching notes for customer ${req.params.customerId}:`, error);
        next(new HttpError(500, 'Failed to fetch customer notes.'));
    }
};

module.exports = {
    getCustomers,
    addCustomer,
    getCustomerDetails,
    getCustomerOrders,
    addCustomerNote,
    getCustomerNotes,
};