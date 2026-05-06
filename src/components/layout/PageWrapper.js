import React from 'react';

export default function PageWrapper({ children }) {
    return (
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-6 md:p-8 relative">
            <div className="max-w-7xl mx-auto space-y-6">
                {children}
            </div>
        </main>
    );
}