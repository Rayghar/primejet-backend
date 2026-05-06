// src/views/04-DataEntry/ExpenseLogForm.js

import React, { useState, useEffect } from 'react';
import { logExpense } from '../../api/dataEntryService'; // Import the new service function
import { EXPENSE_CATEGORIES } from '../../utils/constants'; // Assuming constants are available
import Button from '../../components/shared/Button';
import { PlusCircle } from 'lucide-react';

export default function ExpenseLogForm({ user, plants, onSuccess, onError }) {
    // Initial state for the expense form.
    const initialState = {
        description: '',
        amount: '',
        category: EXPENSE_CATEGORIES[0], // Default to the first category
        branchId: plants[0]?.id || '', // Set initial branch if plants are available
        date: new Date().toISOString().split('T')[0] // Default to today's date
    };

    const [formData, setFormData] = useState(initialState);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Effect to set the default branchId once plants data is loaded
    useEffect(() => {
        if (plants && plants.length > 0 && !formData.branchId) {
            setFormData(prev => ({ ...prev, branchId: plants[0].id }));
        }
    }, [plants, formData.branchId]);

    // Handles changes to form input fields.
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Handles the form submission, logging the expense.
    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);

        if (!formData.description || !formData.amount || !formData.category || !formData.branchId || !formData.date) {
            onError('Please fill in all required fields.');
            setIsSubmitting(false);
            return;
        }

        try {
            // Send the expense data to the backend using the new dataEntryService
            await logExpense({
                ...formData,
                amount: parseFloat(formData.amount),
                submittedBy: user.email, // Pass the user's email for logging
            });

            onSuccess('Expense logged successfully!');
            setFormData(initialState); // Reset the form after successful submission

        } catch (error) {
            console.error("Expense Log Error:", error);
            onError(error.response?.data?.message || 'Failed to submit expense log. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700">Date</label>
                <input
                    type="date"
                    name="date"
                    value={formData.date}
                    onChange={handleChange}
                    className="mt-1 block w-full p-2 border rounded-md"
                    required
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Branch</label>
                <select
                    name="branchId"
                    value={formData.branchId}
                    onChange={handleChange}
                    className="mt-1 block w-full p-2 border rounded-md bg-white"
                    required
                >
                    {plants.length > 0 ? (
                        plants.map(b => <option key={b.id} value={b.id}>{b.name}</option>)
                    ) : (
                        <option value="">Loading branches...</option>
                    )}
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Category</label>
                <select
                    name="category"
                    value={formData.category}
                    onChange={handleChange}
                    className="mt-1 block w-full p-2 border rounded-md bg-white"
                    required
                >
                    {EXPENSE_CATEGORIES.map(cat => <option key={cat}>{cat}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Description</label>
                <input
                    type="text"
                    name="description"
                    value={formData.description}
                    onChange={handleChange}
                    className="mt-1 block w-full p-2 border rounded-md"
                    placeholder="e.g., Generator fuel"
                    required
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Amount (₦)</label>
                <input
                    type="number"
                    name="amount"
                    value={formData.amount}
                    onChange={handleChange}
                    className="mt-1 block w-full p-2 border rounded-md"
                    placeholder="e.g., 50000"
                    required
                />
            </div>
            <div className="flex justify-end pt-2">
                <Button type="submit" disabled={isSubmitting} icon={PlusCircle}>
                    {isSubmitting ? 'Submitting...' : 'Add Expense'}
                </Button>
            </div>
        </form>
    );
}