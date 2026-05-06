// =======================================================================
// src/components/shared/Notification.js (NEW)
// A component for displaying app-wide notifications.
// =======================================================================
import React, { useEffect } from 'react';
import { CheckCircle, AlertCircle, X } from 'lucide-react';

export default function Notification({ notification, setNotification }) {
    useEffect(() => {
        if (notification.show) {
            const timer = setTimeout(() => setNotification({ show: false, message: '', type: 'success' }), 4000);
            return () => clearTimeout(timer);
        }
    }, [notification, setNotification]);

    if (!notification.show) return null;

    const typeClasses = { success: "bg-green-500", error: "bg-red-500" };
    const Icon = notification.type === 'success' ? CheckCircle : AlertCircle;

    return (
        <div className={`fixed top-5 right-5 z-50 flex items-center p-4 rounded-lg shadow-lg text-white ${typeClasses[notification.type]}`}>
            <Icon size={20} className="mr-3" />
            <p>{notification.message}</p>
            <button onClick={() => setNotification({ show: false })} className="ml-4 p-1 rounded-full hover:bg-white hover:bg-opacity-20"><X size={18} /></button>
        </div>
    );
};