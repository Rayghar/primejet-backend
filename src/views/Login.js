import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { LogIn, ShieldCheck, Activity } from 'lucide-react';

export default function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            console.log("🚀 [Login] Submitting credentials...");
            await login(email, password);
            console.log("✅ [Login] Success! Redirecting via State Update...");
            
            // NOTE: We do NOT reload the page here. 
            // The AuthContext update will automatically trigger App.js to render the Dashboard.
            // Adding reload() here causes the socket connection to break/flicker.
            
        } catch (err) {
            console.error("❌ [Login] Failed:", err);
            const msg = err.response?.data?.message || err.message || 'Authorization Failed';
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen p-4 relative overflow-hidden">
            {/* Background Decoration */}
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] pointer-events-none"></div>
            <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 rounded-full blur-[120px] pointer-events-none"></div>

            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-10">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-xl border border-white/10 shadow-2xl mb-6 ring-1 ring-white/20">
                        <Activity className="text-blue-400 w-10 h-10" />
                    </div>
                    <h1 className="text-4xl font-bold text-white tracking-tight">PrimeJet<span className="text-blue-500">.OS</span></h1>
                    <p className="text-blue-200/60 mt-2 text-sm uppercase tracking-widest font-medium">Operations Command</p>
                </div>

                <div className="glass p-8 rounded-3xl shadow-2xl border border-white/10">
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-xs font-semibold text-blue-300 uppercase tracking-wider mb-2 ml-1">Identity</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="glass-input w-full p-4 outline-none"
                                placeholder="admin@primejet.com"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-blue-300 uppercase tracking-wider mb-2 ml-1">Secure Key</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="glass-input w-full p-4 outline-none"
                                placeholder="••••••••••••"
                                required
                            />
                        </div>
                        
                        {error && (
                            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm text-center flex items-center justify-center">
                                <ShieldCheck size={16} className="mr-2" /> {error}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            disabled={loading} 
                            className="w-full glass-button py-4 mt-4 text-lg shadow-blue-900/50"
                        >
                            {loading ? 'Verifying Access...' : 'Authenticate'}
                        </button>
                    </form>
                </div>
                
                <p className="text-center text-white/20 text-xs mt-8 font-mono">
                    System Version 2.0.4 • Encrypted Connection
                </p>
            </div>
        </div>
    );
}