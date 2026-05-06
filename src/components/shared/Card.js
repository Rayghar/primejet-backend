import React from 'react';

export default function Card({ children, className = '', noPadding = false }) {
    return (
        <div className={`glass rounded-2xl border border-white/5 ${noPadding ? '' : 'p-6'} ${className}`}>
            {children}
        </div>
    );
}