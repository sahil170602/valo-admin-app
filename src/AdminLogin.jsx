import React, { useState } from 'react';

export default function AdminLogin({ onLogin }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState(false);
    const logoUrl = '/splash.png';

    const handleSubmit = (e) => {
        e.preventDefault();
        const currentPin = localStorage.getItem('valo_admin_pin') || '1234';
        if (pin === currentPin) {
            localStorage.setItem('valo_admin_auth', 'true');
            onLogin();
        } else {
            setError(true); setPin("");
            setTimeout(() => setError(false), 500);
        }
    };

    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-4">
            <div className={`w-full max-w-sm bg-slate-800 border border-white/10 p-10 rounded-[3rem] shadow-2xl text-center transition-all ${error ? 'animate-shake border-red-500' : ''}`}>
                <div className="w-28 h-28 bg-white/5 rounded-3xl mx-auto flex items-center justify-center mb-8 shadow-xl border border-white/5 relative">
                     <img 
                       src={logoUrl} 
                       alt="Logo" 
                       className="w-28 h-28 object-contain" 
                       onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} 
                     />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1 uppercase tracking-tight">Access Locked</h2>
                <p className="text-gray-500 text-xs mb-8 uppercase font-bold tracking-widest text-[10px]">Security Protocols Active</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" placeholder="••••" maxLength="4" autoFocus className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-5 text-center text-white text-3xl tracking-[0.5em] focus:outline-none focus:border-cyan-500 transition-all" />
                    <button type="submit" className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-black py-4 rounded-2xl hover:opacity-90 transition-all shadow-lg active:scale-95 text-md tracking-wide">Verify PIN</button>
                </form>
            </div>
        </div>
    );
}