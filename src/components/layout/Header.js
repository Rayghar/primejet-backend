import React from 'react';
import { Bell, Search } from 'lucide-react';

export default function Header({ activeView, user }) {
    return (
        <header className="h-16 px-8 flex items-center justify-between border-b border-white/5 bg-[#0f172a]/50 backdrop-blur-md sticky top-0 z-20">
            <div className="flex items-center">
                <h2 className="text-xl font-semibold text-white tracking-tight">
                    {activeView.replace(/([A-Z])/g, ' $1').trim()}
                </h2>
            </div>

            <div className="flex items-center space-x-6">
                <div className="relative hidden md:block">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
                    <input 
                        type="text" 
                        placeholder="Search global..." 
                        className="bg-white/5 border border-white/10 rounded-full pl-10 pr-4 py-1.5 text-sm text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none w-64 transition-all"
                    />
                </div>
                
                <button className="relative text-gray-400 hover:text-white transition-colors">
                    <Bell size={20} />
                    <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>
                
                <div className="flex items-center space-x-3 pl-6 border-l border-white/10">
                    <div className="text-right hidden sm:block">
                        <p className="text-sm font-medium text-white">{user?.name}</p>
                        <p className="text-xs text-gray-500">{user?.role}</p>
                    </div>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold border border-white/20">
                        {user?.name?.[0]}
                    </div>
                </div>
            </div>
        </header>
    );
}