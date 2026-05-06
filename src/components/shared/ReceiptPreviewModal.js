// src/components/shared/ReceiptPreviewModal.js

import React from 'react';
import { formatCurrency, formatDate } from '../../utils/formatters';

const ReceiptPreviewModal = ({ entry, onClose }) => {
    if (!entry) return null;

    const companyInfo = {
        name: 'YOUR COMPANY NAME',
        address: '123 Gas Lane, City, State',
    };

    const isSale = String(entry.type || '').toLowerCase() === 'sale';
    const amount = Number(entry.amount ?? entry.totalRevenue ?? entry.revenue ?? 0);
    const kgSold = Number(entry.kgSold ?? entry.quantity ?? 0);
    const paymentMethod = entry.transactionType || entry.paymentMethod || 'Cash';

    return (
        // Backdrop
        <div 
            onClick={onClose} 
            className="fixed inset-0 bg-black bg-opacity-50 z-40 flex justify-center items-center"
        >
            {/* Modal Content */}
            <div 
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside the modal
                className="bg-white p-5 rounded-lg shadow-xl w-full max-w-xs font-mono text-sm"
            >
                {/* Header */}
                <div className="text-center border-b pb-4 mb-4 border-dashed">
                    <h3 className="font-bold text-lg">{companyInfo.name}</h3>
                    <p className="text-xs">{companyInfo.address}</p>
                </div>

                {/* Body */}
                <div className="space-y-2">
                    <h4 className="text-center font-bold mb-4">{isSale ? 'SALE RECEIPT' : 'EXPENSE VOUCHER'}</h4>
                    <div className="flex justify-between">
                        <span>Receipt #:</span>
                        <span>{entry.receiptNumber || (entry._id ? entry._id.slice(-8).toUpperCase() : 'N/A')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Date:</span>
                        <span>{new Date(entry.createdAt).toLocaleDateString('en-GB')}</span>
                    </div>
                    <div className="flex justify-between">
                        <span>Time:</span>
                        <span>{new Date(entry.createdAt).toLocaleTimeString('en-US', { hour12: true })}</span>
                    </div>
                    <div className="border-t my-2 border-dashed"></div>

                    {isSale ? (
                        <>
                            <div className="flex justify-between font-bold">
                                <span>Item</span>
                                <span>Amount</span>
                            </div>
                            <div className="border-t my-2 border-dashed"></div>
                            <div className="flex justify-between">
                                <span>LPG Gas ({kgSold.toFixed(2)} kg)</span>
                                <span>{formatCurrency(amount)}</span>
                            </div>
                            <div className="border-t mt-4 border-double border-black"></div>
                            <div className="flex justify-between font-bold text-base">
                                <span>TOTAL:</span>
                                <span>{formatCurrency(amount)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Payment:</span>
                                <span>{paymentMethod}</span>
                            </div>
                        </>
                    ) : (
                        <>
                           <div className="flex justify-between">
                                <span>Category:</span>
                                <span>{entry.category}</span>
                            </div>
                             <div className="flex justify-between">
                                <span>Details:</span>
                                <span>{entry.description}</span>
                            </div>
                            <div className="border-t mt-4 border-double border-black"></div>
                            <div className="flex justify-between font-bold text-base">
                                <span>TOTAL:</span>
                                <span>{formatCurrency(amount)}</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="text-center border-t pt-4 mt-4 border-dashed">
                    <p>Thank you!</p>
                    <button 
                        onClick={onClose} 
                        className="mt-4 bg-gray-600 text-white px-4 py-2 rounded-lg w-full font-sans"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReceiptPreviewModal;