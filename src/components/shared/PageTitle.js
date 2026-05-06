// =======================================================================
// src/components/shared/PageTitle.js (NEW)
// A component for consistent page titles.
// =======================================================================
import React from 'react';

export default function PageTitle({ title, subtitle }) {
    return (
        <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
            {subtitle && <p className="text-md text-gray-500 mt-1">{subtitle}</p>}
        </div>
    );
}
