import React from 'react';

export default function SplashScreen() {
    const logoUrl = '/splash.png'; 
    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse"></div>
            <div className="relative z-10 flex flex-col items-center">
                <div className="w-28 h-28 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative mb-8">
                    <div className="absolute inset-0 bg-cyan-500/20 blur-2xl opacity-50 rounded-[2.5rem]"></div>
                    <img 
                        src={logoUrl} 
                        alt="Logo" 
                        className="w-28 h-28 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" 
                        onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} 
                    />
                </div>
                <h1 className="text-4xl font-black tracking-[0.2em] text-white text-center mb-2">VALO<span className="text-cyan-400"></span></h1>
                <p className="text-gray-400 tracking-[0em] text-[18px] font-bold animate-pulse">Experience</p>
                <div className="mt-12 w-48 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 w-1/2 animate-loading-slide"></div></div>
            </div>
        </div>
    );
}