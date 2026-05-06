import React from 'react';

export default function Button({ 
    children, onClick, variant = 'primary', 
    disabled = false, icon: Icon, className = '', type = 'button' 
}) {
    const baseStyle = "flex items-center justify-center px-4 py-2.5 rounded-xl font-medium transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";
    
    const variants = {
        primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20",
        secondary: "bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10",
        danger: "bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20",
        ghost: "hover:bg-white/5 text-gray-400 hover:text-white"
    };

    return (
        <button 
            type={type} 
            onClick={onClick} 
            disabled={disabled} 
            className={`${baseStyle} ${variants[variant]} ${className}`}
        >
            {Icon && <Icon size={18} className="mr-2" />}
            {children}
        </button>
    );
}