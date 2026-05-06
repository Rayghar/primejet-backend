// src/views/04-DataEntry/SalesLogForm.js
import React, { useState, useEffect } from 'react';
import { logSale } from '../../api/dataEntryService'; // Import the new backend service for logging sales
import { generateRawBtReceipt, createRawBtLink } from '../../utils/rawbt'; // Utilities for thermal printer receipts
import Button from '../../components/shared/Button';
import { Send } from 'lucide-react'; // Icon for the submit button

export default function SalesLogForm({ user, plants, onSuccess, onError }) {
    // Initial state for the sales form, ensuring all necessary fields are present.
    // 'plants' prop is expected to be an array of plant/branch objects, used for the dropdown.
    const initialState = {
        kgSold: '', // Kilograms of LPG sold
        revenue: '', // Total revenue from the sale
        paymentMethod: 'Cash', // Default payment method
        branchId: plants[0]?.id || '', // Sets the default branch to the first available plant's ID
        date: new Date().toISOString().split('T')[0] // Sets the default date to today in 'YYYY-MM-DD' format
    };

    const [formData, setFormData] = useState(initialState);
    const [isSubmitting, setIsSubmitting] = useState(false); // State to manage submission loading status

    // useEffect to dynamically set the default branchId once the 'plants' data is loaded.
    // This ensures the dropdown has a default selection if 'plants' is initially empty.
    useEffect(() => {
        if (plants && plants.length > 0 && !formData.branchId) {
            setFormData(prev => ({ ...prev, branchId: plants[0].id }));
        }
    }, [plants, formData.branchId]); // Reruns if 'plants' or 'formData.branchId' changes

    /**
     * Handles changes to form input fields. Updates the formData state.
     * @param {Object} e - The event object from the input change.
     */
    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    /**
     * Handles the form submission. Logs the sale to the backend and attempts to print a receipt.
     * @param {Object} e - The event object from the form submission.
     */
    const handleSubmit = async (e) => {
        e.preventDefault(); // Prevents the default form submission behavior (page reload)
        setIsSubmitting(true); // Set submitting state to true

        // Basic client-side validation to ensure required fields are filled.
        if (!formData.kgSold || !formData.revenue || !formData.branchId || !formData.date) {
            onError('Please fill in all required fields.'); // Display an error notification
            setIsSubmitting(false); // Reset submitting state
            return; // Stop the function execution
        }

        try {
            // Call the 'logSale' function from the new dataEntryService.
            // This sends the sales data to your Node.js backend.
            // The backend is responsible for processing the sale, deducting inventory,
            // and saving the transaction to the database.
            await logSale({
                ...formData,
                kgSold: parseFloat(formData.kgSold), // Ensure kgSold is a number
                revenue: parseFloat(formData.revenue), // Ensure revenue is a number
                submittedBy: user.email, // Pass the current user's email for logging/audit purposes
                // The backend will handle linking this sale to a daily summary if applicable
            });

            onSuccess('Sale logged successfully!'); // Display a success notification

            // --- Receipt Generation and Printing Logic (for RawBT thermal printers) ---
            // This part of the code remains client-side as it interacts with a local printer app.

            // Prepare data for the RawBT receipt.
            // In a real production scenario, 'companyInfo' might be fetched from a backend config endpoint.
            const receiptData = {
                ...formData,
                revenue: parseFloat(formData.revenue), // Ensure revenue is formatted correctly
                cashierEmail: user.email, // Use the logged-in user's email as the cashier
                receiptNumber: `SALE-${Date.now()}`, // Generate a simple, unique receipt number
            };

            // Placeholder for company information. In a real app, this would come from a config API.
            const companyInfo = {
                name: 'PrimeJet Gas LLC',
                address: '123 Gas Street, Lagos, Nigeria',
                phone: '+234 800 123 4567',
                website: 'www.primejetgas.com',
            };

            // Generate the RawBT receipt string using the utility function.
            const receiptText = generateRawBtReceipt(receiptData, companyInfo);
            // Create a RawBT link (URI scheme) to trigger the external printer app.
            const rawBtLink = createRawBtLink(receiptText);
            
            // Attempt to open the RawBT app. This will only work if the app is installed and configured.
            // '_system' target is typically used in Cordova/Capacitor, for web it might open a new tab
            // or trigger a browser prompt depending on browser security and OS settings.
            window.open(rawBtLink, '_system'); 

            // Reset the form to its initial state after successful submission and receipt attempt.
            setFormData(initialState);

        } catch (error) {
            // Log the full error to the console for debugging.
            console.error("Sales Log Error:", error);
            // Display a user-friendly error message from the backend or a generic one.
            onError(error.response?.data?.message || 'Failed to submit sales log. Please try again.');
        } finally {
            setIsSubmitting(false); // Always reset submitting state when the process finishes
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            {/* Date Input */}
            <div>
                <label htmlFor="sale-date" className="block text-sm font-medium text-gray-700">Date</label>
                <input
                    type="date"
                    id="sale-date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    className="mt-1 w-full p-2 border rounded-md"
                    required
                />
            </div>

            {/* Branch Selection */}
            <div>
                <label htmlFor="sale-branch" className="block text-sm font-medium text-gray-700">Branch</label>
                <select
                    id="sale-branch"
                    name="branchId"
                    value={formData.branchId}
                    onChange={handleChange}
                    className="mt-1 w-full p-2 border rounded-md bg-white"
                    required
                >
                    {/* Conditionally render options based on 'plants' data availability */}
                    {plants.length > 0 ? (
                        plants.map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                    ) : (
                        <option value="">Loading branches...</option> // Placeholder if plants are not yet loaded
                    )}
                </select>
            </div>

            {/* KG Sold Input */}
            <div>
                <label htmlFor="sale-kg-sold" className="block text-sm font-medium">KG Sold</label>
                <input
                    type="number"
                    id="sale-kg-sold"
                    name="kgSold"
                    value={formData.kgSold}
                    onChange={handleChange}
                    className="mt-1 w-full p-2 border rounded-md"
                    required
                />
            </div>

            {/* Total Revenue Input */}
            <div>
                <label htmlFor="sale-revenue" className="block text-sm font-medium">Total Revenue (₦)</label>
                <input
                    type="number"
                    id="sale-revenue"
                    name="revenue"
                    value={formData.revenue}
                    onChange={handleChange}
                    className="mt-1 w-full p-2 border rounded-md"
                    required
                />
            </div>

            {/* Payment Method Selection */}
            <div>
                <label htmlFor="sale-payment-method" className="block text-sm font-medium">Payment Method</label>
                <select
                    id="sale-payment-method"
                    name="paymentMethod"
                    value={formData.paymentMethod}
                    onChange={handleChange}
                    className="mt-1 w-full p-2 border rounded-md bg-white"
                >
                    <option>Cash</option>
                    <option>POS</option>
                    <option>Transfer</option>
                </select>
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isSubmitting} icon={Send}>
                    {isSubmitting ? 'Submitting...' : 'Log & Print Receipt'}
                </Button>
            </div>
        </form>
    );
}