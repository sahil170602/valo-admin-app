import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import OneSignal from '@onesignal/capacitor-plugin';
import { Filesystem } from '@capacitor/filesystem';
import RoomManagement from './RoomManagement';
import { LocalNotifications } from '@capacitor/local-notifications';

// ============================================================
// VALO NOTIFICATION + PWA CONFIGURATION
// ============================================================
const VALO_ONESIGNAL_APP_ID = '3a997ca5-9d8f-4e81-8943-907b81b9a577';
const VALO_SAFARI_WEB_ID = 'web.onesignal.auto.2b9eaa60-5747-4249-a27c-f48aa9ddca65';
const VALO_ONESIGNAL_WORKER = 'onesignal/OneSignalSDKWorker.js';

// Web OneSignal is ONLY supported on the production HTTPS origin.
// Keeping localhost completely out of the initialization path prevents
// "Can only be used on: https://hotelvalo.web.app" errors during development.
const isValoProductionWeb = () => {
    if (typeof window === 'undefined') return false;
    if (Capacitor.isNativePlatform()) return false;

    const hostname = window.location.hostname;
    const isValoHost =
        hostname === 'hotelvalo.web.app' ||
        hostname === 'hotelvalo.firebaseapp.com';

    return window.location.protocol === 'https:' && isValoHost;
};

// A shared promise prevents React StrictMode / remounts from calling
// OneSignal.init() twice at the same time.
let valoOneSignalWebPromise = null;

const loadOneSignalWebSdk = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return Promise.resolve(null);
    }

    if (!isValoProductionWeb()) {
        return Promise.resolve(null);
    }

    if (window.__VALO_ONESIGNAL_WEB_INSTANCE) {
        return Promise.resolve(window.__VALO_ONESIGNAL_WEB_INSTANCE);
    }

    if (valoOneSignalWebPromise) {
        return valoOneSignalWebPromise;
    }

    valoOneSignalWebPromise = new Promise((resolve, reject) => {
        let settled = false;

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            fn(value);
        };

        window.OneSignalDeferred = window.OneSignalDeferred || [];

        window.OneSignalDeferred.push(async (WebOneSignal) => {
            try {
                // Another part of the app / a previous mount may already have
                // initialized the SDK. In that case simply reuse the instance.
                if (!window.__VALO_ONESIGNAL_WEB_INITIALIZED) {
                    window.__VALO_ONESIGNAL_WEB_INITIALIZING = true;

                    try {
                        await WebOneSignal.init({
                            appId: VALO_ONESIGNAL_APP_ID,
                            safari_web_id: VALO_SAFARI_WEB_ID,
                            serviceWorkerPath: VALO_ONESIGNAL_WORKER,
                            serviceWorkerParam: {
                                scope: '/onesignal/'
                            },
                            notifyButton: {
                                enable: false
                            },
                            welcomeNotification: {
                                disable: true
                            }
                        });
                    } catch (error) {
                        const message = String(error?.message || error || '');

                        // OneSignal throws this when the SDK was initialized
                        // elsewhere. It is safe to reuse the same SDK instance.
                        if (!message.toLowerCase().includes('already initialized')) {
                            throw error;
                        }
                    }

                    window.__VALO_ONESIGNAL_WEB_INITIALIZED = true;
                    window.__VALO_ONESIGNAL_WEB_INITIALIZING = false;
                }

                window.__VALO_ONESIGNAL_WEB_INSTANCE = WebOneSignal;
                finish(resolve, WebOneSignal);
            } catch (error) {
                window.__VALO_ONESIGNAL_WEB_INITIALIZING = false;
                console.warn('VALO Web OneSignal initialization skipped:', error);
                finish(reject, error);
            }
        });

        const existingScript = document.querySelector(
            'script[data-valo-onesignal-sdk], script[src*="OneSignalSDK.page.js"]'
        );

        if (!existingScript) {
            const script = document.createElement('script');
            script.src =
                'https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js';
            script.defer = true;
            script.dataset.valoOnesignalSdk = 'true';

            script.onerror = () => {
                finish(
                    reject,
                    new Error('Could not load OneSignal Web SDK.')
                );
            };

            document.head.appendChild(script);
        }
    });

    return valoOneSignalWebPromise;
};

const ensurePwaHead = () => {
    if (typeof document === 'undefined') return;
    if (!isValoProductionWeb()) return;

    if (!document.querySelector('link[rel="manifest"]')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = '/manifest.webmanifest';
        document.head.appendChild(link);
    }

    if (!document.querySelector('meta[name="theme-color"]')) {
        const meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.content = '#0f172a';
        document.head.appendChild(meta);
    }

    // Modern replacement for the deprecated
    // apple-mobile-web-app-capable meta tag.
    if (!document.querySelector('meta[name="mobile-web-app-capable"]')) {
        const meta = document.createElement('meta');
        meta.name = 'mobile-web-app-capable';
        meta.content = 'yes';
        document.head.appendChild(meta);
    }

    if (!document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')) {
        const meta = document.createElement('meta');
        meta.name = 'apple-mobile-web-app-status-bar-style';
        meta.content = 'black-translucent';
        document.head.appendChild(meta);
    }
};

const registerValoPwaWorker = async () => {
    if (typeof navigator === 'undefined') return null;
    if (!('serviceWorker' in navigator)) return null;
    if (!isValoProductionWeb()) return null;

    try {
        // Firebase/Vite SPA fallback can return index.html for a missing
        // file. A Service Worker must be JavaScript, so verify the response
        // before attempting registration.
        const response = await fetch('/sw.js', {
            method: 'GET',
            cache: 'no-store'
        });

        if (!response.ok) {
            console.warn(
                'VALO PWA: /sw.js is not available:',
                response.status
            );
            return null;
        }

        const contentType =
            response.headers.get('content-type') || '';

        if (
            !contentType.includes('javascript') &&
            !contentType.includes('ecmascript')
        ) {
            console.warn(
                'VALO PWA: /sw.js returned invalid MIME type:',
                contentType
            );
            return null;
        }

        return await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
        });
    } catch (error) {
        console.warn(
            'VALO PWA service worker registration skipped:',
            error
        );
        return null;
    }
};

// --- STRICT DATE FORMATTER (DD/MM/YYYY) ---
const getFormattedDate = (dateObj = new Date()) => {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${d}/${m}/${y}`;
};

const getFormattedTime = (dateObj = new Date()) => {
    return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const getFormattedDateForInput = (dateObj = new Date()) => {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${y}-${m}-${d}`;
};

// --- NORMALIZER (Fixes 1/8/2026 to 01/08/2026 for accurate sorting) ---
const normalizeDateStr = (dStr) => {
    if (!dStr) return null;
    const parts = dStr.split('/');
    if (parts.length === 3) {
        if (parts[0] === '8' || parts[0] === '08') {
            let y = parts[2];
            if (y.length === 2) y = `20${y}`;
            return `${parts[1].padStart(2, '0')}/${parts[0].padStart(2, '0')}/${y}`;
        }
        let y = parts[2];
        if (y.length === 2) y = `20${y}`;
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${y}`;
    }
    return dStr;
};

// --- IMAGE TO BASE64 HELPER ---
const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

// --- CSV EXPORT LOGIC ---
const exportCSV = (data, filename) => {
    if (!data || data.length === 0) {
        alert("No data available to export.");
        return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [];
    csvRows.push(headers.join(','));
    for (const row of data) {
        const values = headers.map(header => {
            const escaped = ('' + (row[header] ?? '')).replace(/"/g, '\\"');
            return `"${escaped}"`;
        });
        csvRows.push(values.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', filename);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
};


const showWebNotification = async (title, body, data = {}) => {
    try {
        if (typeof window === 'undefined' || !('Notification' in window)) return false;
        if (Notification.permission !== 'granted') return false;
        const notification = new Notification(title, {
            body,
            icon: '/logo.png',
            badge: '/logo.png',
            tag: data.tag || 'valo-admin',
            renotify: true,
            data
        });
        notification.onclick = () => { try { window.focus(); notification.close(); } catch (_) {} };
        return true;
    } catch (err) { console.error('Web notification error:', err); return false; }
};

const scheduleNativeLocalNotification = async (title, body, data = {}) => {
    try {
        if (!Capacitor.isNativePlatform()) return false;
        const permission = await LocalNotifications.checkPermissions();
        let display = permission?.display;
        if (display !== 'granted') display = (await LocalNotifications.requestPermissions())?.display;
        if (display !== 'granted') return false;
        const notificationId = Math.floor(Date.now() % 2147480000);
        await LocalNotifications.schedule({
            notifications: [{
                id: notificationId,
                title,
                body,
                schedule: { at: new Date(Date.now() + 250) },
                extra: data
            }]
        });
        return true;
    } catch (err) { console.error('Native local notification error:', err); return false; }
};

const requestValoNotificationPermission = async () => {
    try {
        if (Capacitor.isNativePlatform()) {
            try {
                if (OneSignal?.initialize && !window.__VALO_ONESIGNAL_NATIVE_INITIALIZED) {
                    OneSignal.initialize(VALO_ONESIGNAL_APP_ID);
                    window.__VALO_ONESIGNAL_NATIVE_INITIALIZED = true;
                }
            } catch (e) { console.warn('Native OneSignal initialize warning:', e); }
            const local = await LocalNotifications.requestPermissions();
            let accepted = local?.display === 'granted';
            try { if (OneSignal?.Notifications?.requestPermission) accepted = (await OneSignal.Notifications.requestPermission(true)) || accepted; }
            catch (e) { console.warn('Native OneSignal permission warning:', e); }
            if (accepted) alert('Notifications enabled successfully!');
            else alert('Notification permission was denied.');
            return accepted;
        }
        if (!('Notification' in window)) { alert('This browser does not support notifications.'); return false; }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { alert('Notification permission was denied. Enable notifications for VALO in browser settings.'); return false; }
        try {
            const web = await loadOneSignalWebSdk();
            if (web?.Notifications?.requestPermission) await web.Notifications.requestPermission();
            else if (web?.Slidedown?.promptPush) await web.Slidedown.promptPush();
        } catch (e) { console.warn('OneSignal web subscription warning:', e); }
        alert('Notifications enabled successfully!');
        return true;
    } catch (err) { console.error('VALO notification permission error:', err); alert('Unable to enable notifications. Check notification permission in device/browser settings.'); return false; }
};

const sendRemoteAdminNotification = async (title, body, data = {}) => {
    try {
        const { error } = await supabase.functions.invoke('send-admin-notification', { body: { title, body, data } });
        if (error) console.warn('Remote admin notification skipped:', error.message || error);
    } catch (err) { console.warn('Remote notification function unavailable:', err); }
};

const sendAdminNotification = async (title, body, data = {}) => {
    try {
        if (Capacitor.isNativePlatform()) await scheduleNativeLocalNotification(title, body, data);
        else await showWebNotification(title, body, data);
        await sendRemoteAdminNotification(title, body, data);
    } catch (err) { console.error('Admin notification error:', err); }
};

export default function AdminPanel() {
    const [isLoading, setIsLoading] = useState(true);
    const [operator, setOperator] = useState(() => {
        try { const raw = sessionStorage.getItem('valo_operator'); return raw ? JSON.parse(raw) : null; }
        catch { return null; }
    });
    const [showGate, setShowGate] = useState(() => {
        try { return !sessionStorage.getItem('valo_operator'); }
        catch { return true; }
    });
    const [appMode, setAppMode] = useState(() => localStorage.getItem('valo_app_mode') || 'food');
    const toggleMode = () => {
        const newMode = appMode === 'food' ? 'room' : 'food';
        setAppMode(newMode);
        localStorage.setItem('valo_app_mode', newMode);
    };
    const handleAccess = (operatorInfo) => {
        const normalized = {
            id: operatorInfo?.id ?? null,
            name: String(operatorInfo?.name || 'Admin').trim() || 'Admin',
            role: operatorInfo?.role === 'staff' ? 'staff' : 'admin'
        };
        sessionStorage.setItem('valo_operator', JSON.stringify(normalized));
        setOperator(normalized);
        setShowGate(false);
    };
    const handleSwitchOperator = () => {
        sessionStorage.removeItem('valo_operator');
        setOperator(null);
        setShowGate(true);
    };
    useEffect(() => { const timer = setTimeout(() => setIsLoading(false), 3000); return () => clearTimeout(timer); }, []);
    if (isLoading) return <SplashScreen />;
    if (showGate || !operator) return <AdminLogin onAccess={handleAccess} />;
    return appMode === 'food' ? (
        <AdminDashboard appMode={appMode} toggleMode={toggleMode} operator={operator} onSwitchOperator={handleSwitchOperator} />
    ) : (
        <RoomManagement appMode={appMode} toggleMode={toggleMode} />
    );
}

// --- SPLASH SCREEN ---
function SplashScreen() {
    const logoUrl = '/logo.png'; 
    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center overflow-hidden relative">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-cyan-500/10 rounded-full blur-[120px] animate-pulse"></div>
            <div className="relative z-10 flex flex-col items-center">
                <div className="w-28 h-28 bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] flex items-center justify-center shadow-2xl relative mb-8">
                    <div className="absolute inset-0 bg-cyan-500/20 blur-2xl opacity-50 rounded-[2.5rem]"></div>
                    <img src={logoUrl} alt="Logo" className="w-28 h-28 object-contain drop-shadow-[0_0_15px_rgba(34,211,238,0.5)]" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                </div>
                <h1 className="text-4xl font-black tracking-[0.2em] text-white text-center mb-2">VALO<span className="text-cyan-400"></span></h1>
                <p className="text-gray-400 tracking-[0em] text-[18px] font-bold animate-pulse">Experience</p>
                <div className="mt-12 w-48 h-1 bg-white/5 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 w-1/2 animate-loading-slide"></div></div>
            </div>
        </div>
    );
}

function AdminLogin({ onAccess }) {
    const [mode, setMode] = useState('main');
    const [pin, setPin] = useState('');
    const [staffPin, setStaffPin] = useState('');
    const [staffMembers, setStaffMembers] = useState([]);
    const [selectedStaffId, setSelectedStaffId] = useState('');
    const [error, setError] = useState(false);
    const [isVerifying, setIsVerifying] = useState(false);
    const logoUrl = '/logo.png';

    const loadStaffMembers = async () => {
        setIsVerifying(true);
        const { data, error: dbError } = await supabase.from('staff_accounts').select('id, name, active').eq('active', true).order('name', { ascending: true });
        setIsVerifying(false);
        if (dbError) { console.error('Staff account load error:', dbError); alert('Staff accounts are not available yet. Run the staff_accounts SQL setup first.'); return; }
        const rows = Array.isArray(data) ? data : [];
        setStaffMembers(rows);
        setSelectedStaffId(rows[0]?.id ? String(rows[0].id) : '');
        setStaffPin('');
        setMode('staff');
    };

    const handleAdminSubmit = async (e) => {
        e.preventDefault();
        if (!pin) return;
        setIsVerifying(true);
        const { data, error: dbError } = await supabase.from('app_settings').select('admin_pin').eq('id', 1).single();
        const currentPin = data ? String(data.admin_pin) : '6748';
        if (!dbError && pin === currentPin) {
            setError(false);
            onAccess({ id: null, name: 'Admin', role: 'admin' });
        } else {
            setError(true); setPin(''); setTimeout(() => setError(false), 600);
        }
        setIsVerifying(false);
    };

    const handleStaffSubmit = async (e) => {
        e.preventDefault();
        if (!selectedStaffId || !staffPin) return;
        setIsVerifying(true);
        const { data, error: dbError } = await supabase.from('staff_accounts').select('id, name, pin, active').eq('id', Number(selectedStaffId)).eq('active', true).single();
        if (dbError || !data || String(data.pin) !== String(staffPin)) {
            setError(true); setStaffPin(''); setTimeout(() => setError(false), 600); setIsVerifying(false); return;
        }
        setError(false); setIsVerifying(false);
        onAccess({ id: data.id, name: data.name, role: 'staff' });
    };

    return (
        <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center p-4">
            <div className={`w-full max-w-sm bg-slate-800 border border-white/10 p-8 rounded-[2.5rem] shadow-2xl text-center transition-all ${error ? 'animate-shake border-red-500' : ''}`}>
                <div className="w-24 h-24 bg-white rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-xl border border-white/5 relative">
                    <img src={logoUrl} alt="Logo" className="w-24 h-24 object-contain" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.style.display = 'none'; }} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-1 uppercase tracking-tight">{mode === 'main' ? 'Operator Access' : 'Select Operator'}</h2>
                <p className="text-xs text-gray-500 mb-6">{mode === 'main' ? 'Choose how you want to enter VALO Admin.' : 'Choose your name and enter your personal PIN.'}</p>
                {mode === 'main' && (<>
                    <form onSubmit={handleAdminSubmit} className="space-y-4">
                        <input type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g,''))} autoComplete="new-password" placeholder="Admin PIN" maxLength="4" autoFocus disabled={isVerifying} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-4 text-center text-white text-2xl tracking-[0.45em] focus:outline-none focus:border-cyan-500 transition-all disabled:opacity-50" />
                        <button type="submit" disabled={isVerifying || pin.length === 0} className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-black py-4 rounded-2xl hover:opacity-90 transition-all shadow-lg active:scale-95 disabled:opacity-50">{isVerifying ? 'Checking...' : 'Admin Access'}</button>
                    </form>
                    <button type="button" onClick={loadStaffMembers} disabled={isVerifying} className="w-full mt-3 bg-slate-700 text-white font-bold py-4 rounded-2xl hover:bg-slate-600 transition-all shadow-lg active:scale-95 disabled:opacity-50">Continue as Staff</button>
                </>)}
                {mode === 'staff' && (<form onSubmit={handleStaffSubmit} className="space-y-4">
                    {staffMembers.length === 0 ? <div className="bg-black/20 border border-white/10 rounded-xl p-4 text-sm text-gray-400">No staff operators have been added yet. Sign in as Admin and add them in Settings.</div> : <>
                        <select value={selectedStaffId} onChange={e => setSelectedStaffId(e.target.value)} disabled={isVerifying} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-4 text-white focus:outline-none focus:border-cyan-500">{staffMembers.map(staff => <option key={staff.id} value={staff.id}>{staff.name}</option>)}</select>
                        <input type="password" value={staffPin} onChange={e => setStaffPin(e.target.value.replace(/\D/g,''))} autoComplete="new-password" placeholder="Personal PIN" maxLength="4" autoFocus disabled={isVerifying} className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-4 text-center text-white text-2xl tracking-[0.45em] focus:outline-none focus:border-cyan-500 transition-all disabled:opacity-50" />
                        <button type="submit" disabled={isVerifying || !selectedStaffId || staffPin.length === 0} className="w-full bg-cyan-500 text-black font-black py-4 rounded-2xl hover:bg-cyan-400 transition-all shadow-lg active:scale-95 disabled:opacity-50">{isVerifying ? 'Checking...' : 'Continue'}</button>
                    </>}
                    <button type="button" onClick={() => { setMode('main'); setStaffPin(''); setError(false); }} disabled={isVerifying} className="w-full bg-white/5 text-gray-300 font-bold py-3 rounded-xl hover:bg-white/10 transition disabled:opacity-50">Back</button>
                </form>)}
            </div>
        </div>
    );
}

function AdminDashboard({ appMode, toggleMode, operator, onSwitchOperator }) {
    const [activeTab, setActiveTab] = useState('orders');
     const [opsTab, setOpsTab] = useState('staff');
    
    // --- TAB-LEVEL SECURITY STATES ---
    const [isUnlocked, setIsUnlocked] = useState(() => operator?.role === 'admin' || localStorage.getItem('valo_unlocked') === 'true');
    useEffect(() => { setIsUnlocked(operator?.role === 'admin'); }, [operator?.role]);
    const [pinModalOpen, setPinModalOpen] = useState(false);
    const [targetTab, setTargetTab] = useState(null);
    // Add this state
    const [actionAuth, setActionAuth] = useState({ open: false, onConfirm: null });

   // --- TAB CLICK ROUTER ---
    const handleTabClick = (tabId) => {
        // Unlocked Tabs (Staff can access these anytime)
        if (tabId === 'orders' || tabId === 'history' || tabId === 'create_bill' || tabId === 'menu') {
            setActiveTab(tabId);
            setIsSidebarOpen(false);
        } else {
            // Locked Tabs require authentication
            if (isUnlocked) {
                setActiveTab(tabId);
                setIsSidebarOpen(false);
            } else {
                setTargetTab(tabId);
                setPinModalOpen(true);
                setIsSidebarOpen(false);
            }
        }
    };

    const handleLockApp = () => {
        localStorage.setItem('valo_unlocked', 'false'); // Lock it instantly
        setIsUnlocked(false);
        setActiveTab('orders'); // Safely kick them back to orders
        alert("App Locked! Admin areas are now secured.");
    };
    
    const [appName, setAppName] = useState(() => localStorage.getItem('valo_app_name') || 'VALO');
    const [alertTone, setAlertTone] = useState(() => localStorage.getItem('valo_alert_tone') || 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg');

    const [orders, setOrders] = useState([]);
    const [users, setUsers] = useState([]);
    const [categories, setCategories] = useState([]);
    const [menuItems, setMenuItems] = useState([]);
    const [moments, setMoments] = useState([]);
    const [inventoryItems, setInventoryItems] = useState([]);
    const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('All');
    const [expenses, setExpenses] = useState([]);
    const [staffExpenses, setStaffExpenses] = useState([]);
    const [missingItemsData, setMissingItemsData] = useState([]);
  // Purchase States
    const [purchasesData, setPurchasesData] = useState([]);
    const [purchaseModal, setPurchaseModal] = useState({ open: false });
    const [purchaseForm, setPurchaseForm] = useState({ type: 'Inventory', name: '', qty: 1, price: '', invId: null, mode: 'Cash', personalMoney: false });
    const [purchaseShowSugg, setPurchaseShowSugg] = useState(false);
    const [purchaseTabFilter, setPurchaseTabFilter] = useState('All');
    const [selectedPurchaseItem, setSelectedPurchaseItem] = useState(null);

    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [audioUnlocked, setAudioUnlocked] = useState(false);
    const [menuSearchQuery, setMenuSearchQuery] = useState(""); 
    
    // Create Bill States
    const [createBillModal, setCreateBillModal] = useState(false);
    const [billCustomerName, setBillCustomerName] = useState('');
    const [billCustomerPhone, setBillCustomerPhone] = useState('');
    const [billTableNo, setBillTableNo] = useState('Counter');
    const [billItemsList, setBillItemsList] = useState([]);
    const [billItemSearch, setBillItemSearch] = useState('');
    const [billItemPrice, setBillItemPrice] = useState('');
    const [billItemQty, setBillItemQty] = useState(1);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [selectedMenuId, setSelectedMenuId] = useState(null);
    const [selectedInvId, setSelectedInvId] = useState(null);
    const [billBarcode, setBillBarcode] = useState('');
    
    // Live Order Custom Item Form
    const [addingItemTo, setAddingItemTo] = useState(null);
    const [customItemForm, setCustomItemForm] = useState({ name: '', qty: 1, price: '', menuId: null, invId: null, isInv: false });

    // Expense Management States
    const [expenseDesc, setExpenseDesc] = useState('');
    const [expenseAmount, setExpenseAmount] = useState('');
    const [expenseMode, setExpenseMode] = useState('Cash');
    const [expensePersonalMoney, setExpensePersonalMoney] = useState(false);
    const [expenseDateFilter, setExpenseDateFilter] = useState(() => getFormattedDateForInput());

    // Barcode Scanning State
    const [scanOrderId, setScanOrderId] = useState(null);
    const [barcodeInput, setBarcodeInput] = useState('');
    const barcodeInputRef = useRef(null);

    // Modals
    const [itemModal, setItemModal] = useState({ open: false, mode: 'add', data: null });
    const [catModal, setCatModal] = useState(false);
    const [momentModal, setMomentModal] = useState({ open: false, mode: 'add', data: null });
    const [viewOrderDetails, setViewOrderDetails] = useState(null);
    const [invModal, setInvModal] = useState({ open: false, mode: 'add', data: null }); 
    const [editHistoryModal, setEditHistoryModal] = useState({ open: false, order: null, tempMethod: 'Cash' });

    // New Modals
    const [staffModal, setStaffModal] = useState({ open: false });
// Find this line around line 147:
const [staffForm, setStaffForm] = useState({ staff_name: '', name: '', qty: 1, price: '', isInv: false, invId: null, menuId: null, expenseType: 'item', cashSource: 'Personal Money' });    const [staffShowSugg, setStaffShowSugg] = useState(false);
    const [isCustomStaff, setIsCustomStaff] = useState(false);
    const [activeStaff, setActiveStaff] = useState('');

    const [missingModal, setMissingModal] = useState({ open: false });
    const [missingForm, setMissingForm] = useState({ name: '', qty: 1, price: '', isInv: false, invId: null, menuId: null });
    const [missingShowSugg, setMissingShowSugg] = useState(false);
    
    
    // Payment Modal State
    const [adminPaymentModal, setAdminPaymentModal] = useState({ open: false, orderId: null, total: null });
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [splitCash, setSplitCash] = useState('');
    const [splitOnline, setSplitOnline] = useState('');

    // Analytics, Transactions & Search States
    const [analyticsFilter, setAnalyticsFilter] = useState('Today'); 
    const [selectedRevenueCategory, setSelectedRevenueCategory] = useState(null);
    const [analyticsCustomDate, setAnalyticsCustomDate] = useState(() => getFormattedDateForInput());
    const [transactionPage, setTransactionPage] = useState(1);
    const [historyItemSearch, setHistoryItemSearch] = useState(''); 
    const [historyItemForm, setHistoryItemForm] = useState({ name: '', price: '', qty: 1, menuId: null, invId: null, isInv: false });
    const [historyItemSugg, setHistoryItemSugg] = useState(false);
    const [inventorySearchQuery, setInventorySearchQuery] = useState('');
    const [inventoryWhatsAppModal, setInventoryWhatsAppModal] = useState(false);

    // --- OPERATOR / AUDIT TRAIL ---
    const currentOperator = operator || { id: null, name: 'Admin', role: 'admin' };
    const [installPromptEvent, setInstallPromptEvent] = useState(null);
    const [showInstallHelp, setShowInstallHelp] = useState(false);
    const [appNotifications, setAppNotifications] = useState([]);

    const pushAppNotification = (title, body, type = 'info') => {
        const id = `${Date.now()}_${Math.random()}`;
        setAppNotifications(prev => [{ id, title, body, type, createdAt: Date.now() }, ...prev].slice(0, 6));
        window.setTimeout(() => setAppNotifications(prev => prev.filter(item => item.id !== id)), 6500);
    };

    const notifyOrderEvent = async (title, body, data = {}, type = 'info') => {
        pushAppNotification(title, body, type);
        await sendAdminNotification(title, body, data);
    };
    const [orderActivityModal, setOrderActivityModal] = useState({ open: false, orderId: null, orderLabel: '', rows: [], loading: false });
    const [staffAccounts, setStaffAccounts] = useState([]);
    const [staffAccountForm, setStaffAccountForm] = useState({ id: null, name: '', pin: '' });
    const [staffAccountSaving, setStaffAccountSaving] = useState(false); 
    const [personalWaNumber, setPersonalWaNumber] = useState(() => localStorage.getItem('personal_wa_number') || '');
    const [isEditingWa, setIsEditingWa] = useState(false);
    const [purchaseSearchQuery, setPurchaseSearchQuery] = useState('');

    // Cash Drawer States
    const [drawerCashRecords, setDrawerCashRecords] = useState([]);
    const [drawerModal, setDrawerModal] = useState(false);
    const [pendingModal, setPendingModal] = useState(false);
    const [drawerInput, setDrawerInput] = useState('');
    const [drawerTakenOut, setDrawerTakenOut] = useState('');
    const [drawerTakenBy, setDrawerTakenBy] = useState('');

  const [selectedTableFilter, setSelectedTableFilter] = useState('All'); 
const audioRef = useRef(null);

// --- SMART LOW STOCK NOTIFICATION ENGINE ---
const prevInvRef = useRef({});

// ============================================================
// WHATSAPP INVENTORY REPORT
// Opens WhatsApp directly on Android APK
// Falls back to wa.me on browser/PWA
// ============================================================
const openWhatsAppReport = (message) => {
    const phone = '917972506748';
    const encodedMessage = encodeURIComponent(message);

    const whatsappAppUrl =
        `whatsapp://send?phone=${phone}&text=${encodedMessage}`;

    const whatsappWebUrl =
        `https://wa.me/${phone}?text=${encodedMessage}`;

    if (Capacitor.isNativePlatform()) {
        try {
            // Android: open WhatsApp app
            window.location.href = whatsappAppUrl;

            // Fallback if WhatsApp is not installed
            setTimeout(() => {
                window.location.href = whatsappWebUrl;
            }, 1500);

            return;
        } catch (error) {
            console.error('WhatsApp open error:', error);
            window.location.href = whatsappWebUrl;
        }
    } else {
        // Browser / PWA / Safari
        window.location.href = whatsappWebUrl;
    }
};

// ============================================================
// ATOMIC INVENTORY STOCK ADJUSTMENT
// Positive delta = add/return stock
// Negative delta = consume stock
// ============================================================
const adjustInventoryStock = async (inventoryId, delta) => {
    if (!inventoryId || !delta) return null;

    const { data, error } = await supabase.rpc('adjust_inventory_stock', {
        p_inventory_id: inventoryId,
        p_delta: Number(delta)
    });

    if (error) {
        console.error('Inventory adjustment error:', error);
        alert(error.message || 'Unable to update inventory stock.');
        return null;
    }

    const newStock = Number(data);

    setInventoryItems(prev => prev.map(item =>
        item.id === inventoryId ? { ...item, stock: newStock } : item
    ));

    return newStock;
};

// Serialize live-order mutations per order so rapid + / - clicks cannot
// overwrite one another with stale React state.
const orderMutationLocks = useRef(new Map());

const withOrderMutationLock = async (orderId, operation) => {
    const previous = orderMutationLocks.current.get(orderId) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    orderMutationLocks.current.set(orderId, current);

    try {
        return await current;
    } finally {
        if (orderMutationLocks.current.get(orderId) === current) {
            orderMutationLocks.current.delete(orderId);
        }
    }
};

// ============================================================
// OPERATOR AUDIT TRAIL
// ============================================================
const logOrderActivity = async (orderId, action, description) => {
    if (!orderId) return;
    const { error } = await supabase.from('order_activity_log').insert([{
        order_id: orderId,
        operator_id: currentOperator.id,
        operator_name: currentOperator.name || 'Unknown',
        operator_role: currentOperator.role || 'staff',
        action,
        description: description || '',
        created_at: new Date().toISOString()
    }]);
    if (error) console.error('Order audit log error:', error);
};

const openOrderActivity = async (order) => {
    setOrderActivityModal({ open: true, orderId: order.id, orderLabel: order.displayId || order.id, rows: [], loading: true });
    const { data, error } = await supabase.from('order_activity_log').select('*').eq('order_id', order.id).order('created_at', { ascending: false }).limit(100);
    if (error) {
        console.error('Activity load error:', error);
        setOrderActivityModal(prev => ({ ...prev, rows: [], loading: false }));
        return;
    }
    setOrderActivityModal(prev => ({ ...prev, rows: Array.isArray(data) ? data : [], loading: false }));
};

const buildOperatorMeta = (details = {}, isNew = false) => ({
    ...details,
    ...(isNew && !details.created_by_name ? {
        created_by_name: currentOperator.name,
        created_by_id: currentOperator.id,
        created_by_role: currentOperator.role
    } : {}),
    last_updated_by_name: currentOperator.name,
    last_updated_by_id: currentOperator.id,
    last_updated_by_role: currentOperator.role,
    last_updated_at: new Date().toISOString()
});


// ============================================================
// WEB/PWA + NATIVE NOTIFICATION INITIALIZATION
// ============================================================
useEffect(() => {
    ensurePwaHead();
    registerValoPwaWorker();
    const handleBeforeInstallPrompt = (event) => { event.preventDefault(); setInstallPromptEvent(event); };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    if (Capacitor.isNativePlatform()) {
        (async () => {
            try {
                if (OneSignal?.initialize && !window.__VALO_ONESIGNAL_NATIVE_INITIALIZED) {
                    OneSignal.initialize(VALO_ONESIGNAL_APP_ID);
                    window.__VALO_ONESIGNAL_NATIVE_INITIALIZED = true;
                }
                await LocalNotifications.requestPermissions();
            } catch (error) { console.warn('Native notification initialization warning:', error); }
        })();
    } else {
        loadOneSignalWebSdk().catch(error => console.warn('Web OneSignal startup warning:', error));
    }
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
}, []);

const installValoApp = async () => {
    if (installPromptEvent) {
        await installPromptEvent.prompt();
        const result = await installPromptEvent.userChoice;
        if (result?.outcome === 'accepted') setInstallPromptEvent(null);
        return;
    }
    setShowInstallHelp(true);
};

// ANDROID BACK BUTTON NAVIGATION
// ============================================================
useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let backListener;

    const setupBackButton = async () => {
        backListener = await App.addListener('backButton', () => {

            // 1. CLOSE CREATE BILL MODAL
            if (createBillModal) {
                setCreateBillModal(false);
                return;
            }

            // 2. CLOSE ORDER DETAILS
            if (viewOrderDetails) {
                setViewOrderDetails(null);
                return;
            }

            // 3. CLOSE EDIT HISTORY MODAL
            if (editHistoryModal.open) {
                setEditHistoryModal({
                    open: false,
                    order: null,
                    tempMethod: 'Cash'
                });
                return;
            }

            // 4. CLOSE ORDER ACTIVITY MODAL
            if (orderActivityModal.open) {
                setOrderActivityModal({ open: false, orderId: null, orderLabel: '', rows: [], loading: false });
                return;
            }

            // 5. CLOSE PAYMENT MODAL
            if (adminPaymentModal.open) {
                setAdminPaymentModal({
                    open: false,
                    orderId: null,
                    total: null
                });
                setIsSplitMode(false);
                return;
            }

            // 5. CLOSE ITEM MODAL
            if (itemModal.open) {
                setItemModal({
                    open: false,
                    mode: 'add',
                    data: null
                });
                return;
            }

            // 6. CLOSE CATEGORY MODAL
            if (catModal) {
                setCatModal(false);
                return;
            }

            // 7. CLOSE MOMENT MODAL
            if (momentModal.open) {
                setMomentModal({
                    open: false,
                    mode: 'add',
                    data: null
                });
                return;
            }

            // 8. CLOSE INVENTORY MODAL
            if (invModal.open) {
                setInvModal({
                    open: false,
                    mode: 'add',
                    data: null
                });
                return;
            }

            // 9. CLOSE STAFF MODAL
            if (staffModal.open) {
                setStaffModal({ open: false });
                return;
            }

            // 10. CLOSE MISSING ITEM MODAL
            if (missingModal.open) {
                setMissingModal({ open: false });
                return;
            }

            // 11. CLOSE PURCHASE MODAL
            if (purchaseModal.open) {
                setPurchaseModal({ open: false });
                return;
            }

            // 12. CLOSE DRAWER MODAL
            if (drawerModal) {
                setDrawerModal(false);
                return;
            }

            // 13. CLOSE PENDING MODAL
            if (pendingModal) {
                setPendingModal(false);
                return;
            }

            // 14. CLOSE CUSTOM ITEM FORM
            if (addingItemTo) {
                setAddingItemTo(null);
                return;
            }

            // 15. CLOSE SCAN ORDER
            if (scanOrderId) {
                setScanOrderId(null);
                setBarcodeInput('');
                return;
            }

            // 16. CLOSE PIN MODAL
            if (pinModalOpen) {
                setPinModalOpen(false);
                setTargetTab(null);
                return;
            }

            // 17. CLOSE SIDEBAR
            if (isSidebarOpen) {
                setIsSidebarOpen(false);
                return;
            }

            // 18. ANY OTHER PAGE → LIVE ORDERS
            if (activeTab !== 'orders') {
                setActiveTab('orders');
                return;
            }

            // 19. LIVE ORDERS → CONFIRM APP CLOSE
            const shouldClose = window.confirm(
                'Close VALO Admin?\n\nAre you sure you want to close the app?'
            );

            if (shouldClose) {
                App.exitApp();
            }
        });
    };

    setupBackButton();

    return () => {
        if (backListener) {
            backListener.remove();
        }
    };
}, [
    activeTab,
    createBillModal,
    viewOrderDetails,
    editHistoryModal,
    orderActivityModal,
    adminPaymentModal,
    itemModal,
    catModal,
    momentModal,
    invModal,
    staffModal,
    missingModal,
    purchaseModal,
    drawerModal,
    pendingModal,
    addingItemTo,
    scanOrderId,
    pinModalOpen,
    isSidebarOpen
]);
    
    useEffect(() => {
        inventoryItems.forEach(item => {
            const prevStock = prevInvRef.current[item.id];
            
            // If we have tracked this item before, and its stock JUST changed...
            if (prevStock !== undefined && prevStock !== item.stock) {
                // If it dropped to exactly 5 (or from 6 down to 5/4/3)
                if (prevStock > 5 && item.stock <= 5 && item.stock > 2) {
                    playAlert(); // Play beep sound
                    notifyOrderEvent('⚠️ LOW STOCK ALERT', `${item.name} is down to ${item.stock} units!`, { type: 'low_stock', inventoryId: item.id }, 'warning');
                }
                // If it dropped to exactly 2 (or lower)
                else if (prevStock > 2 && item.stock <= 2) {
                    playAlert(); // Play beep sound
                    notifyOrderEvent('🚨 CRITICAL STOCK ALERT', `${item.name} is critically low (${item.stock} units left)!`, { type: 'critical_stock', inventoryId: item.id }, 'danger');
                }
            }
            
            // Remember the current stock for the next time it updates
            prevInvRef.current[item.id] = item.stock;
        });
    }, [inventoryItems]);

    // Calculate unique staff totals dynamically
    const staffTotals = staffExpenses.reduce((acc, curr) => {
        acc[curr.staff_name] = (acc[curr.staff_name] || 0) + curr.total;
        return acc;
    }, {});
    
    const uniqueStaffNames = Object.keys(staffTotals).sort();

    useEffect(() => {
        if (activeTab === 'staff' && !activeStaff && uniqueStaffNames.length > 0) {
            setActiveStaff(uniqueStaffNames[0]);
        }
    }, [activeTab, uniqueStaffNames, activeStaff]);

    useEffect(() => {
        if(scanOrderId && barcodeInputRef.current) barcodeInputRef.current.focus();
    }, [scanOrderId, barcodeInput]);

    useEffect(() => {
        const unlockAudio = () => {
            if (audioRef.current && !audioUnlocked) {
                audioRef.current.play().then(() => {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                    setAudioUnlocked(true);
                }).catch(() => {});
            }
        };
        document.addEventListener('click', unlockAudio);
        return () => document.removeEventListener('click', unlockAudio);
    }, [audioUnlocked]);

    const playAlert = () => {
        if (audioRef.current && audioRef.current.paused) {
            audioRef.current.currentTime = 0;
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) playPromise.catch(() => {});
        }
    };

    const stopAlert = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }
    };

    // ============================================================
    // DATA LOADERS
    // Initial load fetches all dashboard data once. After that, mutations
    // use targeted table refreshes instead of re-downloading every table.
    // This preserves the existing functionality while substantially reducing
    // Supabase egress.
    // ============================================================
    const fetchOrders = async () => {
        const { data: ord } = await supabase.from('orders').select('*').order('id', { ascending: false });
        if (ord) {
            const formatted = ord.map(o => ({ ...o.order_details, id: o.id, status: o.status, tableNo: o.table_no, total: o.total }));
            setOrders(formatted);
            const hasPending = formatted.some(o => o.status === 'Received');
            if (hasPending) playAlert(); else stopAlert();
        }
    };

    const fetchUsers = async () => {
        const { data } = await supabase.from('users').select('*').order('joined_at', { ascending: false });
        if (data) setUsers(data);
    };

    const fetchCategories = async () => {
        const { data } = await supabase.from('categories').select('*').order('id', { ascending: true });
        if (data) setCategories(data);
    };

    const fetchMenuItems = async () => {
        const { data } = await supabase.from('menu_items').select('*').order('id', { ascending: true });
        if (data) setMenuItems(data);
    };

    const fetchMoments = async () => {
        const { data } = await supabase.from('moments').select('*').order('id', { ascending: false });
        if (data) setMoments(data);
    };

    const fetchInventory = async () => {
        const { data } = await supabase.from('inventory_items').select('*').order('name', { ascending: true });
        if (data) setInventoryItems(data);
    };

    const fetchExpenses = async () => {
        const { data } = await supabase.from('expenses').select('*').order('timestamp', { ascending: false });
        if (data) setExpenses(data);
    };

    const fetchStaffExpenses = async () => {
        const { data } = await supabase.from('staff_expenses').select('*').order('timestamp', { ascending: false });
        if (data) setStaffExpenses(data);
    };

    const fetchMissingItems = async () => {
        const { data } = await supabase.from('missing_items').select('*').order('timestamp', { ascending: false });
        if (data) setMissingItemsData(data);
    };

    const fetchPurchases = async () => {
        const { data } = await supabase.from('stock_purchases').select('*').order('timestamp', { ascending: false });
        if (data) setPurchasesData(data);
    };

    const fetchDrawerCash = async () => {
        const { data } = await supabase.from('drawer_cash').select('*').order('timestamp', { ascending: false });
        if (data) setDrawerCashRecords(data);
    };

    const fetchData = async () => {
        await Promise.all([
            fetchOrders(),
            fetchUsers(),
            fetchCategories(),
            fetchMenuItems(),
            fetchMoments(),
            fetchInventory(),
            fetchExpenses(),
            fetchStaffExpenses(),
            fetchMissingItems(),
            fetchPurchases(),
            fetchDrawerCash()
        ]);
    };


    // ============================================================
    // LOW-EGRESS REALTIME SYNC
    // IMPORTANT: Do NOT call fetchData() for every realtime event.
    // The old listener re-downloaded every table whenever ANY row
    // changed, which can create very large Supabase egress usage.
    // We now apply the realtime row directly to local React state.
    // ============================================================
    const applyRealtimeRow = (table, eventType, newRow, oldRow) => {
        const row = eventType === 'DELETE' ? oldRow : newRow;
        const rowId = row?.id;

        const upsertById = (setter, nextRow, sortFn = null) => {
            if (!nextRow || rowId === undefined || rowId === null) return;
            setter(prev => {
                const index = prev.findIndex(item => String(item.id) === String(rowId));

                if (eventType === 'DELETE') {
                    if (index === -1) return prev;
                    return prev.filter(item => String(item.id) !== String(rowId));
                }

                const next = [...prev];
                if (index === -1) next.push(nextRow);
                else next[index] = { ...next[index], ...nextRow };

                return sortFn ? next.sort(sortFn) : next;
            });
        };

        switch (table) {
            case 'orders': {
                if (!row) return;

                if (eventType === 'DELETE') {
                    setOrders(prev => prev.filter(item => String(item.id) !== String(rowId)));
                    return;
                }

                const formatted = {
                    ...(row.order_details || {}),
                    id: row.id,
                    status: row.status,
                    tableNo: row.table_no,
                    total: row.total
                };

                setOrders(prev => {
                    const index = prev.findIndex(item => String(item.id) === String(rowId));
                    const next = [...prev];

                    if (index === -1) next.unshift(formatted);
                    else next[index] = { ...next[index], ...formatted };

                    next.sort((a, b) => Number(b.id || 0) - Number(a.id || 0));

                    const hasPending = next.some(item => item.status === 'Received');
                    if (hasPending) playAlert();
                    else stopAlert();

                    return next;
                });
                return;
            }

            case 'users':
                upsertById(
                    setUsers,
                    row,
                    (a, b) => String(b.joined_at || '').localeCompare(String(a.joined_at || ''))
                );
                return;

            case 'categories':
                upsertById(
                    setCategories,
                    row,
                    (a, b) => Number(a.id || 0) - Number(b.id || 0)
                );
                return;

            case 'menu_items':
                upsertById(
                    setMenuItems,
                    row,
                    (a, b) => Number(a.id || 0) - Number(b.id || 0)
                );
                return;

            case 'moments':
                upsertById(
                    setMoments,
                    row,
                    (a, b) => Number(b.id || 0) - Number(a.id || 0)
                );
                return;

            case 'inventory_items':
                upsertById(
                    setInventoryItems,
                    row,
                    (a, b) => String(a.name || '').localeCompare(String(b.name || ''))
                );
                return;

            case 'expenses':
                upsertById(
                    setExpenses,
                    row,
                    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
                );
                return;

            case 'staff_expenses':
                upsertById(
                    setStaffExpenses,
                    row,
                    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
                );
                return;

            case 'missing_items':
                upsertById(
                    setMissingItemsData,
                    row,
                    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
                );
                return;

            case 'stock_purchases':
                upsertById(
                    setPurchasesData,
                    row,
                    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
                );
                return;

            case 'drawer_cash':
                upsertById(
                    setDrawerCashRecords,
                    row,
                    (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
                );
                return;

            default:
                // Tables that do not feed the main dashboard state are
                // intentionally ignored here. They can still be loaded
                // explicitly by their existing handlers.
                return;
        }
    };

    useEffect(() => {
        fetchData();

        const channel = supabase
            .channel('admin-dashboard')
            .on(
                'postgres_changes',
                { event: '*', schema: 'public' },
                payload => {
                    // Realtime already gives us the changed row. Updating
                    // local state directly avoids re-downloading every
                    // dashboard table for a single database change.
                    applyRealtimeRow(
                        payload?.table,
                        payload?.eventType,
                        payload?.new,
                        payload?.old
                    );
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
            stopAlert();
        };
    }, []);

    useEffect(() => { if (currentOperator.role === 'admin' && activeTab === 'settings') fetchStaffAccounts(); }, [activeTab, currentOperator.role]);

  const handleSaveCategory = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const name = form.get('name');
        const file = form.get('image');
        
        let imgBase64 = null;
        if (file && file.size > 0) {
            imgBase64 = await fileToBase64(file);
        }

        const executeSave = async () => {
            const { error } = await supabase.from('categories').insert([{ name, image: imgBase64 }]);
            if (error) alert(error.message);
            setCatModal(false);
            await fetchCategories();
        };

        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeSave });
        else executeSave();
    };

    const deleteCategory = async (id) => {
        const executeDelete = async () => {
            if(confirm('Delete this category?')) {
                await supabase.from('categories').delete().eq('id', id);
                await fetchCategories();
            }
        };
        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeDelete });
        else executeDelete();
    };

    const handleSaveItem = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        
        const payload = {
            category_id: form.get('category'),
            name: form.get('name'),
            price: `₹${form.get('price')}`,
            description: form.get('desc'),
            in_stock: true,
            is_special: false
        };

        const file = form.get('image');
        if (file && file.size > 0) {
            payload.img = await fileToBase64(file);
        }

        // We capture whether it's an edit or add NOW before the modal resets
        const isEdit = itemModal.mode === 'edit';
        const targetId = isEdit ? itemModal.data.id : null;

        const executeSave = async () => {
            if (!isEdit) {
                await supabase.from('menu_items').insert([payload]);
            } else {
                await supabase.from('menu_items').update(payload).eq('id', targetId);
            }
            setItemModal({open: false, mode: 'add', data: null});
            await fetchMenuItems();
        };

        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeSave });
        else executeSave();
    };

    const deleteItem = async (id) => {
        const executeDelete = async () => {
            if(confirm('Delete this menu item?')) {
                await supabase.from('menu_items').delete().eq('id', id);
                await fetchMenuItems();
            }
        };
        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeDelete });
        else executeDelete();
    };

    const toggleSpecial = async (item) => {
        const executeToggle = async () => {
            await supabase.from('menu_items').update({ is_special: !item.is_special }).eq('id', item.id);
            await fetchMenuItems();
        };
        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeToggle });
        else executeToggle();
    };

    const toggleStock = async (item) => {
        const executeToggle = async () => {
            await supabase.from('menu_items').update({ in_stock: !item.in_stock }).eq('id', item.id);
            await fetchMenuItems();
        };
        if (!isUnlocked) setActionAuth({ open: true, onConfirm: executeToggle });
        else executeToggle();
    };

    const handleSaveMoment = async (e) => {
        e.preventDefault();
        const form = new FormData(e.target);
        const payload = { caption: form.get('caption') };
        
        const file = form.get('image');
        if (file && file.size > 0) {
            payload.src = await fileToBase64(file);
        }

        if (momentModal.mode === 'add') {
            await supabase.from('moments').insert([payload]);
        } else {
            await supabase.from('moments').update(payload).eq('id', momentModal.data.id);
        }
        setMomentModal({open: false, mode: 'add', data: null});
        await fetchMoments();
    };

    const deleteMoment = async (id) => {
        if(confirm('Delete this moment?')) {
            await supabase.from('moments').delete().eq('id', id);
            await fetchMoments();
        }
    };

  const handleSaveInventory = async (e) => {
    e.preventDefault();

    const form = new FormData(e.target);
    const newName = String(form.get('name') || '').trim();
    const newCategory = String(form.get('category') || 'Inventory').trim();
    const newBarcode = String(form.get('barcode') || '').trim();
    const newStock = Number(form.get('stock'));
    const newPrice = Number(form.get('price'));

    if (!newName) {
        alert('Item name is required.');
        return;
    }

    if (!Number.isFinite(newStock) || newStock < 0) {
        alert('Stock must be 0 or greater.');
        return;
    }

    if (!Number.isFinite(newPrice) || newPrice < 0) {
        alert('Price must be 0 or greater.');
        return;
    }

    const payload = {
        name: newName,
        category: newCategory,
        barcode: newBarcode,
        stock: newStock,
        price: newPrice
    };

    // ============================================================
    // ADD NEW INVENTORY ITEM
    // ============================================================
    if (invModal.mode === 'add') {
        const { error } = await supabase
            .from('inventory_items')
            .insert([payload]);

        if (error) {
            console.error('Inventory insert error:', error);
            alert(error.message || 'Could not add inventory item.');
            return;
        }

        setInvModal({ open: false, mode: 'add', data: null });
        await fetchInventory();
        return;
    }

    // ============================================================
    // EDIT EXISTING INVENTORY ITEM
    // ============================================================
    const inventoryId = invModal.data?.id;
    const oldName = String(invModal.data?.name || '').trim();

    if (!inventoryId) {
        alert('Inventory item ID is missing.');
        return;
    }

    const { error: inventoryUpdateError } = await supabase
        .from('inventory_items')
        .update(payload)
        .eq('id', inventoryId);

    if (inventoryUpdateError) {
        console.error('Inventory update error:', inventoryUpdateError);
        alert(inventoryUpdateError.message || 'Could not update inventory item.');
        return;
    }

    // ============================================================
    // SYNC RENAMED INVENTORY ITEM INTO OLD BILLS / ORDERS
    // ============================================================
    if (oldName !== newName) {
        try {
            const { data: allOrders, error: ordersFetchError } = await supabase
                .from('orders')
                .select('id, order_details, item_names');

            if (ordersFetchError) {
                console.error('Could not load orders for name sync:', ordersFetchError);
                alert(
                    `Inventory item was renamed, but old bills could not be synchronized.\n\n${ordersFetchError.message}`
                );
            } else if (Array.isArray(allOrders) && allOrders.length > 0) {
                const changedOrderRows = [];

                for (const orderRow of allOrders) {
                    const details = orderRow?.order_details || {};
                    const customItems = Array.isArray(details.customItems)
                        ? details.customItems
                        : [];

                    let changed = false;

                    const updatedCustomItems = customItems.map(item => {
                        if (!item || !item.isInv) return item;

                        const sameInventoryId =
                            item.invId !== null &&
                            item.invId !== undefined &&
                            String(item.invId) === String(inventoryId);

                        // Fallback for very old records that may not have invId.
                        const legacyNameMatch =
                            (item.invId === null || item.invId === undefined) &&
                            String(item.name || '').trim() === oldName;

                        if (sameInventoryId || legacyNameMatch) {
                            changed = true;
                            return {
                                ...item,
                                name: newName
                            };
                        }

                        return item;
                    });

                    if (!changed) continue;

                    const updatedDetails = {
                        ...details,
                        customItems: updatedCustomItems
                    };

                    const updatedItemNames = generateItemNamesString(
                        updatedDetails.items,
                        updatedDetails.customItems
                    );

                    const { error: orderUpdateError } = await supabase
                        .from('orders')
                        .update({
                            order_details: updatedDetails,
                            item_names: updatedItemNames
                        })
                        .eq('id', orderRow.id);

                    if (orderUpdateError) {
                        console.error(
                            `Could not synchronize Order #${orderRow.id}:`,
                            orderUpdateError
                        );
                        continue;
                    }

                    changedOrderRows.push({
                        id: orderRow.id,
                        order_details: updatedDetails,
                        item_names: updatedItemNames
                    });
                }

                // Update the currently displayed order/history data immediately.
                if (changedOrderRows.length > 0) {
                    const changedById = new Map(
                        changedOrderRows.map(row => [row.id, row])
                    );

                    setOrders(prev => prev.map(order => {
                        const changed = changedById.get(order.id);
                        if (!changed) return order;

                        return {
                            ...order,
                            ...changed.order_details,
                            id: order.id,
                            status: order.status,
                            tableNo: order.tableNo,
                            total: order.total,
                            item_names: changed.item_names
                        };
                    }));

                    console.log(
                        `Inventory rename synced to ${changedOrderRows.length} old bill(s).`
                    );
                }
            }
        } catch (syncError) {
            console.error('Inventory name synchronization error:', syncError);
            alert(
                'Inventory item was renamed, but some old bills may not have been synchronized. Check the console for details.'
            );
        }
    }

    setInvModal({ open: false, mode: 'add', data: null });
    await fetchInventory();
};

    const deleteInventoryItem = async (id) => {
        if(confirm('Delete this inventory item?')) {
            await supabase.from('inventory_items').delete().eq('id', id);
            await fetchInventory();
        }
    };

    // -------------------------------------------------------------------------
    // NEW STAFF & MISSING ITEMS FUNCTIONS
    // -------------------------------------------------------------------------

   // Find handleSaveStaffExpense around line 335 and update it:
const handleSaveStaffExpense = async (e) => {
    e.preventDefault();
    if (!staffForm.staff_name || !staffForm.name || staffForm.qty < 1) return;
    
    const isMoneyExpense = staffForm.expenseType === 'money' || staffForm.name === 'Money';

    const payload = {
        staff_name: staffForm.staff_name,
        item_name: isMoneyExpense ? 'Money' : staffForm.name,
        qty: isMoneyExpense ? 1 : Number(staffForm.qty),
        price: Number(staffForm.price),
        total: (isMoneyExpense ? 1 : Number(staffForm.qty)) * Number(staffForm.price),
        is_inv: isMoneyExpense ? false : staffForm.isInv,
        inv_id: isMoneyExpense ? null : staffForm.invId,
        cash_source: isMoneyExpense ? (staffForm.cashSource || 'Personal Money') : null,
        date: getFormattedDate(),
        time: getFormattedTime(),
        timestamp: Date.now()
    };

    if (!isMoneyExpense && payload.is_inv && payload.inv_id) {
        const invItem = inventoryItems.find(i => i.id === payload.inv_id);
        if (invItem) {
            if (invItem.stock < payload.qty) {
                alert("Not enough stock in inventory!");
                return;
            }
            const newStock = await adjustInventoryStock(invItem.id, -Number(payload.qty));
            if (newStock === null) return;
        }
    }

    await supabase.from('staff_expenses').insert([payload]);
    setStaffModal({ open: false });
    setActiveStaff(payload.staff_name);
    setStaffForm({ staff_name: payload.staff_name, name: '', qty: 1, price: '', isInv: false, invId: null, menuId: null, expenseType: 'item', cashSource: 'Personal Money' });
    await fetchStaffExpenses();
};
    const deleteStaffExpense = async (id) => {
        if(confirm('Remove this record? (Note: Stock is NOT refunded automatically)')) {
            await supabase.from('staff_expenses').delete().eq('id', id);
            await fetchStaffExpenses();
        }
    };
    const deleteMissingItem = async (id) => {
    if (confirm('Are you sure you want to delete this loss/defect record? (Note: Stock is NOT automatically refunded)')) {
        await supabase.from('missing_items').delete().eq('id', id);
        await fetchMissingItems();
    }
};

const handleSaveMissingItem = async (e) => {
        e.preventDefault();
        if (!missingForm.name || missingForm.qty < 1) return;
        
        const form = new FormData(e.target);
        const recordType = form.get('type') || 'Missing';

        const payload = {
            item_name: missingForm.name,
            type: recordType, // Saves whether it's Missing or Defective
            qty: Number(missingForm.qty),
            price: Number(missingForm.price),
            total: Number(missingForm.qty) * Number(missingForm.price),
            is_inv: missingForm.isInv,
            inv_id: missingForm.invId,
            date: getFormattedDate(),
            time: getFormattedTime(),
            timestamp: Date.now()
        };

        if (payload.is_inv && payload.inv_id) {
            const invItem = inventoryItems.find(i => i.id === payload.inv_id);
            if (invItem) {
                if (invItem.stock < payload.qty) {
                    alert("Not enough stock in inventory!");
                    return;
                }
                const newStock = await adjustInventoryStock(invItem.id, -Number(payload.qty));
            if (newStock === null) return;
            }
        }

        await supabase.from('missing_items').insert([payload]);
        setMissingModal({ open: false });
        setMissingForm({ name: '', qty: 1, price: '', isInv: false, invId: null, menuId: null });
        await fetchMissingItems();
    };

    const deletePurchase = async (id) => {
        if(confirm('Are you sure you want to delete this purchase record? (Note: This does not automatically reverse inventory stock or expense ledgers)')) {
            await supabase.from('stock_purchases').delete().eq('id', id);
            await fetchPurchases();
        }
    };

 const handleSavePurchase = async (e) => {
    e.preventDefault();
    if (!purchaseForm.name || purchaseForm.qty < 1) return;
    
    const totalCost = Number(purchaseForm.qty) * Number(purchaseForm.price);
    const isFood = purchaseForm.type === 'Food';

    const payload = {
        purchase_type: purchaseForm.type, // 'Food' or 'Inventory'
        item_name: purchaseForm.name,
        inv_id: isFood ? null : purchaseForm.invId,
        qty: Number(purchaseForm.qty),
        unit_price: Number(purchaseForm.price),
        total_cost: totalCost,
        payment_mode: purchaseForm.mode,
        personal_money: purchaseForm.personalMoney === true,
        date: getFormattedDate(),
        time: getFormattedTime(),
        timestamp: Date.now()
    };

    if (isFood) {
        // --- ROUTE 1: FOOD GOES TO STOCK PURCHASES ---
        await supabase.from('stock_purchases').insert([payload]);
    } else {
        // --- ROUTE 2: INVENTORY UPDATES THE INVENTORY TABLE ---
        if (payload.inv_id) {
            const invItem = inventoryItems.find(i => i.id === payload.inv_id);
            if (invItem) {
                const newStockAmount = await adjustInventoryStock(invItem.id, Number(payload.qty));
                if (newStockAmount === null) return;
            }
        } else {
            // Check if inventory item exists by name, else insert new inventory item
            const existingItem = inventoryItems.find(i => i.name.toLowerCase() === payload.item_name.toLowerCase());
            if (existingItem) {
                const newStockAmount = await adjustInventoryStock(existingItem.id, Number(payload.qty));
                if (newStockAmount === null) return;
            } else {
                await supabase.from('inventory_items').insert([{
                    name: payload.item_name,
                    category: 'Inventory',
                    barcode: `AUTO-${Math.floor(100000 + Math.random() * 900000)}`,
                    stock: Number(payload.qty),
                    price: Number(payload.unit_price)
                }]);
            }
        }
        // Also log the inventory purchase event
        await supabase.from('stock_purchases').insert([payload]);
    }

    // 3. AUTO-LOG TO EXPENSE LEDGER
    const newExpense = {
        date: payload.date,
        time: payload.time,
        timestamp: payload.timestamp,
        amount: totalCost,
        description: `[Restock] ${payload.item_name} (Qty: ${payload.qty})`,
        mode: payload.payment_mode,
        personal_money: payload.personal_money === true
    };
    await supabase.from('expenses').insert([newExpense]);

    setPurchaseModal({ open: false });
    setPurchaseForm({ type: 'Inventory', name: '', qty: 1, price: '', invId: null, mode: 'Cash', personalMoney: false });
    await Promise.all([fetchPurchases(), fetchExpenses(), fetchInventory()]);
    alert("Purchase recorded and synced successfully!");
};

    const generateItemNamesString = (itemsObj, customItemsArr) => {
        let names = [];
        if (itemsObj) {
            Object.entries(itemsObj).forEach(([id, qty]) => {
                const mItem = menuItems.find(i => i.id === parseInt(id));
                if (mItem) names.push(`${mItem.name} x${qty}`);
            });
        }
        if (customItemsArr) {
            customItemsArr.forEach(ci => {
                names.push(`${ci.name} x${ci.qty}`);
            });
        }
        return names.join(', ');
    };

    const updateOrder = async (id, updates) => {
        const { data: current, error: fetchError } = await supabase.from('orders').select('order_details, total, status').eq('id', id).single();
        if (fetchError) return { error: fetchError };
        if (!current) return { error: new Error('Order not found.') };

        const oldDetails = current.order_details || {};
        const oldItems = oldDetails.items || {};
        const oldCustomItems = Array.isArray(oldDetails.customItems) ? oldDetails.customItems : [];
        const newDetails = buildOperatorMeta({ ...oldDetails, ...updates });
        const newItems = newDetails.items || {};
        const newCustomItems = Array.isArray(newDetails.customItems) ? newDetails.customItems : [];
        const added = [], removed = [];

        Object.entries(newItems).forEach(([menuId, qty]) => {
            const diff = Number(qty || 0) - Number(oldItems[menuId] || 0);
            if (!diff) return;
            const mItem = menuItems.find(item => item.id === parseInt(menuId));
            const name = mItem?.name || 'Menu Item';
            if (diff > 0) added.push(`${name} ×${diff}`); else removed.push(`${name} ×${Math.abs(diff)}`);
        });

        const oldById = new Map(oldCustomItems.map(item => [String(item.id), item]));
        const newById = new Map(newCustomItems.map(item => [String(item.id), item]));
        newCustomItems.forEach(item => {
            const diff = Number(item.qty || 0) - Number(oldById.get(String(item.id))?.qty || 0);
            if (diff > 0) added.push(`${item.name || 'Item'} ×${diff}`);
            if (diff < 0) removed.push(`${item.name || 'Item'} ×${Math.abs(diff)}`);
        });
        oldCustomItems.forEach(item => {
            if (!newById.has(String(item.id)) && Number(item.qty || 0) > 0) removed.push(`${item.name || 'Item'} ×${Number(item.qty || 0)}`);
        });

        const dbPayload = {
            status: updates.status || current.status,
            order_details: newDetails,
            item_names: generateItemNamesString(newDetails.items, newDetails.customItems)
        };
        if (updates.total !== undefined) dbPayload.total = updates.total;

        const { error } = await supabase.from('orders').update(dbPayload).eq('id', id);
        if (error) return { error };

        if (added.length) {
            const description = `${added.join(', ')} added to Order #${id}.`;
            await logOrderActivity(id, 'ITEM_ADDED', description);
            await notifyOrderEvent('➕ Item Added', description, { orderId: id, action: 'ITEM_ADDED' }, 'success');
        }
        if (removed.length) {
            const description = `${removed.join(', ')} removed from Order #${id}.`;
            await logOrderActivity(id, 'ITEM_REMOVED', description);
            await notifyOrderEvent('🗑️ Item Removed', description, { orderId: id, action: 'ITEM_REMOVED' }, 'danger');
        }

        const oldStatuses = oldDetails.itemStatuses || {};
        const newStatuses = newDetails.itemStatuses || {};
        const readyItems = Object.keys(newStatuses).filter(key => newStatuses[key] && !oldStatuses[key]);
        const unreadyItems = Object.keys(oldStatuses).filter(key => oldStatuses[key] && !newStatuses[key]);
        if (readyItems.length || unreadyItems.length) {
            const readyDescription = readyItems.length
                ? `${readyItems.length} item${readyItems.length === 1 ? '' : 's'} marked ready in Order #${id}.`
                : `${unreadyItems.length} item${unreadyItems.length === 1 ? '' : 's'} marked not ready in Order #${id}.`;
            await logOrderActivity(id, 'ITEM_STATUS_UPDATED', readyDescription);
            await notifyOrderEvent(readyItems.length ? '✅ Item Ready' : '↩️ Item Not Ready', readyDescription, { orderId: id, action: 'ITEM_STATUS_UPDATED' }, readyItems.length ? 'success' : 'warning');
        }

        if (updates.status !== undefined && String(updates.status) !== String(current.status)) {
            const isCompleted = updates.status === 'Picked Up';
            const description = isCompleted ? `Order #${id} completed.` : `Status changed from ${current.status || 'Unknown'} to ${updates.status}.`;
            await logOrderActivity(id, isCompleted ? 'COMPLETED' : 'STATUS_CHANGED', description);
            await notifyOrderEvent(isCompleted ? '🎉 Order Completed' : `📋 Order ${updates.status}`, description, { orderId: id, action: isCompleted ? 'COMPLETED' : 'STATUS_CHANGED', status: updates.status }, isCompleted ? 'success' : 'info');
        }

        if (updates.paymentMethod !== undefined || updates.paymentStatus !== undefined || updates.splitAmounts !== undefined) {
            const parts = [];
            if (updates.paymentStatus !== undefined) parts.push(`status: ${updates.paymentStatus}`);
            if (updates.paymentMethod !== undefined) parts.push(`method: ${updates.paymentMethod}`);
            if (updates.splitAmounts) parts.push(`split ₹${updates.splitAmounts.cash || 0} / ₹${updates.splitAmounts.online || 0}`);
            const description = `Payment updated (${parts.join(', ')}).`;
            await logOrderActivity(id, 'PAYMENT_UPDATED', description);
            await notifyOrderEvent('💳 Payment Updated', `Order #${id}: ${parts.join(', ')}`, { orderId: id, action: 'PAYMENT_UPDATED' }, 'info');
        }

        if (!added.length && !removed.length && !readyItems.length && !unreadyItems.length && updates.status === undefined && updates.paymentMethod === undefined && updates.paymentStatus === undefined && updates.splitAmounts === undefined) {
            await logOrderActivity(id, 'ORDER_UPDATED', `Order #${id} details updated.`);
        }

        setOrders(prev => prev.map(order => order.id === id ? { ...order, ...newDetails, id, status: dbPayload.status, total: dbPayload.total !== undefined ? dbPayload.total : current.total } : order));
        return { error: null };
    };

    const fetchStaffAccounts = async () => {
        const { data, error } = await supabase.from('staff_accounts').select('id, name, active').order('name', { ascending: true });
        if (error) { console.error('Staff accounts fetch error:', error); return; }
        setStaffAccounts(Array.isArray(data) ? data : []);
    };

    const saveStaffAccount = async (e) => {
        e.preventDefault();
        const name = String(staffAccountForm.name || '').trim();
        const pin = String(staffAccountForm.pin || '').trim();
        if (!name) return alert('Operator name is required.');
        if (!/^\d{4}$/.test(pin)) return alert('Operator PIN must be exactly 4 digits.');
        setStaffAccountSaving(true);
        const result = staffAccountForm.id ? await supabase.from('staff_accounts').update({name,pin,active:true}).eq('id',staffAccountForm.id) : await supabase.from('staff_accounts').insert([{name,pin,active:true}]);
        setStaffAccountSaving(false);
        if (result.error) return alert(result.error.message || 'Could not save operator.');
        const wasEdit = !!staffAccountForm.id;
        setStaffAccountForm({id:null,name:'',pin:''});
        await fetchStaffAccounts();
        alert(wasEdit ? 'Operator updated successfully.' : 'Operator added successfully.');
    };

    const deactivateStaffAccount = async (id) => {
        if (!confirm('Remove this operator from the selection list?')) return;
        const { error } = await supabase.from('staff_accounts').update({active:false}).eq('id',id);
        if (error) return alert(error.message || 'Could not remove operator.');
        fetchStaffAccounts();
    };

    const handleHistoryAddItem = async () => {
        if (!historyItemForm.name || !historyItemForm.price || historyItemForm.qty < 1) return;

        const order = editHistoryModal.order;
        const qty = Number(historyItemForm.qty);
        const price = Number(historyItemForm.price);
        
        let updatedRegularItems = { ...(order.items || {}) };
        let updatedCustomItems = [...(order.customItems || [])];

        if (historyItemForm.menuId) {
            updatedRegularItems[historyItemForm.menuId] = (updatedRegularItems[historyItemForm.menuId] || 0) + qty;
        } else if (historyItemForm.isInv && historyItemForm.invId) {
            const invItem = inventoryItems.find(i => i.id === historyItemForm.invId);
            if (invItem) {
                if (invItem.stock < qty) {
                    alert("Not enough stock in inventory!");
                    return;
                }
                const invIdKey = `inv_${historyItemForm.invId}`;
                const existingIdx = updatedCustomItems.findIndex(c => c.id === invIdKey);
                if (existingIdx >= 0) {
                    updatedCustomItems[existingIdx].qty += qty;
                } else {
                    updatedCustomItems.push({
                        id: invIdKey, name: historyItemForm.name, qty: qty, price: price, isCustom: true, isInv: true, invId: historyItemForm.invId
                    });
                }
                const newStock = await adjustInventoryStock(invItem.id, -qty);
                if (newStock === null) return;
            }
        } else {
            updatedCustomItems.push({
                id: `custom_${Date.now()}`, name: historyItemForm.name, qty: qty, price: price, isCustom: true
            });
        }

        const newTotal = Number(order.total || 0) + (qty * price);

        // Update the database instantly so the item is saved securely
        await updateOrder(order.id, {
            items: updatedRegularItems,
            customItems: updatedCustomItems,
            total: newTotal
        });

        // Update the visual modal instantly
        setEditHistoryModal(prev => ({
            ...prev,
            order: { ...prev.order, items: updatedRegularItems, customItems: updatedCustomItems, total: newTotal }
        }));

        setHistoryItemForm({ name: '', price: '', qty: 1, menuId: null, invId: null, isInv: false });
    };

  const handleSaveHistoryEdit = async (e) => {
        e.preventDefault();
        const order = editHistoryModal.order;
        const form = new FormData(e.target);
        
        const newTotal = Number(form.get('total'));
        const newMethod = form.get('paymentMethod');
        const newStatus = form.get('status');
        
        let splitAmounts = null;
        if (newMethod === 'Split') {
            const c = Number(form.get('splitCash'));
            const o = Number(form.get('splitOnline'));
            if (c + o !== newTotal) {
                alert(`Split amounts (₹${c + o}) must exactly equal the Total Amount (₹${newTotal})`);
                return;
            }
            splitAmounts = { cash: c, online: o };
        }

        // --- FIX: INSTANT LIVE REFUND ON CANCELLATION ---
        if (newStatus === 'Cancelled' && order.status !== 'Cancelled') {
            const cItems = order.customItems || [];
            for (const c of cItems) {
                if (c.isInv && c.invId) {
                    const refundQty = Number(c.qty) || 0;
                    if (refundQty > 0) {
                        const newStock = await adjustInventoryStock(c.invId, refundQty);
                        if (newStock === null) return;
                    }
                }
            }
            alert("Order cancelled. Inventory stock has been accurately refunded.");
        }

        await updateOrder(order.id, {
            total: newTotal,
            paymentMethod: newMethod,
            status: newStatus,
            splitAmounts: splitAmounts,
            paymentStatus: newStatus === 'Cancelled' ? 'Pending' : 'Paid'
        });

        alert("Order Successfully Updated!");
        setEditHistoryModal({ open: false, order: null, tempMethod: 'Cash' });
        await Promise.all([fetchOrders(), fetchInventory()]); 
    };

   const handleAdminMarkPaid = async (method, splitAmounts = null) => {
    if (adminPaymentModal.orderId) {
        const pStatus = method === 'Pending' ? 'Pending' : 'Paid';
        const finalMethod = method === 'Pending' ? 'Cash' : method;
        
        const updates = { paymentStatus: pStatus, paymentMethod: finalMethod };
        if (splitAmounts) {
            updates.splitAmounts = splitAmounts;
        }
        await updateOrder(adminPaymentModal.orderId, updates);
    }
    setAdminPaymentModal({ open: false, orderId: null, total: null });
    setIsSplitMode(false);
};

    const toggleItemReady = async (order, itemKey) => {
        const currentStatuses = order.itemStatuses || {};
        const isCurrentlyReady = !!currentStatuses[itemKey];
        const updatedStatuses = { ...currentStatuses, [itemKey]: !isCurrentlyReady };
        await updateOrder(order.id, { itemStatuses: updatedStatuses });
    };

    const handleBarcodeSubmit = async (e) => {
        e.preventDefault();
        if(!barcodeInput.trim()) return;

        const item = inventoryItems.find(i => i.barcode === barcodeInput.trim());
        if(!item) {
            alert("Barcode not found in inventory!");
            setBarcodeInput('');
            return;
        }
        if(item.stock <= 0) {
            alert("This item is out of stock!");
            setBarcodeInput('');
            return;
        }

        const order = orders.find(o => o.id === scanOrderId);
        if(!order) return;

        let updatedCustomItems = [...(order.customItems || [])];
        const invIdKey = `inv_${item.id}`;
        const existingIdx = updatedCustomItems.findIndex(c => c.id === invIdKey);

        if(existingIdx >= 0) {
            updatedCustomItems[existingIdx].qty += 1;
        } else {
            updatedCustomItems.push({
                id: invIdKey,
                name: item.name,
                qty: 1,
                price: item.price,
                isInv: true,
                invId: item.id
            });
        }

        const newTotal = Number(order.total || 0) + item.price;
        setBarcodeInput(''); 

        await updateOrder(order.id, {
            customItems: updatedCustomItems,
            total: newTotal
        });
        const newStock = await adjustInventoryStock(item.id, -1);
        if (newStock === null) return;
    };

    const handleBillBarcodeSubmit = (e) => {
        e.preventDefault();
        if(!billBarcode.trim()) return;
        const item = inventoryItems.find(i => i.barcode === billBarcode.trim());
        if(!item) {
            alert("Barcode not found in inventory!");
            setBillBarcode('');
            return;
        }
        if(item.stock <= 0) {
            alert("Item out of stock!");
            setBillBarcode('');
            return;
        }
        
        const existingIdx = billItemsList.findIndex(b => b.invId === item.id);
        if (existingIdx >= 0) {
            const newList = [...billItemsList];
            newList[existingIdx].qty += 1;
            setBillItemsList(newList);
        } else {
            const newItem = {
                uniqueId: Date.now(),
                menuId: null,
                invId: item.id,
                isInv: true,
                name: item.name,
                price: item.price,
                qty: 1
            };
            setBillItemsList(prev => [...prev, newItem]);
        }
        setBillBarcode('');
    };

  const updateLiveOrderItemQty = async (orderId, itemKey, isCustom, newQty) => {
        return withOrderMutationLock(orderId, async () => {
            const requestedQty = Number(newQty);
            if (!Number.isFinite(requestedQty) || requestedQty < 1) return;

            const { data: dbOrder, error: fetchError } = await supabase
                .from('orders')
                .select('*')
                .eq('id', orderId)
                .single();

            if (fetchError || !dbOrder) {
                alert(fetchError?.message || 'Unable to load the latest order.');
                return;
            }

            const order = {
                ...dbOrder.order_details,
                id: dbOrder.id,
                status: dbOrder.status,
                tableNo: dbOrder.table_no,
                total: dbOrder.total
            };

            let updatedRegularItems = { ...(order.items || {}) };
            let updatedCustomItems = [...(order.customItems || [])];
            let priceDiff = 0;
            let inventoryDelta = 0;
            let inventoryId = null;

            if (isCustom) {
                const cItemIndex = updatedCustomItems.findIndex(c => c.id === itemKey);
                if (cItemIndex < 0) return;

                const cItem = updatedCustomItems[cItemIndex];
                const oldQty = Number(cItem.qty) || 0;
                const diff = requestedQty - oldQty;

                if (cItem.isInv && cItem.invId && diff !== 0) {
                    inventoryId = cItem.invId;
                    inventoryDelta = -diff;

                    const newStock = await adjustInventoryStock(
                        cItem.invId,
                        inventoryDelta
                    );

                    if (newStock === null) return;
                }

                priceDiff = diff * Number(cItem.price || 0);
                updatedCustomItems[cItemIndex] = {
                    ...cItem,
                    qty: requestedQty
                };
            } else {
                const menuId = itemKey.replace('menu_', '');
                const oldQty = Number(updatedRegularItems[menuId] || 0);
                updatedRegularItems[menuId] = requestedQty;

                const mItem = menuItems.find(i => i.id === parseInt(menuId));
                const price = mItem
                    ? parseInt(String(mItem.price).replace(/[^0-9]/g, '')) || 0
                    : 0;

                priceDiff = (requestedQty - oldQty) * price;
            }

            const newTotal = Math.max(
                0,
                Number(order.total || 0) + priceDiff
            );

            const result = await updateOrder(orderId, {
                customItems: updatedCustomItems,
                items: updatedRegularItems,
                total: newTotal
            });

            if (result?.error) {
                if (inventoryId && inventoryDelta !== 0) {
                    await adjustInventoryStock(inventoryId, -inventoryDelta);
                }
                alert(result.error.message || 'Unable to update order.');
                return;
            }
        });
    };

    const removeLiveOrderItem = async (orderId, itemKey, isCustom) => {
        if (!confirm('Are you sure you want to remove this item from the order?')) return;

        return withOrderMutationLock(orderId, async () => {
            const { data: dbOrder, error: fetchError } = await supabase
                .from('orders')
                .select('*')
                .eq('id', orderId)
                .single();

            if (fetchError || !dbOrder) {
                alert(fetchError?.message || 'Unable to load the latest order.');
                return;
            }

            const order = {
                ...dbOrder.order_details,
                id: dbOrder.id,
                status: dbOrder.status,
                tableNo: dbOrder.table_no,
                total: dbOrder.total
            };

            let updatedRegularItems = { ...(order.items || {}) };
            let updatedCustomItems = [...(order.customItems || [])];
            let priceDiff = 0;
            let removedItemName = 'Item';
            let inventoryRefund = null;

            if (isCustom) {
                const cItem = updatedCustomItems.find(c => c.id === itemKey);
                if (!cItem) return;

                removedItemName = cItem.name || 'Item';

                if (cItem.isInv && cItem.invId) {
                    const refundQty = Number(cItem.qty) || 0;
                    if (refundQty > 0) {
                        const newStock = await adjustInventoryStock(
                            cItem.invId,
                            refundQty
                        );

                        if (newStock === null) return;
                        inventoryRefund = { invId: cItem.invId, qty: refundQty };
                    }
                }

                priceDiff = -(Number(cItem.qty || 0) * Number(cItem.price || 0));
                updatedCustomItems = updatedCustomItems.filter(c => c.id !== itemKey);
            } else {
                const menuId = itemKey.replace('menu_', '');
                const oldQty = Number(updatedRegularItems[menuId] || 0);
                const mItem = menuItems.find(i => i.id === parseInt(menuId));
                removedItemName = mItem?.name || 'Item';

                const price = mItem
                    ? parseInt(String(mItem.price).replace(/[^0-9]/g, '')) || 0
                    : 0;

                priceDiff = -(oldQty * price);
                delete updatedRegularItems[menuId];
            }

            const newTotal = Math.max(
                0,
                Number(order.total || 0) + priceDiff
            );

            const updatedStatuses = { ...(order.itemStatuses || {}) };
            delete updatedStatuses[itemKey];

            const result = await updateOrder(orderId, {
                customItems: updatedCustomItems,
                items: updatedRegularItems,
                itemStatuses: updatedStatuses,
                total: newTotal
            });

            if (result?.error) {
                if (inventoryRefund) {
                    await adjustInventoryStock(
                        inventoryRefund.invId,
                        -inventoryRefund.qty
                    );
                }
                alert(result.error.message || 'Unable to remove item from order.');
                return;
            }
        });
    };

    const handleAddCustomItem = async (orderId) => {
        return withOrderMutationLock(orderId, async () => {
            const { data: dbOrder, error: fetchError } = await supabase
                .from('orders')
                .select('*')
                .eq('id', orderId)
                .single();

            if (fetchError || !dbOrder) {
                alert(fetchError?.message || 'Unable to load the latest order.');
                return;
            }

            const order = {
                ...dbOrder.order_details,
                id: dbOrder.id,
                status: dbOrder.status,
                tableNo: dbOrder.table_no,
                total: dbOrder.total
            };

            if (!customItemForm.name || !customItemForm.price) return;

            const qty = Number(customItemForm.qty) || 1;
            const price = Number(customItemForm.price) || 0;

            let updatedCustomItems = [...(order.customItems || [])];
            let updatedRegularItems = { ...(order.items || {}) };
            let inventoryDeducted = null;

            if (customItemForm.menuId) {
                updatedRegularItems[customItemForm.menuId] =
                    (Number(updatedRegularItems[customItemForm.menuId]) || 0) + qty;
            } else if (customItemForm.isInv && customItemForm.invId) {
                const invIdKey = `inv_${customItemForm.invId}`;
                const existingIdx = updatedCustomItems.findIndex(c => c.id === invIdKey);

                const newStock = await adjustInventoryStock(
                    customItemForm.invId,
                    -qty
                );

                if (newStock === null) return;
                inventoryDeducted = { invId: customItemForm.invId, qty };

                if (existingIdx >= 0) {
                    updatedCustomItems[existingIdx] = {
                        ...updatedCustomItems[existingIdx],
                        qty: Number(updatedCustomItems[existingIdx].qty || 0) + qty
                    };
                } else {
                    updatedCustomItems.push({
                        id: invIdKey,
                        name: customItemForm.name,
                        qty,
                        price,
                        isCustom: true,
                        isInv: true,
                        invId: customItemForm.invId
                    });
                }
            } else {
                updatedCustomItems.push({
                    id: `custom_${Date.now()}`,
                    name: customItemForm.name,
                    qty,
                    price,
                    isCustom: true
                });
            }

            const newTotal = Number(order.total || 0) + (qty * price);

            const result = await updateOrder(order.id, {
                customItems: updatedCustomItems,
                items: updatedRegularItems,
                total: newTotal
            });

            if (result?.error) {
                if (inventoryDeducted) {
                    await adjustInventoryStock(
                        inventoryDeducted.invId,
                        inventoryDeducted.qty
                    );
                }
                alert(result.error.message || 'Unable to add item to order.');
                return;
            }

            setAddingItemTo(null);
            setCustomItemForm({
                name: '',
                qty: 1,
                price: '',
                menuId: null,
                invId: null,
                isInv: false
            });
        });
    };

    const handleSelectSuggestion = (item, isInv = false) => {
        setBillItemSearch(item.name);
        setBillItemPrice(parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0);
        if (isInv) {
            setSelectedMenuId(null);
            setSelectedInvId(item.id);
        } else {
            setSelectedMenuId(item.id);
            setSelectedInvId(null);
        }
        setShowSuggestions(false);
    };

    const handleAddBillItem = () => {
        if (!billItemSearch || !billItemPrice || billItemQty < 1) return;
        const newItem = {
            uniqueId: Date.now(),
            menuId: selectedMenuId, 
            invId: selectedInvId,
            isInv: !!selectedInvId,
            name: billItemSearch,
            price: Number(billItemPrice),
            qty: Number(billItemQty)
        };
        setBillItemsList([...billItemsList, newItem]);
        
        setBillItemSearch('');
        setBillItemPrice('');
        setBillItemQty(1);
        setSelectedMenuId(null);
        setSelectedInvId(null);
        setShowSuggestions(false);
    };

    const updateBillItemQty = (uniqueId, newQty) => {
        if (newQty < 1) return;
        setBillItemsList(billItemsList.map(item => 
            item.uniqueId === uniqueId ? { ...item, qty: newQty } : item
        ));
    };

const handleCreateBill = async () => {
            const regularItems = {};
        const customItems = [];
        let addedTotal = 0;

        billItemsList.forEach(item => {
            addedTotal += item.price * item.qty;
            if (item.menuId) {
                regularItems[item.menuId] = (regularItems[item.menuId] || 0) + item.qty;
            } else {
                customItems.push({
                    id: item.isInv ? `inv_${item.invId}` : `custom_${Date.now()}_${Math.random()}`,
                    name: item.name,
                    qty: item.qty,
                    price: item.price,
                    isCustom: true,
                    isInv: item.isInv || false,
                    invId: item.invId || null
                });
            }
        });

        // Deduct inventory stock atomically for every inventory-backed POS item.
        // If the order cannot be saved, all deductions are rolled back below.
        const deductedInventory = [];
        for (const item of billItemsList) {
            if (!item.isInv || !item.invId) continue;

            const qty = Number(item.qty) || 0;
            if (qty <= 0) continue;

            const newStock = await adjustInventoryStock(item.invId, -qty);
            if (newStock === null) {
                for (const deducted of deductedInventory) {
                    await adjustInventoryStock(deducted.invId, deducted.qty);
                }
                return;
            }

            deductedInventory.push({ invId: item.invId, qty });
        }

        let existingOrder = orders.find(o => {
            const isActive = ['Received', 'Preparing', 'Ready'].includes(o.status);
            if (!isActive) return false;
            const isSameTable = billTableNo && String(billTableNo).toLowerCase() !== 'counter' && String(o.tableNo).toLowerCase() === String(billTableNo).toLowerCase();
            const inputPhone = billCustomerPhone ? String(billCustomerPhone).trim() : null;
            const orderPhone = o.customer?.phone ? String(o.customer.phone).trim() : null;
            const isSamePhone = inputPhone && orderPhone && inputPhone === orderPhone;
            return isSameTable || isSamePhone;
        });

        if (existingOrder) {
            const { data: dbOrder } = await supabase.from('orders').select('*').eq('id', existingOrder.id).single();
            if (dbOrder) {
                const orderDetails = dbOrder.order_details || {};
                const mergedRegularItems = { ...(orderDetails.items || {}) };
                Object.entries(regularItems).forEach(([id, qty]) => {
                    mergedRegularItems[id] = (mergedRegularItems[id] || 0) + qty;
                });
                const mergedCustomItems = [...(orderDetails.customItems || []), ...customItems];
                const mergedTotal = Number(dbOrder.total || 0) + addedTotal;

                const updatedDetails = buildOperatorMeta({ ...orderDetails, items: mergedRegularItems, customItems: mergedCustomItems });

                const { error } = await supabase.from('orders').update({
                    total: mergedTotal,
                    order_details: updatedDetails,
                    item_names: generateItemNamesString(mergedRegularItems, mergedCustomItems)
                }).eq('id', dbOrder.id);

                if (error) {
                    for (const deducted of deductedInventory) {
                        await adjustInventoryStock(deducted.invId, deducted.qty);
                    }
                    alert("Error merging bill.");
                } else {
                    const addedItemText = billItemsList
                        .map(item => `${item.name} ×${Number(item.qty) || 0}`)
                        .join(', ');

                    await logOrderActivity(
                        dbOrder.id,
                        'ITEM_ADDED',
                        `${addedItemText || 'Items'} added to existing Order #${dbOrder.id}.`
                    );

                    await notifyOrderEvent('➕ Item Added', `${addedItemText || 'Items added'} to Order #${dbOrder.id} by ${currentOperator.name}.`, { orderId: dbOrder.id, action: 'ITEM_ADDED' }, 'success');

                    alert(`Successfully merged into active Order #${dbOrder.id}`);
                    resetPOS();
                    setActiveTab('orders');
                    await Promise.all([fetchOrders(), fetchInventory()]);
                }
            }
        } else {
            const orderPayload = {
                status: 'Ready', 
                table_no: billTableNo || 'Counter',
                total: addedTotal,
                customer_phone: billCustomerPhone || 'Walk-in',
                item_names: generateItemNamesString(regularItems, customItems),
                order_details: {
                    created_by_name: currentOperator.name,
                    created_by_id: currentOperator.id,
                    created_by_role: currentOperator.role,
                    last_updated_by_name: currentOperator.name,
                    last_updated_by_id: currentOperator.id,
                    last_updated_by_role: currentOperator.role,
                    last_updated_at: new Date().toISOString(),
                    date: getFormattedDate(), 
                    time: getFormattedTime(),
                    timestamp: Date.now(),
                    items: regularItems,
                    customItems: customItems,
                    paymentMethod: 'Cash', 
                    paymentStatus: 'Pending', 
                    customer: { name: billCustomerName || 'Walk-in', phone: billCustomerPhone || '' },
                    prepTime: null
                }
            };

            const { data, error } = await supabase
                .from('orders')
                .insert([orderPayload])
                .select();

            if (error) {
                for (const deducted of deductedInventory) {
                    await adjustInventoryStock(deducted.invId, deducted.qty);
                }
                alert("Error creating bill.");
            } else {
                const newId = data?.[0]?.id || null;

                if (newId) {
                    await logOrderActivity(
                        newId,
                        'CREATED',
                        `Order #${newId} created by ${currentOperator.name}.`
                    );
                }

                await notifyOrderEvent('📦 New Bill Created', `Order #${newId || 'New'} created by ${currentOperator.name} for Table: ${billTableNo || 'Counter'} (₹${addedTotal}).`, { orderId: newId, action: 'CREATED' }, 'success');

                resetPOS();
                setActiveTab('orders');
                await Promise.all([fetchOrders(), fetchInventory()]);
            }
        }
    };

    const resetPOS = () => {
        setBillCustomerName('');
        setBillCustomerPhone('');
        setBillTableNo('Counter');
        setBillItemsList([]);
        setCreateBillModal(false);
    };

    const printBill = (order) => {
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.body.appendChild(iframe);

        const itemsArr = Object.entries(order.items || {});
        const customItems = order.customItems || [];
        
        let totalQty = itemsArr.reduce((sum, [id, qty]) => sum + Number(qty), 0);
        totalQty += customItems.reduce((sum, item) => sum + Number(item.qty), 0);

        let itemsHtml = itemsArr.map(([id, qty]) => {
            const item = menuItems.find(i => i.id === parseInt(id));
            const name = item ? item.name : 'Deleted Item';
            const priceStr = item ? item.price : '₹0';
            const numericPrice = parseInt(String(priceStr).replace(/[^0-9]/g, '')) || 0;
            const lineTotal = numericPrice * Number(qty);
            return `<tr><td class="qty">${qty}x</td><td class="item"><span>${name}</span><div style="font-size: 9px; opacity: 0.85;">@ ${priceStr}</div></td><td class="amount" style="text-align: right;">₹${lineTotal}</td></tr>`;
        }).join('');

        if (customItems.length > 0) {
            itemsHtml += customItems.map(cItem => {
                const lineTotal = cItem.price * cItem.qty;
                return `<tr><td class="qty">${cItem.qty}x</td><td class="item"><span>${cItem.name} ${cItem.isInv ? '📦' : '*'}</span><div style="font-size: 9px; opacity: 0.85;">@ ₹${cItem.price}</div></td><td class="amount" style="text-align: right;">₹${lineTotal}</td></tr>`;
            }).join('');
        }

        const paymentDisplay = order.paymentStatus === 'Paid' 
            ? `Paid (${order.paymentMethod === 'Split' ? 'Split - Cash: ₹' + order.splitAmounts?.cash + ', Online: ₹' + order.splitAmounts?.online : (order.paymentMethod || 'Cash')})`
            : 'Pending';

        const content = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Bill - Order #${order.displayId || order.id}</title>
                <style media="print">
                    @page { size: 48mm auto; margin: 0; } 
                    html, body { margin: 0; padding: 0; background: #fff; height: auto; } 
                    .receipt-container { width: 48mm; padding: 2mm 2mm 5mm 2mm; color: #000; font-family: Courier New, monospace; font-size: 11px; box-sizing: border-box; font-weight: 900 !important; margin: 0; } 
                    .receipt-container * { font-weight: 900 !important; } 
                    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                </style>
                <style>
                    .receipt-container { width: 48mm; padding: 2mm 2mm 5mm 2mm; background: #fff; color: #000; font-family: Courier New, monospace; font-size: 11px; line-height: 1.35; box-sizing: border-box; font-weight: 900 !important; margin: 0; } 
                    .receipt-container * { font-weight: 900 !important; } 
                    .center { text-align: center; } 
                    .bold { font-weight: 900 !important; } 
                    .divider { border-top: 1px dashed #000; margin: 6px 0; } 
                    .row { display: flex; justify-content: space-between; align-items: flex-start; gap: 6px; } 
                    table { width: 100%; border-collapse: collapse; } 
                    td, th { vertical-align: top; padding: 2px 0; } 
                    .qty { width: 15%; } 
                    .item { width: 55%; break-inside: avoid; word-break: break-word; } 
                    .amount { width: 30%; text-align: right; }
                </style>
            </head>
            <body>
                <div class="receipt-container">
                    <div class="center bold" style="font-size: 16px;">VALO HOTEL</div>
                    <div class="center">Order Receipt</div>
                    <div class="divider"></div>
                    <div class="row"><span>Order</span><span>#${order.displayId || order.id}</span></div>
                    <div class="row"><span>Table</span><span>${order.tableNo}</span></div>
                    <div class="row"><span>Date</span><span>${order.date}</span></div>
                    <div class="row"><span>Time</span><span>${order.time}</span></div>
                    ${order.customer?.name && order.customer.name !== 'Walk-in' ? `<div class="row"><span>Name</span><span>${order.customer.name}</span></div>` : ''}
                    ${order.customer?.phone && order.customer.phone !== 'Walk-in' ? `<div class="row"><span>Phone</span><span>${order.customer.phone}</span></div>` : ''}
                    <div class="divider"></div>
                    <table><thead><tr style="border-bottom: 1px dashed #000;"><th style="text-align: left; font-size: 10px;">QTY</th><th style="text-align: left; font-size: 10px;">ITEM (RATE)</th><th style="text-align: right; font-size: 10px;">AMT</th></tr></thead><tbody>${itemsHtml}</tbody></table>
                    <div class="divider"></div>
                    <div class="row"><span>Total Items</span><span>${totalQty}</span></div>
                    <div class="row"><span>Grand Total</span><span>₹${order.total}</span></div>
                    <div class="row" style="font-size: 10px; margin-top: 4px;"><span>Payment Status</span><span>${paymentDisplay}</span></div>
                    <div class="divider"></div>
                    <div class="center">Thank You! Visit Again.</div>
                    <div class="center" style="font-size: 9px; margin-top: 4px;">Printed via Valo Ecosystem</div>
                </div>
            </body>
            </html>
        `;

        const printWin = window.open('', '_blank', 'width=400,height=600');
        if (printWin) {
            printWin.document.open();
            printWin.document.write(content);
            printWin.document.close();
            printWin.focus();
            setTimeout(() => {
                printWin.print();
                printWin.close();
            }, 500);
        } else {
            alert("Pop-up blocked! Please allow pop-ups for this website in your browser settings.");
        }
    };

    const sendWhatsAppPDF = async (order, e) => {
        const btn = e.currentTarget;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span class="animate-pulse font-bold text-[10px]">PDF...</span>';
        btn.disabled = true;

        try {
            if (!window.html2pdf) {
                const script = document.createElement('script');
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
                document.body.appendChild(script);
                await new Promise((resolve) => { script.onload = resolve; });
            }

            const itemsArr = Object.entries(order.items || {});
            const customItems = order.customItems || [];
            let totalQty = itemsArr.reduce((sum, [id, qty]) => sum + Number(qty), 0);
            totalQty += customItems.reduce((sum, item) => sum + Number(item.qty), 0);

            let itemsHtml = itemsArr.map(([id, qty]) => {
                const item = menuItems.find(i => i.id === parseInt(id));
                const name = item ? item.name : 'Item';
                const priceStr = item ? item.price : '₹0';
                const numericPrice = parseInt(String(priceStr).replace(/[^0-9]/g, '')) || 0;
                const lineTotal = numericPrice * Number(qty);
                return `<tr><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${qty}x</td><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${name}<br><span style="font-size:10px;color:#666;">@ ${priceStr}</span></td><td style="padding: 6px 0; text-align:right; border-bottom: 1px solid #ddd;">₹${lineTotal}</td></tr>`;
            }).join('');

            if (customItems.length > 0) {
                itemsHtml += customItems.map(cItem => {
                    const lineTotal = cItem.price * cItem.qty;
                    return `<tr><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${cItem.qty}x</td><td style="padding: 6px 0; border-bottom: 1px solid #ddd;">${cItem.name} ${cItem.isInv ? '📦' : '*'}<br><span style="font-size:10px;color:#666;">@ ₹${cItem.price}</span></td><td style="padding: 6px 0; text-align:right; border-bottom: 1px solid #ddd;">₹${lineTotal}</td></tr>`;
                }).join('');
            }

            const paymentDisplay = order.paymentStatus === 'Paid' 
                ? `Paid (${order.paymentMethod === 'Split' ? 'Split - Cash: ₹' + order.splitAmounts?.cash + ', Online: ₹' + order.splitAmounts?.online : (order.paymentMethod || 'Cash')})`
                : 'Pending';

            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            container.innerHTML = `
                <div style="width: 320px; padding: 20px; font-family: sans-serif; color: #000; background: #fff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 24px; font-weight: 900;">VALO HOTEL</h2>
                        <p style="margin: 5px 0 0; font-size: 14px; color: #555;">Order Receipt</p>
                    </div>
                    <div style="margin-bottom: 20px; font-size: 13px; line-height: 1.6;">
                        <div style="display:flex; justify-content:space-between;"><strong>Order ID:</strong> <span>#${order.displayId || order.id}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Date:</strong> <span>${order.date} ${order.time || ''}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Customer:</strong> <span>${order.customer?.name || 'Walk-in'}</span></div>
                        <div style="display:flex; justify-content:space-between;"><strong>Phone:</strong> <span>${order.customer?.phone || 'N/A'}</span></div>
                    </div>
                    <table style="width: 100%; font-size: 13px; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr>
                                <th style="text-align:left; border-bottom: 2px solid #000; padding-bottom: 5px;">Qty</th>
                                <th style="text-align:left; border-bottom: 2px solid #000; padding-bottom: 5px;">Item</th>
                                <th style="text-align:right; border-bottom: 2px solid #000; padding-bottom: 5px;">Amt</th>
                            </tr>
                        </thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                    <div style="font-size: 14px; margin-bottom: 20px;">
                        <div style="display:flex; justify-content:space-between; margin-bottom: 5px;"><span>Total Items:</span> <span>${totalQty}</span></div>
                        <div style="display:flex; justify-content:space-between; font-weight: 900; font-size: 18px;"><span>Grand Total:</span> <span>₹${order.total}</span></div>
                        <div style="display:flex; justify-content:space-between; margin-top: 5px; font-size:12px; color:#555;"><span>Payment:</span> <span>${paymentDisplay}</span></div>
                    </div>
                    <div style="text-align: center; font-size: 12px; color: #777; border-top: 1px dashed #ccc; padding-top: 15px;">
                        Thank you for visiting Valo Hotel!
                    </div>
                </div>
            `;
            document.body.appendChild(container);

            const opt = {
                margin: 5,
                filename: `Valo_Order_${order.displayId || order.id}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2 },
                jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
            };

            const pdfBlob = await window.html2pdf().from(container.children[0]).set(opt).output('blob');
            const file = new File([pdfBlob], `Valo_Order_${order.displayId || order.id}.pdf`, { type: 'application/pdf' });

            document.body.removeChild(container);

            const url = URL.createObjectURL(pdfBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            
            const rawPhone = order.customer?.phone;
            if (rawPhone && rawPhone !== 'Walk-in' && rawPhone.trim() !== '') {
                let waPhone = rawPhone.replace(/\D/g, '');
                if (waPhone.length === 10) waPhone = '91' + waPhone; 
                
                const text = encodeURIComponent(`Hello ${order.customer?.name || ''}, here is your bill from Valo Hotel. Please attach the PDF that was just downloaded.`);
                const waUrl = `https://wa.me/${waPhone}?text=${text}`;
                
                setTimeout(() => {
                    alert("✅ PDF Downloaded! Opening WhatsApp chat now. Please click the attachment (+) icon in WhatsApp to send the downloaded PDF.");
                    window.open(waUrl, '_blank');
                }, 500);
            } else {
                alert("✅ PDF Downloaded! This order doesn't have a valid phone number to open WhatsApp directly.");
            }

        } catch (error) {
            alert("Failed to generate PDF.");
            console.error(error);
        } finally {
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        }
    };

    const handleAddExpense = async (e) => {
        e.preventDefault();
        if(!expenseDesc || !expenseAmount) return;

        const newExpense = {
            date: getFormattedDate(),
            time: getFormattedTime(),
            timestamp: Date.now(),
            amount: Number(expenseAmount),
            description: expenseDesc,
            mode: expenseMode,
            personal_money: expensePersonalMoney === true
        };

        const { error } = await supabase.from('expenses').insert([newExpense]);
        if (error) {
            alert("Error adding expense: " + error.message);
        } else {
            setExpenseDesc('');
            setExpenseAmount('');
            setExpensePersonalMoney(false);
            alert("Expense Saved!");
            await fetchExpenses();
        }
    };

    const deleteExpense = async (id) => {
        if(confirm("Are you sure you want to delete this expense?")) {
            await supabase.from('expenses').delete().eq('id', id);
            await fetchExpenses();
        }
    };

   const getCurrentDrawerCash = () => {
        let cashIn = 0;
        let cashOut = 0;

        // Cash received from completed + paid orders.
        orders.forEach(o => {
            if (o.status === 'Picked Up' && o.paymentStatus === 'Paid') {
                const pm = String(o.paymentMethod || 'Cash').toLowerCase();

                if (pm === 'split') {
                    cashIn += Number(o.splitAmounts?.cash || 0);
                } else if (
                    !pm.includes('online') &&
                    !pm.includes('upi') &&
                    !pm.includes('card')
                ) {
                    cashIn += Number(o.total || 0);
                }
            }
        });

        // Only NON-personal cash expenses reduce the Daily Box.
        // Personal-money expenses are recorded for accounting but do not
        // touch the physical hotel cash drawer.
        //
        // Stock purchases are already auto-logged into expenses, so they
        // must NOT be subtracted separately here (avoids double counting).
        expenses.forEach(e => {
            const isPersonal = e.personal_money === true;
            const isCash = String(e.mode || '').toLowerCase() === 'cash';

            if (!isPersonal && isCash) {
                cashOut += Number(e.amount || 0);
            }
        });

        // Staff direct money/advances reduce the Daily Cash Box ONLY when
        // explicitly marked as paid from the hotel cash box.
        staffExpenses.forEach(se => {
            const isMoneyExpense =
                String(se.item_name || '').toLowerCase() === 'money';
            const isDailyCashBox =
                String(se.cash_source || '').trim() === 'Daily Cash Box';

            if (isMoneyExpense && isDailyCashBox) {
                cashOut += Number(se.total || 0);
            }
        });

        return Math.max(0, cashIn - cashOut);
    };

    // ============================================================
    // CASH DRAWER SNAPSHOT
    // System Cash - cumulative Taken Out = Expected In Box
    // Physical - Expected = Difference
    // ============================================================
    const getDrawerSnapshot = (physicalValue = drawerInput, takenValue = drawerTakenOut) => {
        const systemCash = Math.max(0, Number(getCurrentDrawerCash()) || 0);

        // Every saved drawer record stores ONLY the new amount taken
        // during that entry, so summing them gives cumulative taken.
        const savedTakenOut = drawerCashRecords.reduce(
            (sum, record) => sum + (Number(record.taken_out) || 0),
            0
        );

        const typedTakenOut =
            takenValue !== '' && takenValue !== null && takenValue !== undefined
                ? Math.max(0, Number(takenValue) || 0)
                : 0;

        const totalTakenOut = savedTakenOut + typedTakenOut;

        const expectedInBox = systemCash - totalTakenOut;

        const latestSavedPhysical = drawerCashRecords.find(
            record =>
                record.amount !== null &&
                record.amount !== undefined &&
                record.amount !== ''
        );

        const hasTypedPhysical =
            physicalValue !== '' &&
            physicalValue !== null &&
            physicalValue !== undefined;

        const physicalCounted = hasTypedPhysical
            ? Math.max(0, Number(physicalValue) || 0)
            : latestSavedPhysical
                ? Math.max(0, Number(latestSavedPhysical.amount) || 0)
                : null;

        const hasPhysical = physicalCounted !== null;

        const difference = hasPhysical
            ? physicalCounted - expectedInBox
            : null;

        return {
            systemCash,
            savedTakenOut,
            typedTakenOut,
            totalTakenOut,
            expectedInBox,
            physicalCounted,
            difference,
            hasPhysical
        };
    };

    // ============================================================
    // SAVE ONE CASH-DRAWER ENTRY
    // Each press of Enter / Save creates one history entry.
    // Taken Out is incremental; Physical is the latest physical count.
    // ============================================================
    const handleSaveDrawerCash = async (e) => {
        e.preventDefault();

        const hasTaken = drawerTakenOut !== '';
        const hasPhysical = drawerInput !== '';

        if (!hasTaken && !hasPhysical) {
            return;
        }

        const beforeSave = getDrawerSnapshot();

        // Keep the latest physical count when only Taken Out is entered.
        const physicalToSave = beforeSave.physicalCounted;

        const payload = {
            // Existing column: physical cash left in box
            amount: physicalToSave !== null ? physicalToSave : 0,

            // IMPORTANT: this is only the NEW amount taken in this entry.
            taken_out: hasTaken
                ? Math.max(0, Number(drawerTakenOut) || 0)
                : 0,

            // Current signed-in operator
            taken_by: currentOperator.name || 'Self',

            date: getFormattedDate(),
            time: getFormattedTime(),
            timestamp: Date.now(),

            // New reconciliation snapshot columns.
            // Run the SQL supplied below before using these fields.
            system_cash: beforeSave.systemCash,
            total_taken_out: beforeSave.totalTakenOut,
            expected_cash: beforeSave.expectedInBox,
            difference: beforeSave.difference ?? 0
        };

        const { data, error } = await supabase
            .from('drawer_cash')
            .insert([payload])
            .select()
            .single();

        if (error) {
            console.error('Drawer cash save error:', error);
            alert(`Could not save cash entry.\n\n${error.message}`);
            return;
        }

        // Immediately add the saved record to the top of history.
        if (data) {
            setDrawerCashRecords(prev => [data, ...prev]);
        }

        // Clear the box(es) after successful Enter/Save.
        if (hasTaken) {
            setDrawerTakenOut('');
        }

        if (hasPhysical) {
            setDrawerInput('');
        }

        // Keep the operator ready for the next entry.
        setDrawerTakenBy(currentOperator.name || 'Self');

        // The drawer record is already added locally; no full dashboard refresh is needed.
    };

    const calculateDailyFinancials = () => {
        const dailyData = {};

        orders.forEach(o => {
            if (o.status === 'Picked Up' && o.paymentStatus === 'Paid') {
                const nDate = normalizeDateStr(o.date);
                if (!nDate) return;

                if (!dailyData[nDate]) {
                    dailyData[nDate] = {
                        cashIn: 0,
                        onlineIn: 0,
                        cashOut: 0,
                        onlineOut: 0,
                        personalCashOut: 0,
                        personalOnlineOut: 0
                    };
                }

                let cIn = 0;
                let oIn = 0;
                const pm = String(o.paymentMethod || 'Cash').toLowerCase();

                if (pm === 'split') {
                    cIn = Number(o.splitAmounts?.cash || 0);
                    oIn = Number(o.splitAmounts?.online || 0);
                } else if (pm.includes('online') || pm.includes('upi') || pm.includes('card')) {
                    oIn = Number(o.total || 0);
                } else {
                    cIn = Number(o.total || 0);
                }

                dailyData[nDate].cashIn += cIn;
                dailyData[nDate].onlineIn += oIn;
            }
        });

        expenses.forEach(e => {
            const nDate = normalizeDateStr(e.date);
            if (!nDate) return;

            if (!dailyData[nDate]) {
                dailyData[nDate] = {
                    cashIn: 0,
                    onlineIn: 0,
                    cashOut: 0,
                    onlineOut: 0,
                    personalCashOut: 0,
                    personalOnlineOut: 0
                };
            }

            const amount = Number(e.amount || 0);
            const isPersonal = e.personal_money === true;
            const isOnline = String(e.mode || '').toLowerCase() === 'online';

            if (isPersonal) {
                if (isOnline) {
                    dailyData[nDate].personalOnlineOut += amount;
                } else {
                    dailyData[nDate].personalCashOut += amount;
                }
            } else if (isOnline) {
                dailyData[nDate].onlineOut += amount;
            } else {
                dailyData[nDate].cashOut += amount;
            }
        });

        const sortedDates = Object.keys(dailyData).sort((a, b) => {
            const [da, ma, ya] = a.split('/');
            const [db, mb, yb] = b.split('/');
            const timeA = new Date(`${ya}-${ma}-${da}T00:00:00`).getTime();
            const timeB = new Date(`${yb}-${mb}-${db}T00:00:00`).getTime();
            return timeA - timeB;
        });

        let runningRemaining = 0;
        let totalLifetimeCashIn = 0;
        let totalLifetimeOnlineIn = 0;
        let totalLifetimeCashOut = 0;
        let totalLifetimeOnlineOut = 0;
        let totalLifetimePersonalCashOut = 0;
        let totalLifetimePersonalOnlineOut = 0;

        const ledger = {};

        sortedDates.forEach(date => {
            const day = dailyData[date];
            const initialAmount = runningRemaining;

            // Personal-money expenses are NOT deducted from business balance.
            const dayNet =
                (day.cashIn + day.onlineIn) -
                (day.cashOut + day.onlineOut);

            runningRemaining += dayNet;

            totalLifetimeCashIn += day.cashIn;
            totalLifetimeOnlineIn += day.onlineIn;
            totalLifetimeCashOut += day.cashOut;
            totalLifetimeOnlineOut += day.onlineOut;
            totalLifetimePersonalCashOut += day.personalCashOut;
            totalLifetimePersonalOnlineOut += day.personalOnlineOut;

            ledger[date] = {
                ...day,
                initialAmount,
                remainingAmount: runningRemaining
            };
        });

        const filterDateParts = expenseDateFilter.split('-');
        const displayFilterDate = filterDateParts.length === 3
            ? `${filterDateParts[2]}/${filterDateParts[1]}/${filterDateParts[0]}`
            : getFormattedDate();

        const todayStats = ledger[displayFilterDate] || {
            cashIn: 0,
            onlineIn: 0,
            cashOut: 0,
            onlineOut: 0,
            personalCashOut: 0,
            personalOnlineOut: 0,
            initialAmount: 0,
            remainingAmount: 0
        };

        const dayExpenses = expenses.filter(
            e => normalizeDateStr(e.date) === displayFilterDate
        );

        return {
            dateStr: displayFilterDate,
            initialAmount: todayStats.initialAmount,
            cashIn: todayStats.cashIn,
            onlineIn: todayStats.onlineIn,
            cashOut: todayStats.cashOut,
            onlineOut: todayStats.onlineOut,
            personalCashOut: todayStats.personalCashOut,
            personalOnlineOut: todayStats.personalOnlineOut,
            totalRem: todayStats.remainingAmount,

            lifetimeCashIn: totalLifetimeCashIn,
            lifetimeOnlineIn: totalLifetimeOnlineIn,
            lifetimeCashOut: totalLifetimeCashOut,
            lifetimeOnlineOut: totalLifetimeOnlineOut,
            lifetimePersonalCashOut: totalLifetimePersonalCashOut,
            lifetimePersonalOnlineOut: totalLifetimePersonalOnlineOut,

            lifetimeCashRem: totalLifetimeCashIn - totalLifetimeCashOut,
            lifetimeOnlineRem: totalLifetimeOnlineIn - totalLifetimeOnlineOut,
            lifetimeTotalRem: runningRemaining,

            dayExpenses
        };
    };

    const financials = calculateDailyFinancials();

    const getFilteredTransactions = () => {
        let filtered = orders.filter(o => o.paymentStatus === 'Paid');
        
        if (analyticsFilter === 'Custom') {
            const parts = analyticsCustomDate.split('-');
            const customD1 = `${parseInt(parts[2], 10).toString().padStart(2,'0')}/${parseInt(parts[1], 10).toString().padStart(2,'0')}/${parts[0]}`;
            const customD2 = `${parts[2]}/${parts[1]}/${parts[0]}`;
            filtered = filtered.filter(o => normalizeDateStr(o.date) === customD1 || normalizeDateStr(o.date) === customD2);
        } else if (analyticsFilter !== 'All') {
            const now = new Date();
            filtered = filtered.filter(o => {
                const orderDate = new Date(o.timestamp);
                if (analyticsFilter === 'Today') {
                    return orderDate.toDateString() === now.toDateString();
                } else if (analyticsFilter === 'Weekly') {
                    const diffDays = Math.ceil(Math.abs(now - orderDate) / (1000 * 60 * 60 * 24));
                    return diffDays <= 7;
                } else if (analyticsFilter === 'Monthly') {
                    return orderDate.getMonth() === now.getMonth() && orderDate.getFullYear() === now.getFullYear();
                } else if (analyticsFilter === 'Yearly') {
                    return orderDate.getFullYear() === now.getFullYear();
                }
                return true;
            });
        }
        return filtered.sort((a, b) => b.id - a.id);
    };

    const getAnalyticsData = () => {
        const map = {};
        const filteredTxns = getFilteredTransactions();

        filteredTxns.forEach(o => {
            const orderDate = new Date(o.timestamp);
            let key = '';
            
            if (analyticsFilter === 'Today' || analyticsFilter === 'Custom') {
                key = orderDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
            } else if (analyticsFilter === 'Weekly') {
                key = orderDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            } else if (analyticsFilter === 'Monthly') {
                key = orderDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            } else if (analyticsFilter === 'Yearly' || analyticsFilter === 'All') {
                key = orderDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            }

            if (!map[key]) map[key] = { name: key, sales: 0, ts: orderDate.getTime() };
            map[key].sales += Number(o.total) || 0;
        });
        
        return Object.values(map).sort((a, b) => a.ts - b.ts);
    };

    const handleFilterChange = (filter) => {
        setAnalyticsFilter(filter);
        setTransactionPage(1); 
    };

    const handleExportAnalytics = () => {
        const data = getFilteredTransactions().map(o => ({
            "Order ID": o.displayId || o.id,
            "Date": o.date,
            "Time": o.time,
            "Customer": o.customer?.name || 'Walk-in',
            "Amount": o.total,
            "Payment Method": o.paymentMethod === 'Split' ? `Split (Cash: ${o.splitAmounts?.cash}, Online: ${o.splitAmounts?.online})` : (o.paymentMethod || 'Cash')
        }));
        exportCSV(data, `Analytics_Export_${analyticsFilter}.csv`);
    };

    const filteredTxns = getFilteredTransactions();
    const txnsPerPage = 15;
    const totalTxnPages = Math.max(1, Math.ceil(filteredTxns.length / txnsPerPage));
    const currentTxns = filteredTxns.slice((transactionPage - 1) * txnsPerPage, transactionPage * txnsPerPage);

    const getSortedHistory = () => {
        let history = orders
            .filter(o => o.status === 'Picked Up' || o.status === 'Cancelled')
            .sort((a, b) => b.id - a.id);

        if (historyItemSearch.trim() !== '') {
            const query = historyItemSearch.toLowerCase();
            history = history.filter(order => {
                const itemsObj = order.items || {};
                const customArr = order.customItems || [];
                
                const hasRegularMatch = Object.keys(itemsObj).some(id => {
                    const mItem = menuItems.find(i => i.id === parseInt(id));
                    return mItem && mItem.name.toLowerCase().includes(query);
                });
                
                const hasCustomMatch = customArr.some(ci => ci.name.toLowerCase().includes(query));
                
                return hasRegularMatch || hasCustomMatch;
            });
        }

        return history;
    };

    const handleExportHistory = () => {
        const data = getSortedHistory().map(o => ({
            "Order ID": o.displayId || o.id,
            "Date": o.date,
            "Time": o.time,
            "Table": o.tableNo,
            "Customer": o.customer?.name || 'Walk-in',
            "Phone": o.customer?.phone || '',
            "Total Amount": o.total,
            "Items": o.item_names || '',
            "Payment Method": o.paymentMethod === 'Split' ? `Split (Cash: ${o.splitAmounts?.cash}, Online: ${o.splitAmounts?.online})` : (o.paymentMethod || 'Cash'),
            "Status": o.status
        }));
        exportCSV(data, 'Order_History.csv');
    };

    const getFilteredLiveOrders = () => {
        let live = orders.filter(o => o.status !== 'Picked Up' && o.status !== 'Cancelled');
        if (selectedTableFilter !== 'All') live = live.filter(o => String(o.tableNo) === String(selectedTableFilter));
        return live.sort((a,b) => b.timestamp - a.timestamp);
    };
    
    const pendingOrders = orders.filter(o => o.status === 'Received').length;
    const pendingPaymentOrdersCount = orders.filter(o => o.status === 'Picked Up' && o.paymentStatus === 'Pending').length;
    const pendingPaymentList = orders.filter(o => o.status === 'Picked Up' && o.paymentStatus === 'Pending').sort((a,b) => b.id - a.id);

    const filteredMenuSuggestions = menuItems.filter(i => i.name.toLowerCase().includes(billItemSearch.toLowerCase()));
    const filteredInvSuggestions = inventoryItems.filter(i => i.name.toLowerCase().includes(billItemSearch.toLowerCase()));
    const combinedSuggestions = [...filteredMenuSuggestions, ...filteredInvSuggestions];

    const getFormSuggestions = (query) => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const m = menuItems.filter(i => i.name.toLowerCase().includes(q));
        const inv = inventoryItems.filter(i => i.name.toLowerCase().includes(q) || (i.barcode && i.barcode.toLowerCase().includes(q)));
        return [...m, ...inv];
    };

    const combinedCustomSuggestions = getFormSuggestions(customItemForm.name);
    const staffModalSuggestions = getFormSuggestions(staffForm.name);
    const missingModalSuggestions = getFormSuggestions(missingForm.name);
    const historyItemSuggestions = getFormSuggestions(historyItemForm.name);

    const filteredCategoriesForMenu = categories.filter(cat => {
        if (!menuSearchQuery) return true;
        const lowerQ = menuSearchQuery.toLowerCase();
        const matchesCat = cat.name.toLowerCase().includes(lowerQ);
        const hasMatchingItem = menuItems.some(i => 
            i.category_id === cat.id && 
            (i.name.toLowerCase().includes(lowerQ) || (i.description && i.description.toLowerCase().includes(lowerQ)))
        );
        return matchesCat || hasMatchingItem;
    });

    const filteredInventory = inventoryItems
    .filter(item => {
        // 1. Match category filter ('All', 'Inventory', or 'Food')
        const matchesCategory = inventoryCategoryFilter === 'All' || item.category === inventoryCategoryFilter;
        
        // 2. Match search query (safely handling cases where barcode might be null/undefined)
        const matchesSearch = 
            item.name.toLowerCase().includes(inventorySearchQuery.toLowerCase()) || 
            (item.barcode || '').toLowerCase().includes(inventorySearchQuery.toLowerCase());
            
        return matchesCategory && matchesSearch;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

   return (
    <div className="h-screen w-full bg-slate-900 text-white font-sans flex overflow-hidden">
        
        {/* ADD THIS STYLE BLOCK TO HIDE SCROLLBARS */}
        <style dangerouslySetInnerHTML={{__html: `
            ::-webkit-scrollbar { display: none; }
            * { -ms-overflow-style: none; scrollbar-width: none; }
        `}} />

        <audio ref={audioRef} loop src={alertTone} />

        {/* --- CUSTOM VALO NOTIFICATION TOASTS --- */}
        <div className="fixed top-4 right-4 z-[600] w-[min(92vw,380px)] space-y-2 pointer-events-none">
            {appNotifications.map(note => (
                <div key={note.id} className={`pointer-events-auto bg-slate-800/95 backdrop-blur-xl border rounded-2xl shadow-2xl p-4 animate-fade-in ${note.type === 'danger' ? 'border-red-500/40' : note.type === 'success' ? 'border-green-500/40' : note.type === 'warning' ? 'border-yellow-500/40' : 'border-cyan-500/30'}`}>
                    <div className="flex items-start gap-3"><div className="text-xl">🔔</div><div className="min-w-0 flex-1"><p className="font-black text-white text-sm">{note.title}</p><p className="text-xs text-gray-300 mt-1">{note.body}</p></div><button type="button" onClick={() => setAppNotifications(prev => prev.filter(x => x.id !== note.id))} className="text-gray-500 hover:text-white">×</button></div>
                </div>
            ))}
        </div>

        {/* --- INSTALL VALO HELP --- */}
        {showInstallHelp && (
            <div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => setShowInstallHelp(false)}>
                <div className="bg-slate-800 border border-white/10 rounded-3xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-5"><div><h3 className="text-xl font-black text-white">Install VALO Admin</h3><p className="text-xs text-gray-400 mt-1">Use VALO like a real app.</p></div><button type="button" onClick={() => setShowInstallHelp(false)} className="text-gray-400 hover:text-white text-2xl">×</button></div>
                    <div className="space-y-3 text-sm text-gray-300">
                        <div className="bg-black/20 rounded-xl p-4"><b className="text-white">Chrome / Edge:</b><br/>Use <span className="text-cyan-400 font-bold">Install app</span> or <span className="text-cyan-400 font-bold">Add to Home screen</span> from the browser menu.</div>
                        <div className="bg-black/20 rounded-xl p-4"><b className="text-white">Safari on iPhone/iPad:</b><br/>Share → <span className="text-cyan-400 font-bold">Add to Home Screen</span> → Add → open VALO from the Home Screen, then enable notifications.</div>
                        <div className="bg-black/20 rounded-xl p-4"><b className="text-white">Safari on Mac:</b><br/>Use Safari's <span className="text-cyan-400 font-bold">Add to Dock</span> option when available.</div>
                    </div>
                    <button type="button" onClick={() => setShowInstallHelp(false)} className="w-full mt-5 bg-cyan-500 text-black font-black py-3 rounded-xl">Done</button>
                </div>
            </div>
        )}

{/* --- ADMIN OVERRIDE MODAL FOR MENU EDITS --- */}
            {actionAuth.open && (
                <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fade-in">
                    <div className="bg-slate-800 border border-white/10 p-10 rounded-[3rem] shadow-2xl text-center w-full max-w-sm relative">
                        <button onClick={() => setActionAuth({open: false, onConfirm: null})} className="absolute top-6 right-6 text-gray-400 hover:text-red-500 font-bold text-xl">✕</button>
                        
                        <div className="w-20 h-20 bg-red-500/10 rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-xl border border-red-500/20 text-3xl">🛡️</div>
                        <h2 className="text-2xl font-bold text-white mb-1 uppercase tracking-tight">Admin Override</h2>
                        <p className="text-gray-500 text-xs mb-8 uppercase font-bold tracking-widest">Enter Admin PIN to save changes</p>
                        
                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            const enteredPin = e.target.pin.value;
                            
                            const { data } = await supabase.from('app_settings').select('admin_pin').eq('id', 1).single();
                            const currentPin = data ? data.admin_pin : '6748'; 

                            if (enteredPin === currentPin) {
                                setActionAuth({open: false, onConfirm: null});
                                if (actionAuth.onConfirm) actionAuth.onConfirm();
                            } else {
                                alert("Incorrect PIN! Changes discarded.");
                                e.target.reset();
                            }
                        }} className="space-y-4">
                            <input name="pin" type="password" placeholder="••••" maxLength="4" autoFocus className="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-5 text-center text-red-400 text-3xl tracking-[0.5em] focus:outline-none focus:border-red-500 transition-all" />
                            <button type="submit" className="w-full bg-red-500 hover:bg-red-400 text-white font-black py-4 rounded-2xl transition-all shadow-lg active:scale-95 text-md tracking-wide">Confirm Action</button>
                        </form>
                    </div>
                </div>
            )}
            
            {/* CREATE BILL MODAL (MERGED) */}
            {createBillModal && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-900 border border-white/10 p-6 rounded-2xl w-full max-w-6xl max-h-[95vh] overflow-y-auto shadow-2xl relative scrollbar-hide">
                        <button onClick={() => setCreateBillModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                        <div className="space-y-6 pb-10">
                            <h2 className="text-2xl font-bold pr-10">Create New Bill</h2>

                            <div className="mb-4 p-4 bg-black/20 rounded-xl border border-white/5 shadow-inner">
                                <form onSubmit={handleBillBarcodeSubmit} className="flex gap-3">
                                    <div className="flex-1 relative">
                                        <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-xl">📷</span>
                                        <input 
                                            type="text" 
                                            placeholder="Scan Barcode to Quick-Add..." 
                                            className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white focus:border-cyan-500 outline-none transition"
                                            value={billBarcode}
                                            onChange={e => setBillBarcode(e.target.value)}
                                        />
                                    </div>
                                    <button type="submit" className="bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-lg transition shadow-lg">Scan</button>
                                </form>
                            </div>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 lg:col-span-1 space-y-4 h-fit">
                                    <h3 className="text-lg font-bold text-cyan-400 border-b border-white/10 pb-2">Customer Info</h3>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Name</label><input type="text" placeholder="Walk-in Customer" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billCustomerName} onChange={e=>setBillCustomerName(e.target.value)} /></div>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Phone Number</label><input type="text" placeholder="Optional" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billCustomerPhone} onChange={e=>setBillCustomerPhone(e.target.value)} /></div>
                                    <div><label className="text-xs text-gray-400 mb-1 block">Table / Location</label><input type="text" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billTableNo} onChange={e=>setBillTableNo(e.target.value)} /></div>
                                </div>

                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 lg:col-span-2 space-y-6">
                                    <h3 className="text-lg font-bold text-cyan-400 border-b border-white/10 pb-2">Add Items</h3>
                                    
                                    <div className="flex flex-col md:flex-row gap-3 relative">
                                        <div className="flex-1 relative">
                                            <input 
                                                type="text" 
                                                placeholder="Search menu or inventory..." 
                                                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" 
                                                value={billItemSearch} 
                                                onChange={(e) => { 
                                                    setBillItemSearch(e.target.value); 
                                                    setSelectedMenuId(null); 
                                                    setSelectedInvId(null);
                                                    setShowSuggestions(true); 
                                                }} 
                                                onFocus={() => setShowSuggestions(true)}
                                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                            />
                                            {showSuggestions && billItemSearch && (
                                                <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-48 overflow-y-auto z-[100]">
                                                    {combinedSuggestions.map(item => {
                                                        const isInv = item.barcode !== undefined;
                                                        return (
                                                            <div key={isInv ? `inv_${item.id}` : `menu_${item.id}`} onMouseDown={(e) => {
                                                                e.preventDefault();
                                                                handleSelectSuggestion(item, isInv);
                                                            }} className="p-3 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between items-center text-xs">
                                                                <span className="font-bold">{item.name} {isInv && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded" title="Inventory Item">📦 In Stock: {item.stock}</span>}</span>
                                                                <span className="font-bold font-mono text-xs">₹{item.price}</span>
                                                            </div>
                                                        );
                                                    })}
                                                    {combinedSuggestions.length === 0 && (
                                                        <div className="p-3 text-gray-400 text-xs italic">Press 'Add' to create as custom item</div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        <input type="number" placeholder="Price (₹)" className={`w-full md:w-28 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none ${(selectedMenuId || selectedInvId) ? 'opacity-50 cursor-not-allowed' : ''}`} value={billItemPrice} onChange={e=>setBillItemPrice(e.target.value)} disabled={!!selectedMenuId || !!selectedInvId} />
                                        <input type="number" placeholder="Qty" className="w-full md:w-20 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={billItemQty} onChange={e=>setBillItemQty(e.target.value)} min="1" />
                                        <button onClick={handleAddBillItem} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg transition shadow-lg shadow-cyan-500/20">Add</button>
                                    </div>

                                    <div className="bg-black/20 rounded-lg border border-white/5 overflow-hidden w-full max-w-[100vw] overflow-x-auto">
                                        <table className="w-full text-left text-sm text-gray-300 min-w-[450px]">
                                            <thead className="bg-black/40 text-xs uppercase">
                                                <tr>
                                                    <th className="p-3">Item</th>
                                                    <th className="p-3 text-right">Rate</th>
                                                    <th className="p-3 text-center w-24">Qty</th>
                                                    <th className="p-3 text-right">Total</th>
                                                    <th className="p-3 text-center"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {billItemsList.map((item) => (
                                                    <tr key={item.uniqueId} className="border-b border-white/5 last:border-0 hover:bg-white/5">
                                                        <td className="p-3 text-white font-medium">
                                                            {item.name} 
                                                            {item.isInv && <span className="text-[9px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded ml-2" title="Inventory Item">📦</span>}
                                                            {!item.menuId && !item.isInv && <span className="text-[9px] bg-cyan-500/20 text-cyan-400 px-1 rounded ml-1">CUSTOM</span>}
                                                        </td>
                                                        <td className="p-3 text-right text-gray-400">₹{item.price}</td>
                                                        
                                                        <td className="p-3 text-center">
                                                            <div className="flex items-center justify-center gap-2">
                                                                <button onClick={() => updateBillItemQty(item.uniqueId, item.qty - 1)} disabled={item.qty <= 1} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50">-</button>
                                                                <span className="font-bold w-4">{item.qty}</span>
                                                                <button onClick={() => updateBillItemQty(item.uniqueId, item.qty + 1)} className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition">+</button>
                                                            </div>
                                                        </td>

                                                        <td className="p-3 text-right text-cyan-400 font-bold">₹{item.price * item.qty}</td>
                                                        <td className="p-3 text-center"><button onClick={() => setBillItemsList(billItemsList.filter(i => i.uniqueId !== item.uniqueId))} className="text-red-400 hover:text-red-300 bg-red-500/10 p-1.5 rounded">✕</button></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {billItemsList.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No items added to bill yet.</div>}
                                    </div>

                                    <div className="flex flex-col md:flex-row justify-between items-center pt-4 border-t border-white/10 gap-4">
                                        <div className="text-lg text-gray-400">Grand Total: <span className="text-white font-bold text-3xl ml-2">₹{billItemsList.reduce((sum, i) => sum + (i.price * i.qty), 0)}</span></div>
                                        <button
    onClick={handleCreateBill}
    disabled={billItemsList.length === 0}
    className={`w-full md:w-auto px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
        billItemsList.length > 0
            ? 'bg-green-500 text-black hover:bg-green-400 shadow-lg shadow-green-500/20'
            : 'bg-slate-700 text-gray-500 cursor-not-allowed'
    }`}
>
    Create
</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

           {/* --- STAFF EXPENSES MODAL --- */}
            {staffModal.open && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl relative">
                        <h3 className="text-xl font-bold mb-4 text-cyan-400">Add Staff Expense</h3>
                        <form onSubmit={handleSaveStaffExpense} className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-400">Select Employee</label>
                                <select 
                                    className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 mb-2 outline-none focus:border-cyan-500"
                                    value={isCustomStaff ? 'custom' : staffForm.staff_name}
                                    onChange={(e) => {
                                        if (e.target.value === 'custom') {
                                            setIsCustomStaff(true);
                                            setStaffForm({...staffForm, staff_name: ''});
                                        } else {
                                            setIsCustomStaff(false);
                                            setStaffForm({...staffForm, staff_name: e.target.value});
                                        }
                                    }}
                                >
                                    <option value="" disabled>-- Select Staff Member --</option>
                                    {uniqueStaffNames.map(s => <option key={s} value={s}>{s}</option>)}
                                    <option value="custom" className="font-bold text-cyan-400">+ Add New Employee</option>
                                </select>
                                {isCustomStaff && (
                                    <input type="text" placeholder="Enter New Employee Name" className="w-full bg-black/50 border border-cyan-500/50 rounded-lg p-3 text-white outline-none" value={staffForm.staff_name} onChange={e => setStaffForm({...staffForm, staff_name: e.target.value})} required autoFocus />
                                )}
                            </div>
                            
                            {/* --- NEW: TOGGLE BETWEEN INVENTORY ITEM AND DIRECT MONEY --- */}
                            <div>
                                <label className="text-xs text-gray-400 mb-1 block">Expense Category</label>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setStaffForm({...staffForm, expenseType: 'item', name: '', price: '', qty: 1, isInv: false, invId: null, menuId: null, cashSource: 'Personal Money'})}
                                        className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition ${(!staffForm.expenseType || staffForm.expenseType === 'item') ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-black/30 text-gray-400 hover:text-white'}`}
                                    >
                                        📦 Inventory Item
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setStaffForm({...staffForm, expenseType: 'money', name: 'Money', price: '', qty: 1, isInv: false, invId: null, menuId: null, cashSource: 'Personal Money'})}
                                        className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition ${staffForm.expenseType === 'money' ? 'bg-green-500 text-black shadow-lg shadow-green-500/20' : 'bg-black/30 text-gray-400 hover:text-white'}`}
                                    >
                                        💵 Direct Money / Advance
                                    </button>
                                </div>
                            </div>

                            {/* --- CONDITIONAL FIELD RENDERING --- */}
                            {(!staffForm.expenseType || staffForm.expenseType === 'item') ? (
                                <div className="relative">
                                    <label className="text-xs text-gray-400">Search Item (Menu or Inventory)</label>
                                    <input 
                                        type="text" 
                                        placeholder="Search item..." 
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500"
                                        value={staffForm.name}
                                        onChange={e => {
                                            setStaffForm({...staffForm, name: e.target.value, menuId: null, invId: null, isInv: false});
                                            setStaffShowSugg(true);
                                        }}
                                        onFocus={() => setStaffShowSugg(true)}
                                        onBlur={() => setTimeout(() => setStaffShowSugg(false), 200)}
                                        required
                                    />
                                    {staffShowSugg && staffForm.name && (
                                        <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                                            {staffModalSuggestions.map(item => {
                                                const isInv = item.barcode !== undefined;
                                                return (
                                                    <div key={isInv ? `inv_${item.id}` : `menu_${item.id}`} onMouseDown={(e) => {
                                                        e.preventDefault();
                                                        setStaffForm({
                                                            ...staffForm,
                                                            name: item.name,
                                                            price: parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0,
                                                            menuId: isInv ? null : item.id,
                                                            invId: isInv ? item.id : null,
                                                            isInv: isInv
                                                        });
                                                        setStaffShowSugg(false);
                                                    }} className="p-3 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between items-center text-xs">
                                                        <span className="font-bold">{item.name} {isInv && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded" title="Inventory Item">📦 In Stock: {item.stock}</span>}</span>
                                                        <span className="font-bold font-mono text-xs">₹{item.price}</span>
                                                    </div>
                                                );
                                            })}
                                            {staffModalSuggestions.length === 0 && <div className="p-3 text-gray-400 text-xs italic">Custom item will be created. Type price manually.</div>}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div>
                                    <label className="text-xs text-gray-400">Expense Type</label>
                                    <input 
                                        type="text" 
                                        value="Money (Direct Cash / Advance)" 
                                        disabled 
                                        className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-green-400 font-bold mt-1 cursor-not-allowed" 
                                    />
                                </div>
                            )}

                            {staffForm.expenseType === 'money' && (
                                <div>
                                    <label className="text-xs text-gray-400">Cash Given From</label>
                                    <select
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500"
                                        value={staffForm.cashSource || 'Personal Money'}
                                        onChange={e => setStaffForm({...staffForm, cashSource: e.target.value})}
                                    >
                                        <option value="Personal Money">👤 Personal Money</option>
                                        <option value="Daily Cash Box">💵 Daily Cash Box</option>
                                    </select>
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        Personal Money does not reduce Daily Cash Box. Daily Cash Box reduces the hotel cash drawer.
                                    </p>
                                </div>
                            )}

                            <div className="flex gap-4">
                                {(!staffForm.expenseType || staffForm.expenseType === 'item') && (
                                    <div className="flex-1">
                                        <label className="text-xs text-gray-400">Quantity</label>
                                        <input type="number" min="1" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" value={staffForm.qty} onChange={e => setStaffForm({...staffForm, qty: e.target.value})} required />
                                    </div>
                                )}
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400">{staffForm.expenseType === 'money' ? 'Amount Given (₹)' : 'Price per unit (₹)'}</label>
                                    <input type="number" min="0" className={`w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none ${staffForm.menuId || staffForm.invId ? 'opacity-50 cursor-not-allowed' : 'focus:border-cyan-500'}`} value={staffForm.price} onChange={e => setStaffForm({...staffForm, price: e.target.value})} disabled={!!staffForm.menuId || !!staffForm.invId} required />
                                </div>
                            </div>
                            
                            <div className="flex justify-between items-center bg-black/50 p-3 rounded-lg border border-white/5">
                                <span className="text-sm text-gray-400">Total Deduction:</span>
                                <span className="text-xl font-black text-red-400">-₹{(staffForm.expenseType === 'money' ? 1 : (Number(staffForm.qty) || 0)) * (Number(staffForm.price) || 0)}</span>
                            </div>

                            <div className="flex gap-2 mt-4">
                                <button type="button" onClick={() => setStaffModal({open: false})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl hover:bg-red-500 hover:text-white transition">Cancel</button>
                                <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl hover:bg-cyan-400 transition">Confirm Deduction</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

           {/* --- MISSING & DEFECTIVE MODAL --- */}
            {missingModal.open && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl relative">
                        <button onClick={() => setMissingModal({open: false})} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                        <h3 className="text-xl font-bold mb-4 text-orange-400">Record Loss / Defect</h3>
                        
                        <form onSubmit={handleSaveMissingItem} className="space-y-4">
                            <div>
                                <label className="text-xs text-gray-400">Record Type</label>
                                <select name="type" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-orange-500">
                                    <option value="Missing">❓ Missing / Stolen</option>
                                    <option value="Defective">💔 Defective / Expired / Damaged</option>
                                </select>
                            </div>

                            <div className="relative">
                                <label className="text-xs text-gray-400">Item Name</label>
                                <input 
                                    type="text" 
                                    placeholder="Search inventory..." 
                                    className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-orange-500"
                                    value={missingForm.name}
                                    onChange={e => {
                                        setMissingForm({...missingForm, name: e.target.value, invId: null, isInv: false});
                                    }}
                                    required 
                                />
                                {/* Suggestions dropdown logic */}
                                {missingForm.name && (
                                    <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                                        {inventoryItems.filter(i => i.name.toLowerCase().includes(missingForm.name.toLowerCase())).map(item => (
                                            <div key={item.id} onClick={() => {
                                                setMissingForm({
                                                    ...missingForm,
                                                    name: item.name,
                                                    price: item.price,
                                                    invId: item.id,
                                                    isInv: true
                                                });
                                            }} className="p-3 hover:bg-orange-500 hover:text-black cursor-pointer border-b border-white/5 flex justify-between text-xs items-center">
                                                <span className="font-bold">{item.name} <span className="text-[10px] text-cyan-400">Stock: {item.stock}</span></span>
                                                <span className="font-bold">₹{item.price}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400">Quantity</label>
                                    <input 
                                        type="number" 
                                        min="1" 
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-orange-500"
                                        value={missingForm.qty}
                                        onChange={e => setMissingForm({...missingForm, qty: e.target.value})}
                                        required 
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-gray-400">Price (Ea)</label>
                                    <input 
                                        type="number" 
                                        min="0" 
                                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-orange-500"
                                        value={missingForm.price}
                                        onChange={e => setMissingForm({...missingForm, price: e.target.value})}
                                        required 
                                    />
                                </div>
                            </div>

                            <div className="flex gap-2 mt-6">
                                <button type="button" onClick={() => setMissingModal({open: false})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl font-bold">Cancel</button>
                                <button type="submit" className="flex-1 bg-orange-500 hover:bg-orange-400 text-white font-bold py-3 rounded-xl transition shadow-lg">Save Record</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

         {/* --- PURCHASE MODAL --- */}
{purchaseModal.open && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10 shadow-2xl relative">
            <h3 className="text-xl font-bold mb-4 text-green-400">Record Stock Purchase</h3>
            <p className="text-xs text-gray-400 mb-4">Selecting an item below will automatically increase its stock count.</p>
            <form onSubmit={handleSavePurchase} className="space-y-4">
                
                {/* --- NEW: CATEGORY SELECTOR (Food vs Inventory) --- */}
                <div>
                    <label className="text-xs text-gray-400 mb-1 block">Purchase Category</label>
                    <select 
                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500 font-bold" 
                        value={purchaseForm.type} 
                        onChange={e => setPurchaseForm({...purchaseForm, type: e.target.value, name: '', invId: ''})}
                    >
                        <option value="Inventory">📦 Inventory</option>
                        <option value="Food">🍔 Food</option>
                    </select>
                </div>

                <div className="relative">
                    <label className="text-xs text-gray-400">
                        {purchaseForm.type === 'Inventory' ? 'Search Existing Inventory' : 'Enter or Select Food Item'}
                    </label>
                    <input 
                        type="text" 
                        placeholder={purchaseForm.type === 'Inventory' ? "Search inventory to restock..." : "Type food item name..."} 
                        className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500" 
                        value={purchaseForm.name} 
                        onChange={e => { setPurchaseForm({...purchaseForm, name: e.target.value, invId: null}); setPurchaseShowSugg(true); }} 
                        onFocus={() => setPurchaseShowSugg(true)} 
                        onBlur={() => setTimeout(() => setPurchaseShowSugg(false), 200)} 
                        required 
                    />
                    
                    {/* --- FILTERED SUGGESTIONS DROPDOWN --- */}
                    {purchaseShowSugg && purchaseForm.name && purchaseForm.type === 'Inventory' && (
                        <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                            {inventoryItems
                                .filter(i => i.name.toLowerCase().includes(purchaseForm.name.toLowerCase()))
                                .map(item => (
                                    <div key={item.id} onMouseDown={(e) => { e.preventDefault(); setPurchaseForm({...purchaseForm, name: item.name, invId: item.id}); setPurchaseShowSugg(false); }} className="p-3 hover:bg-green-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between items-center text-xs">
                                        <span className="font-bold">{item.name} <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded">Current Stock: {item.stock}</span></span>
                                    </div>
                                ))}
                        </div>
                    )}
                </div>

                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-gray-400">Qty Bought</label>
                        <input type="number" min="1" step="any" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500" value={purchaseForm.qty} onChange={e => setPurchaseForm({...purchaseForm, qty: e.target.value})} required />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs text-gray-400">Price per unit (₹)</label>
                        <input type="number" min="0" className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500" value={purchaseForm.price} onChange={e => setPurchaseForm({...purchaseForm, price: e.target.value})} required />
                    </div>
                </div>
                
                <div>
                    <label className="text-xs text-gray-400">Paid Via</label>
                    <select className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-green-500" value={purchaseForm.mode} onChange={e => setPurchaseForm({...purchaseForm, mode: e.target.value})}>
                        <option value="Cash">Cash</option>
                        <option value="Online">Online</option>
                    </select>
                </div>

                <label className="flex items-center gap-3 bg-black/30 border border-white/10 rounded-lg p-3 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={purchaseForm.personalMoney === true}
                        onChange={e => setPurchaseForm({...purchaseForm, personalMoney: e.target.checked})}
                        className="w-4 h-4 accent-orange-500"
                    />
                    <span className="text-sm text-white font-bold">Paid with Personal Money</span>
                    <span className="text-[10px] text-gray-500 ml-auto">Does not reduce Daily Box</span>
                </label>

                <div className="flex justify-between items-center bg-black/50 p-3 rounded-lg border border-white/5">
                    <span className="text-sm text-gray-400">Total Purchase Cost:</span>
                    <span className="text-xl font-black text-red-400">₹{(Number(purchaseForm.qty) || 0) * (Number(purchaseForm.price) || 0)}</span>
                </div>
                
                <div className="flex gap-2 mt-4">
                    <button type="button" onClick={() => setPurchaseModal({open: false})} className="flex-1 bg-slate-700 text-white py-3 rounded-xl hover:bg-slate-600 transition">Cancel</button>
                    <button type="submit" className="flex-1 bg-green-500 text-black font-bold py-3 rounded-xl hover:bg-green-400 transition">Save Purchase</button>
                </div>
            </form>
        </div>
    </div>
)}

            {/* --- PURCHASE ITEM DETAILS MODAL --- */}
            {selectedPurchaseItem && (() => {
                const records = purchasesData.filter(p => p.item_name === selectedPurchaseItem);
                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-2xl border border-white/10 shadow-2xl relative max-h-[80vh] flex flex-col">
                            <button onClick={() => setSelectedPurchaseItem(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                            <h3 className="text-2xl font-bold mb-1 text-white pr-8">{selectedPurchaseItem}</h3>
                            <p className="text-xs text-gray-400 mb-4">Detailed log of all purchases for this item.</p>
                            
                            <div className="overflow-y-auto flex-1 bg-black/20 rounded-xl border border-white/5">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-black/40 text-xs uppercase sticky top-0">
                                        <tr>
                                            <th className="p-3">Date</th>
                                            <th className="p-3 text-center">Qty</th>
                                            <th className="p-3 text-right">Rate</th>
                                            <th className="p-3 text-right">Total</th>
                                            <th className="p-3 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {records.map(r => (
                                            <tr key={r.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-3 whitespace-nowrap">{r.date} <span className="text-[10px] text-gray-500">{r.time}</span></td>
                                                <td className="p-3 text-center font-bold text-green-400">+{r.qty}</td>
                                                <td className="p-3 text-right text-gray-500">₹{r.unit_price}</td>
                                                <td className="p-3 text-right font-bold text-red-400">₹{r.total_cost}</td>
                                                <td className="p-3 text-center">
                                                    <button onClick={() => deletePurchase(r.id)} className="bg-red-500/10 text-red-400 p-1.5 rounded hover:bg-red-500 hover:text-white transition" title="Delete Record">🗑</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {records.length === 0 && (
                                    <div className="p-8 text-center text-gray-500">
                                        No purchase history found for this item yet. <button onClick={() => setSelectedPurchaseItem(null)} className="text-cyan-400 font-bold ml-2 hover:underline">Close</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

           {/* --- HISTORY EDIT MODAL --- */}
            {editHistoryModal.open && (
                <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-3xl border border-white/10 shadow-2xl relative max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setEditHistoryModal({open: false, order: null, tempMethod: 'Cash'})} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                        <h3 className="text-xl font-bold mb-6 border-b border-white/10 pb-4">Edit Order #{editHistoryModal.order.displayId || editHistoryModal.order.id}</h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            
                            {/* LEFT COLUMN: ITEMS */}
                            <div className="space-y-4">
                                <h4 className="font-bold text-cyan-400">Order Items</h4>
                                
                                {/* Current Items List */}
                                <div className="bg-black/30 rounded-lg p-3 max-h-48 overflow-y-auto border border-white/5 space-y-2 text-sm">
                                    {Object.entries(editHistoryModal.order.items || {}).map(([id, qty]) => {
                                        const mItem = menuItems.find(i => i.id === parseInt(id));
                                        const price = mItem ? parseInt(String(mItem.price).replace(/[^0-9]/g, '')) : 0;
                                        return (
                                            <div key={`menu_${id}`} className="flex justify-between items-center border-b border-white/5 pb-2 last:border-0 last:pb-0">
                                                <div><span className="text-white">{qty}x {mItem?.name || 'Item'}</span></div>
                                                <div className="text-cyan-400 font-bold">₹{price * qty}</div>
                                            </div>
                                        );
                                    })}
                                    {(editHistoryModal.order.customItems || []).map(cItem => (
                                        <div key={cItem.id} className="flex justify-between items-center border-b border-white/5 pb-2 last:border-0 last:pb-0">
                                            <div><span className="text-white">{cItem.qty}x {cItem.name} {cItem.isInv && '📦'}</span></div>
                                            <div className="text-cyan-400 font-bold">₹{cItem.price * cItem.qty}</div>
                                        </div>
                                    ))}
                                    {Object.keys(editHistoryModal.order.items || {}).length === 0 && (editHistoryModal.order.customItems || []).length === 0 && <div className="text-xs text-gray-500 italic">No items in this order.</div>}
                                </div>

                                {/* Add New Item Form */}
                                <div className="bg-slate-700/50 p-4 rounded-lg border border-white/10 space-y-3">
                                    <h5 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Add Forgotten Item</h5>
                                    <div className="relative">
                                        <input 
                                            type="text" 
                                            placeholder="Search menu or inventory..." 
                                            className="w-full bg-black/50 border border-white/10 rounded p-3 text-sm text-white outline-none focus:border-cyan-500"
                                            value={historyItemForm.name}
                                            onChange={e => {
                                                setHistoryItemForm({...historyItemForm, name: e.target.value, menuId: null, invId: null, isInv: false});
                                                setHistoryItemSugg(true);
                                            }}
                                            onFocus={() => setHistoryItemSugg(true)}
                                            onBlur={() => setTimeout(() => setHistoryItemSugg(false), 200)}
                                        />
                                        {historyItemSugg && historyItemForm.name && (
                                            <div className="absolute top-full left-0 w-full mt-1 bg-slate-600 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                                                {historyItemSuggestions.map(item => {
                                                    const isInv = item.barcode !== undefined;
                                                    return (
                                                        <div key={isInv ? `inv_${item.id}` : `menu_${item.id}`} onMouseDown={(e) => {
                                                            e.preventDefault();
                                                            setHistoryItemForm({
                                                                ...historyItemForm,
                                                                name: item.name,
                                                                price: parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0,
                                                                menuId: isInv ? null : item.id,
                                                                invId: isInv ? item.id : null,
                                                                isInv: isInv
                                                            });
                                                            setHistoryItemSugg(false);
                                                        }} className="p-3 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between text-xs items-center">
                                                            <span className="font-bold">{item.name} {isInv && <span className="ml-2 bg-blue-500/20 text-blue-400 px-1 rounded text-[10px]">📦 Stock: {item.stock}</span>}</span>
                                                            <span className="font-bold">₹{item.price}</span>
                                                        </div>
                                                    );
                                                })}
                                                {historyItemSuggestions.length === 0 && <div className="p-3 text-gray-400 text-[10px]">Will be added as a custom entry.</div>}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        <input type="number" placeholder="Qty" min="1" className="w-20 bg-black/50 border border-white/10 rounded p-3 text-sm text-white outline-none focus:border-cyan-500" value={historyItemForm.qty} onChange={e => setHistoryItemForm({...historyItemForm, qty: e.target.value})} />
                                        <input type="number" placeholder="Price (₹)" min="0" className={`w-28 bg-black/50 border border-white/10 rounded p-3 text-sm text-white outline-none focus:border-cyan-500 ${historyItemForm.menuId || historyItemForm.invId ? 'opacity-50 cursor-not-allowed' : ''}`} value={historyItemForm.price} onChange={e => setHistoryItemForm({...historyItemForm, price: e.target.value})} disabled={!!historyItemForm.menuId || !!historyItemForm.invId} />
                                        <button type="button" onClick={handleHistoryAddItem} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-4 rounded transition shadow-lg">Add</button>
                                    </div>
                                </div>
                            </div>

                            {/* RIGHT COLUMN: PAYMENT & STATUS */}
                            <div className="space-y-4 border-l-0 md:border-l border-white/10 md:pl-8">
                                <form id="historyEditForm" onSubmit={handleSaveHistoryEdit} className="space-y-4">
                                    <div>
                                        <label className="text-xs text-gray-400 font-bold uppercase tracking-widest">Total Amount (₹)</label>
                                        <input name="total" type="number" value={editHistoryModal.order.total} onChange={e => setEditHistoryModal({...editHistoryModal, order: {...editHistoryModal.order, total: e.target.value}})} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 text-2xl font-black text-cyan-400 outline-none focus:border-cyan-500" required />
                                        <p className="text-[10px] text-gray-500 mt-1">Total auto-updates when items are added.</p>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400">Status</label>
                                        <select name="status" defaultValue={editHistoryModal.order.status} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500">
                                            <option value="Picked Up">Picked Up</option>
                                            <option value="Cancelled">Cancelled</option>
                                            <option value="Ready">Ready</option>
                                            <option value="Preparing">Preparing</option>
                                            <option value="Received">Received</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400">Payment Status</label>
                                        <select name="paymentStatus" defaultValue={editHistoryModal.order.paymentStatus || 'Pending'} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500">
                                            <option value="Paid">Paid</option>
                                            <option value="Pending">Pending</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400">Payment Method</label>
                                        <select name="paymentMethod" defaultValue={editHistoryModal.order.paymentMethod || 'Cash'} onChange={(e) => setEditHistoryModal({...editHistoryModal, tempMethod: e.target.value})} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500">
                                            <option value="Cash">Cash</option>
                                            <option value="Online">Online</option>
                                            <option value="Split">Split</option>
                                        </select>
                                    </div>
                                    
                                    {(editHistoryModal.tempMethod === 'Split' || (editHistoryModal.order.paymentMethod === 'Split' && !editHistoryModal.tempMethod)) && (
                                        <div className="flex gap-4">
                                            <div className="flex-1"><label className="text-xs text-gray-400">Cash Split (₹)</label><input name="splitCash" type="number" defaultValue={editHistoryModal.order.splitAmounts?.cash || ''} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required /></div>
                                            <div className="flex-1"><label className="text-xs text-gray-400">Online Split (₹)</label><input name="splitOnline" type="number" defaultValue={editHistoryModal.order.splitAmounts?.online || ''} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required /></div>
                                        </div>
                                    )}
                                </form>
                            </div>
                        </div>
                        
                        <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-white/10">
                            <button type="button" onClick={() => setEditHistoryModal({open: false, order: null, tempMethod: 'Cash'})} className="bg-slate-700 text-white font-bold px-8 py-3 rounded-xl hover:bg-slate-600 transition">Cancel</button>
                            <button type="submit" form="historyEditForm" className="bg-cyan-500 text-black font-bold px-8 py-3 rounded-xl hover:bg-cyan-400 transition shadow-lg shadow-cyan-500/20">Save Everything</button>
                        </div>
                    </div>
                </div>
            )}

            
          {/* --- INVENTORY MODAL --- */}
{invModal.open && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
        <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-sm border border-white/10 shadow-2xl relative">
            <h3 className="text-xl font-bold mb-4">{invModal.mode === 'edit' ? 'Edit Inventory Item' : 'Add Inventory Item'}</h3>
            <form onSubmit={handleSaveInventory} className="space-y-4">
                <div>
                    <label className="text-xs text-gray-400">Item Name</label>
                    <input name="name" defaultValue={invModal.data?.name} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required />
                </div>
                <div>
                    <label className="text-xs text-gray-400">Category</label>
                    <select name="category" defaultValue={invModal.data?.category || 'Inventory'} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500 font-bold">
                        <option value="Inventory">📦 Inventory</option>
                        <option value="Food">🍔 Food</option>
                    </select>
                </div>
                <div>
                    <label className="text-xs text-gray-400">Barcode</label>
                    <input name="barcode" defaultValue={invModal.data?.barcode} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required />
                </div>
                <div className="flex gap-4">
                    <div className="flex-1">
                        <label className="text-xs text-gray-400">Stock Qty</label>
                        <input name="stock" type="number" min="0" defaultValue={invModal.data?.stock} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs text-gray-400">Price (₹)</label>
                        <input name="price" type="number" min="0" defaultValue={invModal.data?.price} className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white mt-1 outline-none focus:border-cyan-500" required />
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <button type="button" onClick={() => setInvModal({open: false, mode: 'add', data: null})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl hover:bg-red-500 hover:text-white transition">Cancel</button>
                    <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl hover:bg-cyan-400 transition">Save</button>
                </div>
            </form>
        </div>
    </div>
)}

            {/* --- EYE ICON MODAL (ORDER DETAILS) --- */}
            {viewOrderDetails && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-white p-6 rounded-2xl w-full max-w-sm text-black shadow-2xl relative max-h-[90vh] overflow-y-auto">
                        <button onClick={() => setViewOrderDetails(null)} className="absolute top-4 right-4 text-black hover:text-red-500 font-bold text-xl transition">✕</button>
                        
                        <div className="text-center font-black text-xl mb-1">VALO HOTEL</div>
                        <div className="text-center text-sm mb-4 border-b border-black/20 pb-4">Order Receipt</div>
                        
                        <div className="text-sm space-y-1 mb-4">
                            <div className="flex justify-between"><span>Order:</span><span className="font-bold">#{viewOrderDetails.displayId || viewOrderDetails.id}</span></div>
                            <div className="flex justify-between"><span>Date:</span><span className="font-bold">{viewOrderDetails.date} {viewOrderDetails.time}</span></div>
                            <div className="flex justify-between"><span>Table:</span><span className="font-bold">{viewOrderDetails.tableNo}</span></div>
                            <div className="flex justify-between"><span>Customer:</span><span className="font-bold">{viewOrderDetails.customer?.name || 'Walk-in'}</span></div>
                            <div className="flex justify-between"><span>Phone:</span><span className="font-bold">{viewOrderDetails.customer?.phone || 'N/A'}</span></div>
                        </div>
                        
                        <table className="w-full text-sm mb-4">
                            <thead>
                                <tr className="border-b border-black/20">
                                    <th className="text-left py-1 w-12">Qty</th>
                                    <th className="text-left py-1">Item</th>
                                    <th className="text-right py-1">Amt</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Render regular items */}
                                {Object.entries(viewOrderDetails.items || {}).map(([id, qty]) => {
                                    const item = menuItems.find(i => i.id === parseInt(id));
                                    const priceStr = item ? item.price : '₹0';
                                    const numericPrice = parseInt(String(priceStr).replace(/[^0-9]/g, '')) || 0;
                                    return (
                                        <tr key={id} className="border-b border-black/10 last:border-0">
                                            <td className="py-2">{qty}x</td>
                                            <td className="py-2 leading-tight">
                                                {item?.name || 'Deleted Item'}
                                                <div className="text-[10px] text-gray-500">@{priceStr}</div>
                                            </td>
                                            <td className="py-2 text-right">₹{numericPrice * qty}</td>
                                        </tr>
                                    );
                                })}
                                {/* Render custom/inventory items */}
                                {(viewOrderDetails.customItems || []).map((c, i) => (
                                    <tr key={`c_${i}`} className="border-b border-black/10 last:border-0">
                                        <td className="py-2">{c.qty}x</td>
                                        <td className="py-2 leading-tight">
                                            {c.name} {c.isInv ? '📦' : '*'}
                                            <div className="text-[10px] text-gray-500">@₹{c.price}</div>
                                        </td>
                                        <td className="py-2 text-right">₹{c.price * c.qty}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        
                        <div className="border-t border-black/20 pt-2 mb-4 text-sm font-bold">
                            <div className="flex justify-between text-lg"><span>Total:</span><span>₹{viewOrderDetails.total}</span></div>
                            <div className="flex justify-between mt-2 text-gray-600 text-xs">
                                <span>Status:</span>
                                <span>{viewOrderDetails.paymentStatus === 'Paid' ? `Paid (${viewOrderDetails.paymentMethod})` : 'Pending'}</span>
                            </div>
                            {viewOrderDetails.paymentMethod === 'Split' && viewOrderDetails.splitAmounts && (
                                <div className="flex justify-between mt-1 text-gray-600 text-[10px] bg-gray-100 p-1.5 rounded">
                                    <span>Split Details:</span>
                                    <span>Cash ₹{viewOrderDetails.splitAmounts.cash} | Online ₹{viewOrderDetails.splitAmounts.online}</span>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 text-xs">
                            <div className="bg-gray-100 rounded-lg p-2 text-gray-700">
                                <span className="font-bold">Created by:</span> {viewOrderDetails.created_by_name || 'Before tracking'}
                            </div>
                            <div className="bg-gray-100 rounded-lg p-2 text-gray-700">
                                <span className="font-bold">Last updated by:</span> {viewOrderDetails.last_updated_by_name || 'Before tracking'}
                            </div>
                        </div>
                        <button type="button" onClick={() => { setViewOrderDetails(null); }} className="w-full bg-slate-200 hover:bg-slate-300 text-black font-bold py-3 rounded-xl transition">Close</button>
                    </div>
                </div>
            )}


            {orderActivityModal.open && (
                <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
                        <div className="flex items-center justify-between p-5 border-b border-white/10">
                            <div>
                                <h3 className="text-xl font-black text-white">Order #{orderActivityModal.orderLabel} Activity</h3>
                                <p className="text-xs text-gray-400 mt-1">Who created, changed, paid, completed or modified this order.</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOrderActivityModal({ open: false, orderId: null, orderLabel: '', rows: [], loading: false })}
                                className="text-gray-400 hover:text-white text-2xl px-2"
                            >×</button>
                        </div>

                        <div className="p-5 overflow-y-auto space-y-3">
                            {orderActivityModal.loading ? (
                                <div className="py-10 text-center text-gray-400">Loading activity...</div>
                            ) : orderActivityModal.rows.length === 0 ? (
                                <div className="py-10 text-center">
                                    <div className="text-3xl mb-2">🕘</div>
                                    <p className="text-gray-400">No activity recorded for this order.</p>
                                    <p className="text-xs text-gray-600 mt-1">Orders created before operator tracking may have no history.</p>
                                </div>
                            ) : (
                                orderActivityModal.rows.map(row => (
                                    <div key={row.id} className="bg-black/20 border border-white/5 rounded-xl p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className="font-bold text-white">{row.operator_name || 'Unknown'}</span>
                                                    {row.operator_role && (
                                                        <span className="text-[9px] text-gray-500 uppercase font-bold">
                                                            {row.operator_role}
                                                        </span>
                                                    )}
                                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                                        row.action === 'ITEM_ADDED'
                                                            ? 'bg-green-500/15 text-green-400'
                                                            : row.action === 'ITEM_REMOVED'
                                                                ? 'bg-red-500/15 text-red-400'
                                                                : row.action === 'COMPLETED'
                                                                    ? 'bg-blue-500/15 text-blue-400'
                                                                    : row.action === 'PAYMENT_UPDATED'
                                                                        ? 'bg-purple-500/15 text-purple-400'
                                                                        : row.action === 'STATUS_CHANGED'
                                                                            ? 'bg-yellow-500/15 text-yellow-400'
                                                                            : 'bg-cyan-500/15 text-cyan-400'
                                                    }`}>
                                                        {row.action === 'ITEM_ADDED'
                                                            ? 'Item Added'
                                                            : row.action === 'ITEM_REMOVED'
                                                                ? 'Item Removed'
                                                                : row.action === 'COMPLETED'
                                                                    ? 'Order Completed'
                                                                    : row.action === 'PAYMENT_UPDATED'
                                                                        ? 'Payment Updated'
                                                                        : row.action === 'STATUS_CHANGED'
                                                                            ? 'Status Changed'
                                                                            : 'Order Updated'}
                                                    </span>
                                                </div>
                                                <p className="text-sm text-gray-300 mt-2 break-words">{row.description || 'Order updated.'}</p>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <div className="text-[10px] text-gray-500">{row.created_at ? getFormattedDate(new Date(row.created_at)) : ''}</div>
                                                <div className="text-[10px] text-gray-500">{row.created_at ? getFormattedTime(new Date(row.created_at)) : ''}</div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="p-4 border-t border-white/10">
                            <button
                                type="button"
                                onClick={() => setOrderActivityModal({ open: false, orderId: null, orderLabel: '', rows: [], loading: false })}
                                className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl"
                            >Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {adminPaymentModal.open && (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-sm border border-white/10 text-center shadow-2xl animate-scale-in">
            {!isSplitMode ? (
                <>
                    <h3 className="text-xl font-bold mb-6 text-white">Select Payment Method</h3>
                    <div className="flex gap-4 mb-4">
                        <button onClick={() => handleAdminMarkPaid('Cash')} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Cash</button>
                        <button onClick={() => handleAdminMarkPaid('Online')} className="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Online</button>
                    </div>
                    <div className="flex gap-4 mb-4">
                        <button onClick={() => setIsSplitMode(true)} className="flex-1 bg-purple-500 hover:bg-purple-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Split Payment</button>
                        
                        {/* --- NEW PENDING BUTTON --- */}
                        <button onClick={() => handleAdminMarkPaid('Pending')} className="flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Pending</button>
                    </div>
                    
                    <button onClick={() => { setAdminPaymentModal({ open: false, orderId: null, total: null }); setIsSplitMode(false); }} className="mt-4 text-gray-400 hover:text-white text-sm font-bold w-full p-2">Cancel</button>
                </>
            ) : (
                <>
                    <h3 className="text-xl font-bold mb-2 text-white">Split Payment</h3>
                    <div className="text-sm font-bold text-cyan-400 mb-6 bg-cyan-500/10 py-2 rounded-lg">Bill Total: ₹{adminPaymentModal.total}</div>
                    
                    <div className="space-y-4 mb-6 text-left">
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block uppercase font-bold tracking-widest">Cash Amount (₹)</label>
                            <input type="number" value={splitCash} onChange={e => setSplitCash(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-white focus:border-green-500 outline-none transition" placeholder="0" />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block uppercase font-bold tracking-widest">Online Amount (₹)</label>
                            <input type="number" value={splitOnline} onChange={e => setSplitOnline(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-white focus:border-blue-500 outline-none transition" placeholder="0" />
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button onClick={() => setIsSplitMode(false)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition">Back</button>
                        <button onClick={() => {
                            const c = Number(splitCash);
                            const o = Number(splitOnline);
                            if (c + o !== Number(adminPaymentModal.total)) {
                                alert(`The split amounts (₹${c + o}) must equal the exact Bill Total (₹${adminPaymentModal.total})`);
                                return;
                            }
                            handleAdminMarkPaid('Split', { cash: c, online: o });
                        }} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-xl transition">Confirm</button>
                    </div>
                </>
            )}
        </div>

       
    </div>
)}

       {itemModal.open && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">{itemModal.mode === 'edit' ? 'Edit Item' : 'Add Item'}</h3>
                        <form onSubmit={handleSaveItem} className="space-y-4">
                            <select name="category" defaultValue={itemModal.data?.category_id} className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white">{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                            <input name="name" defaultValue={itemModal.data?.name} placeholder="Item Name" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <input name="price" type="number" defaultValue={itemModal.data?.price?.replace(/\D/g,'')} placeholder="Price" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <textarea name="desc" defaultValue={itemModal.data?.description} placeholder="Description" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white"></textarea>
                            <div><label className="text-xs text-gray-400">Image (File)</label><input type="file" name="image" className="w-full mt-1 text-sm text-gray-400" /></div>
                            <div className="flex gap-2"><button type="button" onClick={() => setItemModal({open:false, mode:'add', data:null})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button><button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Save</button></div>
                        </form>
                    </div>
                </div>
            )}
            
            {catModal && ( 
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">New Category</h3>
                        <form onSubmit={handleSaveCategory} className="space-y-4">
                            <input name="name" placeholder="Category Name" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <input type="file" name="image" className="w-full text-sm text-gray-400" required />
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setCatModal(false)} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button>
                                <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">Create</button>
                            </div>
                        </form>
                    </div>
                </div> 
            )}

            {momentModal.open && ( 
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-md border border-white/10">
                        <h3 className="text-xl font-bold mb-4">{momentModal.mode === 'edit' ? 'Edit Moment' : 'Upload Moment'}</h3>
                        <form onSubmit={handleSaveMoment} className="space-y-4">
                            <input name="caption" defaultValue={momentModal.data?.caption} placeholder="Caption" className="w-full bg-black/30 p-3 rounded-lg border border-white/10 text-white" required />
                            <div>
                                <label className="text-xs text-gray-400">Image {momentModal.mode === 'edit' && "(Leave empty to keep current)"}</label>
                                <input type="file" name="image" className="w-full mt-1 text-sm text-gray-400" {...(momentModal.mode === 'add' ? {required: true} : {})} />
                            </div>
                            <div className="flex gap-2">
                                <button type="button" onClick={() => setMomentModal({open: false, mode: 'add', data: null})} className="flex-1 bg-red-500/20 text-red-400 py-3 rounded-xl">Cancel</button>
                                <button type="submit" className="flex-1 bg-cyan-500 text-black font-bold py-3 rounded-xl">{momentModal.mode === 'edit' ? 'Save' : 'Upload'}</button>
                            </div>
                        </form>
                    </div>
                </div> 
            )}

    {/* --- DRAWER CASH MODAL --- */}
            {drawerModal && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-4xl border border-white/10 shadow-2xl relative max-h-[95vh] overflow-y-auto">
                        <button
                            type="button"
                            onClick={() => setDrawerModal(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50"
                        >
                            ✕
                        </button>

                        <div className="pr-10 mb-5">
                            <h3 className="text-xl font-bold text-yellow-400">
                                Cash Drawer Reconciliation
                            </h3>
                            <p className="text-xs text-gray-400 mt-1">
                                System cash is calculated from paid cash sales minus cash expenses and cash purchases.
                                Every amount taken out is accumulated automatically.
                            </p>
                        </div>

                        {/* =====================================================
                            LIVE CASH HIGHLIGHTS
                           ===================================================== */}
                        {(() => {
                            const summary = getDrawerSnapshot();

                            let diffColor = 'text-gray-400';
                            let diffLabel = 'Awaiting physical count';

                            if (summary.hasPhysical) {
                                if (summary.difference > 0) {
                                    diffColor = 'text-green-400';
                                    diffLabel = 'Extra / Overage';
                                } else if (summary.difference < 0) {
                                    diffColor = 'text-red-400';
                                    diffLabel = 'Shortage';
                                } else {
                                    diffColor = 'text-blue-400';
                                    diffLabel = 'Perfect Match';
                                }
                            }

                            return (
                                <div className="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-6">

                                    <div className="bg-black/30 border border-cyan-500/20 rounded-xl p-4">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            System Cash
                                        </p>
                                        <p className="text-2xl font-black text-cyan-400 mt-1">
                                            ₹{summary.systemCash}
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            From database
                                        </p>
                                    </div>

                                    <div className="bg-black/30 border border-orange-500/20 rounded-xl p-4">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            Total Taken Out
                                        </p>
                                        <p className="text-2xl font-black text-orange-400 mt-1">
                                            ₹{summary.totalTakenOut}
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            All saved withdrawals
                                        </p>
                                    </div>

                                    <div className="bg-black/30 border border-white/10 rounded-xl p-4">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            Expected In Box
                                        </p>
                                        <p className="text-2xl font-black text-white mt-1">
                                            ₹{summary.expectedInBox}
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            System cash − taken out
                                        </p>
                                    </div>

                                    <div className="bg-black/30 border border-yellow-500/20 rounded-xl p-4">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            Physical Count
                                        </p>
                                        <p className="text-2xl font-black text-yellow-400 mt-1">
                                            {summary.hasPhysical
                                                ? `₹${summary.physicalCounted}`
                                                : '—'}
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1">
                                            Latest counted cash
                                        </p>
                                    </div>

                                    <div className="col-span-2 xl:col-span-1 bg-black/40 border border-white/10 rounded-xl p-4">
                                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                                            Difference
                                        </p>
                                        <p className={`text-2xl font-black mt-1 ${diffColor}`}>
                                            {summary.hasPhysical
                                                ? `${summary.difference > 0 ? '+' : ''}₹${summary.difference}`
                                                : '—'}
                                        </p>
                                        <p className={`text-[10px] mt-1 ${diffColor}`}>
                                            {diffLabel}
                                        </p>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* =====================================================
                            ENTRY FORM
                           ===================================================== */}
                        <form
                            onSubmit={handleSaveDrawerCash}
                            className="mb-6 border-b border-white/10 pb-6"
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                <div>
                                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1 block">
                                        Amount Taken Out (₹)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        placeholder="Enter amount taken..."
                                        className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:border-orange-500 outline-none transition font-bold text-lg"
                                        value={drawerTakenOut}
                                        onChange={(e) => setDrawerTakenOut(e.target.value)}
                                    />
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        Press Enter or Save. This amount is added to Total Taken Out.
                                    </p>
                                </div>

                                <div>
                                    <label className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1 block">
                                        Physical Cash In Box (₹)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        inputMode="decimal"
                                        enterKeyHint="done"
                                        placeholder="Count physical cash..."
                                        className="w-full bg-black/50 border border-white/10 rounded-xl p-4 text-white focus:border-yellow-500 outline-none transition font-bold text-lg"
                                        value={drawerInput}
                                        onChange={(e) => setDrawerInput(e.target.value)}
                                    />
                                    <p className="text-[10px] text-gray-500 mt-1">
                                        Press Enter or Save. The box clears after a successful save.
                                    </p>
                                </div>
                            </div>

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-4">
                                <div className="bg-black/20 rounded-xl px-4 py-3 border border-white/5">
                                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-wider">
                                        Entered By
                                    </p>
                                    <p className="text-sm font-bold text-cyan-400 mt-0.5">
                                        {currentOperator.name || 'Self'}
                                    </p>
                                </div>

                                <button
                                    type="submit"
                                    className="bg-yellow-500 hover:bg-yellow-400 text-black font-black px-8 py-3 rounded-xl transition shadow-lg"
                                >
                                    Save Entry
                                </button>
                            </div>
                        </form>

                        {/* =====================================================
                            HISTORY
                           ===================================================== */}
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <h4 className="text-sm font-bold text-gray-300 uppercase tracking-widest">
                                    Cash Drawer History
                                </h4>
                                <p className="text-[10px] text-gray-500 mt-1">
                                    Each entry stores the amount taken in that entry and the reconciliation snapshot.
                                </p>
                            </div>

                            <div className="text-right text-[10px] text-gray-500">
                                {drawerCashRecords.length} entr{drawerCashRecords.length === 1 ? 'y' : 'ies'}
                            </div>
                        </div>

                        <div className="overflow-y-auto max-h-[320px] bg-black/20 rounded-xl border border-white/5">
                            {drawerCashRecords.length > 0 ? (
                                (() => {
                                    // Build immutable snapshots oldest → newest so cumulative
                                    // taken-out values are correct for every history row.
                                    const chronological = [...drawerCashRecords]
                                        .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));

                                    let runningTaken = 0;

                                    const historyWithMath = chronological.map(record => {
                                        runningTaken += Number(record.taken_out || 0);

                                        const systemCashAtEntry =
                                            record.system_cash !== undefined && record.system_cash !== null
                                                ? Number(record.system_cash)
                                                : Number(getCurrentDrawerCash() || 0);

                                        const totalTakenAtEntry =
                                            record.total_taken_out !== undefined && record.total_taken_out !== null
                                                ? Number(record.total_taken_out)
                                                : runningTaken;

                                        const expectedAtEntry =
                                            record.expected_cash !== undefined && record.expected_cash !== null
                                                ? Number(record.expected_cash)
                                                : systemCashAtEntry - totalTakenAtEntry;

                                        const physicalAtEntry =
                                            record.amount !== undefined && record.amount !== null
                                                ? Number(record.amount)
                                                : null;

                                        const differenceAtEntry =
                                            record.difference !== undefined && record.difference !== null
                                                ? Number(record.difference)
                                                : (
                                                    physicalAtEntry !== null
                                                        ? physicalAtEntry - expectedAtEntry
                                                        : null
                                                );

                                        return {
                                            ...record,
                                            systemCashAtEntry,
                                            totalTakenAtEntry,
                                            expectedAtEntry,
                                            physicalAtEntry,
                                            differenceAtEntry
                                        };
                                    }).reverse();

                                    return (
                                        <table className="w-full text-left text-xs text-gray-400">
                                            <thead className="bg-black/50 text-[9px] uppercase sticky top-0 z-10">
                                                <tr>
                                                    <th className="p-3">Date / By</th>
                                                    <th className="p-3 text-right">System</th>
                                                    <th className="p-3 text-right">Taken</th>
                                                    <th className="p-3 text-right">Total Taken</th>
                                                    <th className="p-3 text-right">Expected</th>
                                                    <th className="p-3 text-right">Physical</th>
                                                    <th className="p-3 text-right">Difference</th>
                                                </tr>
                                            </thead>

                                            <tbody>
                                                {historyWithMath.map(record => {
                                                    const diff = record.differenceAtEntry;

                                                    let differenceClass = 'text-gray-500';

                                                    if (diff !== null) {
                                                        if (diff > 0) differenceClass = 'text-green-400';
                                                        else if (diff < 0) differenceClass = 'text-red-400';
                                                        else differenceClass = 'text-blue-400';
                                                    }

                                                    return (
                                                        <tr
                                                            key={record.id || `${record.timestamp}-${record.time}`}
                                                            className="border-b border-white/5 hover:bg-white/5"
                                                        >
                                                            <td className="p-3 whitespace-nowrap">
                                                                <div className="text-white font-bold">
                                                                    {record.date || '—'}
                                                                </div>
                                                                <div className="text-[10px] text-gray-500">
                                                                    {record.time || '—'}
                                                                </div>
                                                                <div className="text-[10px] text-cyan-400 mt-0.5">
                                                                    {record.taken_by || 'Self'}
                                                                </div>
                                                            </td>

                                                            <td className="p-3 text-right font-bold text-cyan-400">
                                                                ₹{record.systemCashAtEntry}
                                                            </td>

                                                            <td className="p-3 text-right font-bold text-orange-400">
                                                                {Number(record.taken_out || 0) > 0
                                                                    ? `-₹${Number(record.taken_out)}`
                                                                    : '—'}
                                                            </td>

                                                            <td className="p-3 text-right font-bold text-orange-300">
                                                                ₹{record.totalTakenAtEntry}
                                                            </td>

                                                            <td className="p-3 text-right font-bold text-white">
                                                                ₹{record.expectedAtEntry}
                                                            </td>

                                                            <td className="p-3 text-right font-bold text-yellow-400">
                                                                {record.physicalAtEntry !== null
                                                                    ? `₹${record.physicalAtEntry}`
                                                                    : '—'}
                                                            </td>

                                                            <td className={`p-3 text-right font-black ${differenceClass}`}>
                                                                {diff === null
                                                                    ? '—'
                                                                    : `${diff > 0 ? '+' : ''}₹${diff}`}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    );
                                })()
                            ) : (
                                <div className="p-10 text-center text-gray-500 text-sm">
                                    No cash drawer entries yet.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

              {/* --- REVENUE DETAILS MODAL --- */}

            {selectedRevenueCategory && (() => {
                let detailsList = [];
                let categoryColor = 'text-white';
                let categoryTitle = '';

                // Calculate the exact orders that contributed to this specific category
                filteredTxns.forEach(order => {
                    let categoryTotal = 0;

                    if (selectedRevenueCategory === 'Food' && order.items) {
                        categoryTitle = 'Food Revenue Details';
                        categoryColor = 'text-orange-400';
                        Object.entries(order.items).forEach(([id, qty]) => {
                            const mItem = menuItems.find(i => i.id === parseInt(id));
                            const price = mItem ? parseInt(String(mItem.price).replace(/[^0-9]/g, '')) : 0;
                            categoryTotal += (Number(qty) * price);
                        });
                    } else if (selectedRevenueCategory === 'Inventory' && order.customItems) {
                        categoryTitle = 'Inventory Revenue Details';
                        categoryColor = 'text-purple-400';
                        order.customItems.forEach(cItem => {
                            if (cItem.isInv) categoryTotal += (Number(cItem.qty) * Number(cItem.price));
                        });
                    } else if (selectedRevenueCategory === 'Custom' && order.customItems) {
                        categoryTitle = 'Custom Items Revenue Details';
                        categoryColor = 'text-pink-400';
                        order.customItems.forEach(cItem => {
                            if (cItem.isCustom && !cItem.isInv) categoryTotal += (Number(cItem.qty) * Number(cItem.price));
                        });
                    }

                    if (categoryTotal > 0) {
                        detailsList.push({
                            id: order.displayId || order.id,
                            date: order.date,
                            time: order.time,
                            customer: order.customer?.name || 'Walk-in',
                            amount: categoryTotal
                        });
                    }
                });

                const handleDownloadCategoryCSV = () => {
                    if (detailsList.length === 0) return alert("No data to export.");
                    const csvData = detailsList.map(d => ({
                        "Order ID": d.id,
                        "Date": d.date,
                        "Time": d.time,
                        "Customer": d.customer,
                        [`${selectedRevenueCategory} Revenue`]: d.amount
                    }));
                    exportCSV(csvData, `${selectedRevenueCategory}_Revenue_${analyticsFilter}.csv`);
                };

                return (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-3xl border border-white/10 shadow-2xl relative max-h-[85vh] flex flex-col">
                            <button onClick={() => setSelectedRevenueCategory(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                            
                            <div className="flex justify-between items-start mb-6 pr-8">
                                <div>
                                    <h3 className={`text-xl font-bold mb-1 ${categoryColor}`}>{categoryTitle}</h3>
                                    <p className="text-xs text-gray-400">Showing specific revenue per order for current filter ({analyticsFilter}).</p>
                                </div>
                                <button onClick={handleDownloadCategoryCSV} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                            </div>

                            <div className="overflow-y-auto flex-1 bg-black/20 rounded-xl border border-white/5">
                                <table className="w-full text-left text-sm text-gray-400">
                                    <thead className="bg-black/40 text-xs uppercase sticky top-0">
                                        <tr>
                                            <th className="p-4">Order ID</th>
                                            <th className="p-4">Date & Time</th>
                                            <th className="p-4">Customer</th>
                                            <th className="p-4 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailsList.map((row, idx) => (
                                            <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-4 font-mono text-white">#{row.id}</td>
                                                <td className="p-4 whitespace-nowrap">{row.date} <span className="text-[10px] text-gray-500">{row.time}</span></td>
                                                <td className="p-4">{row.customer}</td>
                                                <td className={`p-4 text-right font-bold ${categoryColor}`}>₹{row.amount}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {detailsList.length === 0 && <div className="p-6 text-center text-gray-500 text-sm">No revenue found for this category.</div>}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* --- PENDING PAYMENTS MODAL --- */}
            {pendingModal && (
                <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                    <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-4xl border border-white/10 shadow-2xl relative max-h-[85vh] flex flex-col">
                        <button onClick={() => setPendingModal(false)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                        
                        <div className="mb-6">
                            <h3 className="text-xl font-bold mb-1 text-red-400 flex items-center gap-2">⚠️ Pending Payments</h3>
                            <p className="text-xs text-gray-400">Manage all orders with incomplete payments.</p>
                        </div>
                        
                        <div className="overflow-y-auto flex-1 bg-black/20 rounded-xl border border-white/5">
                            <table className="w-full text-left text-sm text-gray-400">
                                <thead className="bg-black/40 text-xs uppercase sticky top-0 z-10">
                                    <tr>
                                        <th className="p-4">Order ID</th>
                                        <th className="p-4">Date & Time</th>
                                        <th className="p-4">Customer</th>
                                        <th className="p-4">Amount</th>
                                        <th className="p-4 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {orders.filter(o => o.paymentStatus === 'Pending').map(order => (
                                        <tr key={order.id} className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-4 font-mono text-white">#{order.displayId || order.id}</td>
                                            <td className="p-4 whitespace-nowrap">{order.date} <span className="text-[10px] text-gray-500 block">{order.time}</span></td>
                                            <td className="p-4 font-bold text-white">{order.customer?.name || 'Walk-in'} {order.customer?.phone && <span className="block text-[10px] text-gray-400 font-normal">{order.customer.phone}</span>}</td>
                                            <td className="p-4 font-bold text-red-400">₹{order.total}</td>
                                            <td className="p-4 text-center">
                                                <button onClick={() => { 
                                                    setPendingModal(false); 
                                                    setEditHistoryModal({open: true, order: order, tempMethod: order.paymentMethod}); 
                                                }} className="bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white px-4 py-2 rounded-lg text-xs font-bold transition shadow-lg whitespace-nowrap">
                                                    Edit & Pay
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {orders.filter(o => o.paymentStatus === 'Pending').length === 0 && <div className="p-10 text-center text-gray-500 text-sm font-bold">No pending payments! 🎉</div>}
                        </div>
                    </div>
                </div>
            )}

          {/* SIDEBAR */}
            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
           <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-white/10 p-6 flex flex-col transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-cyan-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div>
                        <div><h1 className="text-md font-bold font-serif tracking-wide">{appName.toUpperCase()}</h1><p className="text-[9px] text-gray-500 mt-0.5">Operator: <span className="text-cyan-400 font-bold">{currentOperator.name}</span></p></div>
                    </div>
                    
                    {/* --- DESKTOP TOGGLE SWITCH --- */}
                    <div 
                        onClick={toggleMode}
                        className={`hidden md:flex w-14 h-7 items-center rounded-full p-1 cursor-pointer transition-colors duration-300 ${appMode === 'food' ? 'bg-cyan-500/20 border border-cyan-500/50' : 'bg-yellow-500/20 border border-yellow-500/50'}`}
                        title="Switch to Room Mode"
                    >
                        <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center text-[10px] ${appMode === 'food' ? 'translate-x-0 bg-cyan-500' : 'translate-x-7 bg-yellow-500'}`}>
                            {appMode === 'food' ? '🍔' : '🏨'}
                        </div>
                    </div>

                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <nav className="space-y-2 flex-1 overflow-y-auto pr-2 scrollbar-hide">
                    {/* --- UNLOCKED TABS (Always accessible) --- */}
                    <SidebarBtn icon="⚡" label="Live Orders" active={activeTab === 'orders'} onClick={() => handleTabClick('orders')} badge={pendingOrders} />
                    <SidebarBtn icon="🍔" label="Menu Manager" active={activeTab === 'menu'} onClick={() => handleTabClick('menu')} />
                    <SidebarBtn icon="📊" label="History" active={activeTab === 'history'} onClick={() => handleTabClick('history')} />
                    
                    {/* --- LOCKED TABS (Requires PIN if not unlocked) --- */}
                    <SidebarBtn icon="💸" label={`Expense Mgmt ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'expenses'} onClick={() => handleTabClick('expenses')} />
                    <SidebarBtn icon="🛒" label={`Stock Purchases ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'purchases'} onClick={() => handleTabClick('purchases')} />    
                    <SidebarBtn icon="🧑‍🍳" label={`Operations & Staff ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'staff'} onClick={() => handleTabClick('staff')} />
                    <SidebarBtn icon="📈" label={`Analytics & Txns ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'analytics'} onClick={() => handleTabClick('analytics')} />
                    <SidebarBtn icon="📦" label={`Inventory ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'inventory'} onClick={() => handleTabClick('inventory')} />
                    <SidebarBtn icon="📸" label={`Moments ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'moments'} onClick={() => handleTabClick('moments')} />
                    <SidebarBtn icon="👥" label={`Users Info ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'users'} onClick={() => handleTabClick('users')} />
                    <SidebarBtn icon="⚙️" label={`Settings ${!isUnlocked ? '🔒' : ''}`} active={activeTab === 'settings'} onClick={() => handleTabClick('settings')} />
                </nav>

                <div className="mt-4 grid grid-cols-2 gap-2">
                   
                    <button type="button" onClick={handleLockApp} className="flex items-center justify-center gap-2 px-3 py-3 text-red-400 bg-red-500/10 hover:bg-red-500/20 rounded-xl transition-all text-xs font-bold">
                        {isUnlocked ? '🔒 Lock App' : '🔒 Locked'}
                    </button>
                </div>
            </aside> {/* <--- THIS CLOSING TAG FIXES THE ERROR */}
           <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="md:hidden bg-slate-900 border-b border-white/10 p-4 flex items-center justify-between z-30 sticky top-0">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-white/10 rounded-lg">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                    <div className="text-center min-w-0"><span className="font-bold text-[22px] text-cyan-400 tracking-wide block truncate">{appName}</span><span className="text-[9px] text-gray-500 block truncate">{currentOperator.name}</span></div>
                    
                    <div className="flex items-center">
                        
                        {/* --- MOBILE TOGGLE SWITCH (BEFORE NOTIFICATION BELL) --- */}
                        <div 
                            onClick={toggleMode}
                            className={`w-14 h-7 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 mr-3 ${appMode === 'food' ? 'bg-cyan-500/20 border border-cyan-500/50' : 'bg-yellow-500/20 border border-yellow-500/50'}`}
                        >
                            <div className={`w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center text-[10px] ${appMode === 'food' ? 'translate-x-0 bg-cyan-500' : 'translate-x-7 bg-yellow-500'}`}>
                                {appMode === 'food' ? '🍔' : '🏨'}
                            </div>
                        </div>
                         <button
onClick={requestValoNotificationPermission}
    className="p-2 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500 hover:text-black transition"
    title="Enable Notifications"
>
    🔔
</button>
                    </div>
                </header>
                
                <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-900 relative">
                    
                    {/* GLOBAL BARCODE SCANNER (If an order is selected) */}
                    {scanOrderId && (
                        <div className="absolute top-0 left-0 w-full z-40 bg-blue-600 text-white p-4 shadow-xl flex items-center justify-between animate-slide-down">
                            <div className="flex-1 max-w-xl mx-auto flex items-center gap-4">
                                <span className="font-bold text-lg whitespace-nowrap hidden sm:block">📸 Scan Item to Order #{scanOrderId}</span>
                                <form onSubmit={handleBarcodeSubmit} className="flex-1 flex gap-2">
                                    <input 
                                        ref={barcodeInputRef}
                                        type="text" 
                                        placeholder="Scan barcode or type & press Enter..." 
                                        className="flex-1 bg-white/20 text-white placeholder-white/70 border border-white/30 rounded-lg px-4 py-2 outline-none focus:bg-white/30"
                                        value={barcodeInput}
                                        onChange={e => setBarcodeInput(e.target.value)}
                                        autoFocus
                                    />
                                </form>
                                <button onClick={() => setScanOrderId(null)} className="px-4 py-2 bg-black/30 rounded-lg font-bold hover:bg-black/50 transition">Done</button>
                            </div>
                        </div>
                    )}

                    {/* --- TAB: PENDING PAYMENTS (NEW) --- */}
                    {activeTab === 'pending_payments' && (
                        <div className="max-w-4xl mx-auto space-y-4 pb-10">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h2 className="text-2xl font-bold text-yellow-400">Pending Payments</h2>
                                    <p className="text-sm text-gray-400 mt-1">Orders that have been picked up/completed but not yet paid.</p>
                                </div>
                            </div>
                            
                            {pendingPaymentList.length === 0 && (
                                <div className="text-center py-20 text-gray-500">
                                    <span className="text-4xl block mb-4">🎉</span>
                                    No pending payments! You are all caught up.
                                </div>
                            )}
                            
                            {pendingPaymentList.map(order => (
                                <div key={order.id} className="bg-slate-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-lg">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <div className="flex items-center gap-3">
                                                <span className="text-2xl font-bold">Order #{order.displayId || order.id}</span>
                                                <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-1 rounded">PAYMENT PENDING</span>
                                            </div>
                                            <p className="text-sm text-gray-400">Location: {order.tableNo} • {order.customer?.name} • {order.customer?.phone}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className="text-xl font-bold">₹{order.total}</span>
                                            <button onClick={() => setAdminPaymentModal({ open: true, orderId: order.id, total: order.total })} className="bg-green-500 hover:bg-green-400 text-black px-6 py-2 rounded-lg font-bold shadow-lg shadow-green-500/20 transition whitespace-nowrap">
                                                Collect Payment
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-white/5">
                                        <span className="font-bold text-gray-400">Items: </span>
                                        {order.item_names || "No items listed"}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* --- TAB: EXPENSE MANAGER --- */}
                    {activeTab === 'expenses' && financials && (
                        <div className="max-w-6xl mx-auto pb-10">
                            <h2 className="text-2xl font-bold mb-6">Expense & Income Management</h2>
                            
                            <div className="mb-6 flex gap-4 items-center">
                                <label className="text-sm font-bold text-gray-400">Select Date:</label>
                                <input 
                                    type="date" 
                                    value={expenseDateFilter}
                                    onChange={(e) => setExpenseDateFilter(e.target.value)}
                                    className="bg-slate-800 border border-white/10 rounded-lg p-2 text-white focus:border-cyan-500 outline-none transition"
                                />
                            </div>

                            {/* --- 3 MASTER CARDS --- */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                {/* CARD 1: TOTAL INCOME */}
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-green-500">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Total Income</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Cash Income</span>
                                            <span className="font-bold text-green-400">₹{financials.lifetimeCashIn}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Online Income</span>
                                            <span className="font-bold text-green-400">₹{financials.lifetimeOnlineIn}</span>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                                        <span className="text-xs text-gray-500 uppercase font-bold">Total</span>
                                        <span className="text-3xl font-black text-white leading-none">₹{financials.lifetimeCashIn + financials.lifetimeOnlineIn}</span>
                                    </div>
                                </div>

                                {/* CARD 2: TOTAL OUTCOME */}
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-red-500">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Total Outcome</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Cash Outcome</span>
                                            <span className="font-bold text-red-400">₹{financials.lifetimeCashOut}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Online Outcome</span>
                                            <span className="font-bold text-red-400">₹{financials.lifetimeOnlineOut}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Personal Cash Outcome</span>
                                            <span className="font-bold text-yellow-400">₹{financials.lifetimePersonalCashOut}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Personal Online Outcome</span>
                                            <span className="font-bold text-yellow-400">₹{financials.lifetimePersonalOnlineOut}</span>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                                        <span className="text-xs text-gray-500 uppercase font-bold">Total</span>
                                        <span className="text-3xl font-black text-white leading-none">₹{financials.lifetimeCashOut + financials.lifetimeOnlineOut}</span>
                                    </div>
                                </div>

                                {/* CARD 3: REMAINING BALANCE */}
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-cyan-500 relative overflow-hidden">
                                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-cyan-500/10 rounded-full blur-xl"></div>
                                    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-widest mb-4">Remaining Balance</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Remaining Cash</span>
                                            <span className="font-bold text-cyan-300">₹{financials.lifetimeCashRem}</span>
                                        </div>
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300 text-sm">Remaining Online</span>
                                            <span className="font-bold text-cyan-300">₹{financials.lifetimeOnlineRem}</span>
                                        </div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end">
                                        <span className="text-xs text-cyan-500/50 uppercase font-bold">Total Net</span>
                                        <span className="text-3xl font-black text-cyan-400 leading-none">₹{financials.lifetimeTotalRem}</span>
                                    </div>
                                </div>
                            </div>

                            {/* DAILY SUMMARY TABLE */}
                            <h3 className="text-xl font-bold mb-4">Daily Report ({financials.dateStr})</h3>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 shadow-lg w-full max-w-[100vw] overflow-x-auto mb-8">
                                <table className="w-full text-left text-sm text-gray-300 min-w-[900px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr>
                                            <th className="p-4">Date</th>
                                            <th className="p-4">Initial Amount</th>
                                            <th className="p-4 text-green-400">Online Income</th>
                                            <th className="p-4 text-green-400">Cash Income</th>
                                            <th className="p-4 text-red-400">Online Outcome</th>
                                            <th className="p-4 text-red-400">Cash Outcome</th>
                                            <th className="p-4 text-cyan-400 font-bold text-right">Remaining Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-4 font-bold text-white">{financials.dateStr}</td>
                                            <td className="p-4 font-mono font-bold text-gray-400">₹{financials.initialAmount}</td>
                                            <td className="p-4 font-mono font-bold text-green-400">₹{financials.onlineIn}</td>
                                            <td className="p-4 font-mono font-bold text-green-400">₹{financials.cashIn}</td>
                                            <td className="p-4 font-mono font-bold text-red-400">₹{financials.onlineOut}</td>
                                            <td className="p-4 font-mono font-bold text-red-400">₹{financials.cashOut}</td>
                                            <td className="p-4 text-right font-mono font-black text-cyan-400 text-lg">₹{financials.totalRem}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg mb-8">
                                <h3 className="text-lg font-bold mb-4">Add New Expense</h3>
                                <form onSubmit={handleAddExpense} className="flex flex-col md:flex-row gap-4">
                                    <input type="text" placeholder="Description (e.g., Maggie packets)" className="flex-1 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={expenseDesc} onChange={e => setExpenseDesc(e.target.value)} required />
                                    <input type="number" placeholder="Amount (₹)" className="w-full md:w-32 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none" value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} required min="1" />
                                    <select value={expenseMode} onChange={e => setExpenseMode(e.target.value)} className="w-full md:w-32 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none">
                                        <option value="Cash">Cash</option>
                                        <option value="Online">Online</option>
                                    </select>

                                    <label className="flex items-center gap-2 bg-black/20 border border-white/10 rounded-lg px-3 py-2 cursor-pointer md:max-w-[240px]">
                                        <input
                                            type="checkbox"
                                            checked={expensePersonalMoney === true}
                                            onChange={e => setExpensePersonalMoney(e.target.checked)}
                                            className="w-4 h-4 accent-orange-500"
                                        />
                                        <span className="text-xs text-white font-bold">Paid with Personal Money</span>
                                    </label>

                                    <button type="submit" className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg transition shadow-lg whitespace-nowrap">Add Expense</button>
                                </form>
                            </div>

                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xl font-bold">Expense Ledger ({financials.dateStr})</h3>
                                <button onClick={() => exportCSV(financials.dayExpenses.map(e => ({ Date: e.date, Time: e.time, Description: e.description, Mode: e.mode, Personal_Money: e.personal_money === true ? 'YES' : 'NO', Amount: e.amount })), `Expenses_${financials.dateStr.replace(/\//g,'_')}.csv`)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                            </div>
                            
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full max-w-[100vw] overflow-x-auto shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400 min-w-[700px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr>
                                            <th className="p-4">Time</th>
                                            <th className="p-4">Description</th>
                                            <th className="p-4">Mode</th>
                                            <th className="p-4">Personal Money</th>
                                            <th className="p-4 text-right">Amount</th>
                                            <th className="p-4 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {financials.dayExpenses.map(exp => (
                                            <tr key={exp.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-4">{exp.time}</td>
                                                <td className="p-4 text-white">{exp.description}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-xs font-bold ${exp.mode === 'Online' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>{exp.mode}</span>
                                                </td>
                                                <td className="p-4">
                                                    {exp.personal_money === true
                                                        ? <span className="px-2 py-1 rounded text-xs font-bold bg-yellow-500/20 text-yellow-400">YES</span>
                                                        : <span className="px-2 py-1 rounded text-xs font-bold bg-gray-500/20 text-gray-400">NO</span>}
                                                </td>
                                                <td className="p-4 text-red-400 font-bold text-right font-mono">-₹{exp.amount}</td>
                                                <td className="p-4 text-center">
                                                    <button onClick={() => deleteExpense(exp.id)} className="bg-red-500/20 text-red-400 p-2 rounded hover:bg-red-500 hover:text-white transition">🗑</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {financials.dayExpenses.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No expenses recorded for this date.</div>}
                            </div>
                        </div>
                    )}

                 {activeTab === 'purchases' && (() => {
                    const groupedPurchases = {};
                    
                    // 1. Load items from inventory items list so they always appear
                    inventoryItems.forEach(item => {
                        groupedPurchases[item.name] = { 
                            name: item.name, 
                            type: item.category || 'Inventory', 
                            totalQty: item.stock, 
                            totalSpent: 0 
                        };
                    });

                    // 2. Aggregate quantities and costs from purchases data
                    purchasesData.forEach(curr => {
                        if (!groupedPurchases[curr.item_name]) {
                            groupedPurchases[curr.item_name] = { 
                                name: curr.item_name, 
                                type: curr.purchase_type || 'Inventory', 
                                totalQty: 0, 
                                totalSpent: 0 
                            };
                        }
                        groupedPurchases[curr.item_name].totalQty += Number(curr.qty);
                        groupedPurchases[curr.item_name].totalSpent += Number(curr.total_cost);
                    });

                    // 3. Convert to array and sort alphabetically A-Z
                    const groupedPurchasesArray = Object.values(groupedPurchases).sort((a, b) => a.name.localeCompare(b.name));

                    // 4. Filter by the active tab (All, Inventory, Food) and search query
                    const filteredPurchasesArray = groupedPurchasesArray.filter(item => {
                        const matchesTab = purchaseTabFilter === 'All' || item.type === purchaseTabFilter;
                        const matchesSearch = item.name.toLowerCase().includes(purchaseSearchQuery.toLowerCase());
                        return matchesTab && matchesSearch;
                    });

                    return (
                        <div className="max-w-6xl mx-auto pb-10">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                <div>
                                    <h2 className="text-2xl font-bold text-green-400">Stock Purchases</h2>
                                    <p className="text-sm text-gray-400 mt-1">Record items bought. Inventory purchases automatically add to your stock.</p>
                                </div>
                                <button onClick={() => setPurchaseModal({open: true})} className="bg-green-500 text-black px-6 py-2.5 rounded-xl font-bold shadow-lg hover:bg-green-400 transition whitespace-nowrap">+ Record Purchase</button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-yellow-500">
                                    <p className="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Food Expenses</p>
                                    <p className="text-3xl font-black text-white mt-1">₹{purchasesData.filter(p => p.purchase_type === 'Food').reduce((acc, curr) => acc + Number(curr.total_cost), 0)}</p>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-blue-500">
                                    <p className="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Inventory Expenses</p>
                                    <p className="text-3xl font-black text-white mt-1">₹{purchasesData.filter(p => p.purchase_type === 'Inventory').reduce((acc, curr) => acc + Number(curr.total_cost), 0)}</p>
                                </div>
                            </div>

                            {/* FILTERS & SEARCH BAR */}
                            <div className="flex flex-col md:flex-row gap-4 mb-6 border-b border-white/10 pb-4 items-center justify-between">
                                <div className="flex gap-2">
                                    {['All', 'Inventory', 'Food'].map(f => (
                                        <button key={f} onClick={() => setPurchaseTabFilter(f)} className={`px-6 py-2 rounded-lg text-sm font-bold transition ${purchaseTabFilter === f ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-slate-800 text-gray-400 hover:bg-slate-700'}`}>
                                            {f === 'All' ? 'All Items' : f}
                                        </button>
                                    ))}
                                </div>
                                <div className="relative flex-1 max-w-md">
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">🔍</span>
                                    <input 
                                        type="text" 
                                        placeholder="Search items..." 
                                        value={purchaseSearchQuery}
                                        onChange={(e) => setPurchaseSearchQuery(e.target.value)}
                                        className="w-full bg-slate-800 border border-white/10 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:border-cyan-500 outline-none transition"
                                    />
                                    {purchaseSearchQuery && ( <button onClick={() => setPurchaseSearchQuery("")} className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white">✕</button> )}
                                </div>
                            </div>

                            {/* CARDS GRID */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {filteredPurchasesArray.map(item => (
                                    <div key={item.name} onClick={() => setSelectedPurchaseItem(item.name)} className="bg-slate-800 p-5 rounded-xl border border-white/10 hover:border-cyan-500 cursor-pointer shadow-lg transition hover:-translate-y-1 flex flex-col">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded mb-3 inline-block w-fit ${item.type === 'Food' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-blue-500/20 text-blue-400'}`}>{item.type}</span>
                                        <h3 className="font-bold text-white text-lg truncate mb-2">{item.name}</h3>
                                        <div className="flex justify-between items-end mt-auto pt-4 border-t border-white/5">
                                            <div>
                                                <p className="text-[10px] text-gray-500 uppercase">Total Qty</p>
                                                <p className="font-bold text-white">{item.totalQty}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-[10px] text-gray-500 uppercase">Total Spent</p>
                                                <p className="font-bold text-red-400">₹{item.totalSpent}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {filteredPurchasesArray.length === 0 && <div className="col-span-full text-center py-10 text-gray-500">No items match your search.</div>}
                            </div>
                        </div>
                    );
                })()}

                       

               {/* --- TAB: STAFF & OPERATIONS (MERGED) --- */}
                    {activeTab === 'staff' && (
                        <div className="max-w-7xl mx-auto pb-10">
                            
                            {/* --- TOP SUB-TAB TOGGLE --- */}
                            <div className="flex bg-slate-800 p-1.5 rounded-xl border border-white/10 w-fit mb-8 shadow-lg">
                                <button 
                                    onClick={() => setOpsTab('staff')}
                                    className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all ${opsTab === 'staff' ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:text-white'}`}
                                >
                                    🧑‍🍳 Staff Accounts
                                </button>
                                <button 
                                    onClick={() => setOpsTab('missing')}
                                    className={`px-8 py-2.5 rounded-lg text-sm font-bold transition-all ${opsTab === 'missing' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-400 hover:text-white'}`}
                                >
                                    ⚠️ Missing & Defective
                                </button>
                            </div>

                            {/* --- PART 1: STAFF ACCOUNTS --- */}
                            {opsTab === 'staff' && (
                                <div className="animate-fade-in space-y-6">
                                    <div className="mb-2">
                                        <h2 className="text-2xl font-bold">Staff Accounts & Deductions</h2>
                                        <p className="text-sm text-gray-400">Manage staff advances, meals, and salary deductions.</p>
                                    </div>
                                    <div className="flex flex-col md:flex-row gap-6">
                                        {/* LEFT SIDEBAR: STAFF MEMBERS */}
                                        <div className="w-full md:w-1/3 space-y-4">
                                            <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-white/10 shadow-lg">
                                                <h2 className="text-lg font-bold">Team Members</h2>
                                                <button onClick={() => setStaffModal({open: true})} className="bg-cyan-500 text-black px-3 py-1.5 rounded-lg text-xs font-bold shadow-lg hover:bg-cyan-400 transition">+ Record</button>
                                            </div>
                                            <div className="bg-slate-800 rounded-xl border border-white/10 p-2 overflow-hidden shadow-lg">
                                                {uniqueStaffNames.length === 0 ? (
                                                    <div className="p-4 text-center text-sm text-gray-500 italic">No staff records yet.</div>
                                                ) : (
                                                    <div className="flex flex-col">
                                                        {uniqueStaffNames.map(staff => (
                                                            <button 
                                                                key={staff} 
                                                                onClick={() => setActiveStaff(staff)}
                                                                className={`w-full flex justify-between items-center p-3 rounded-lg transition-all ${activeStaff === staff ? 'bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}
                                                            >
                                                                <span className="truncate pr-2">{staff}</span>
                                                                <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded-full ${activeStaff === staff ? 'bg-black/20 text-black' : 'bg-red-500/20 text-red-400'}`}>
                                                                    -₹{staffTotals[staff]}
                                                                </span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        {/* RIGHT SIDE: SELECTED STAFF DETAILS */}
                                        <div className="w-full md:w-2/3">
                                            {activeStaff ? (
                                                <>
                                                    <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg mb-6 flex justify-between items-center">
                                                        <div>
                                                            <p className="text-gray-400 text-xs font-bold uppercase tracking-widest">Total Deduction Due</p>
                                                            <h3 className="text-3xl font-black text-red-400 mt-1">-₹{staffTotals[activeStaff]}</h3>
                                                        </div>
                                                        <div className="text-right">
                                                            <h2 className="text-xl font-bold text-white uppercase">{activeStaff}</h2>
                                                            <p className="text-xs text-gray-500 mt-1">Items taken / Advance consumed</p>
                                                        </div>
                                                    </div>

        <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 shadow-lg w-full max-w-[100vw] overflow-x-auto">
                                                        <table className="w-full text-left text-sm text-gray-400 min-w-[600px]">
                                                            <thead className="bg-black/30 text-white uppercase text-xs">
                                                                <tr>
                                                                    <th className="p-4">Date & Time</th>
                                                                    <th className="p-4">Item Taken</th>
                                                                    <th className="p-4 text-center">Qty</th>
                                                                    <th className="p-4 text-right">Rate</th>
                                                                    <th className="p-4">Cash Source</th>
                                                                    <th className="p-4 text-right">Total</th>
                                                                    <th className="p-4"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {staffExpenses.filter(se => se.staff_name === activeStaff).map(exp => (
                                                                    <tr key={exp.id} className="border-b border-white/5 hover:bg-white/5">
                                                                        <td className="p-4 whitespace-nowrap">{exp.date} <span className="text-xs text-gray-500">{exp.time}</span></td>
                                                                        <td className="p-4 text-white font-medium">
                                                                            {exp.item_name}
                                                                            {exp.is_inv && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded" title="Deducted from Inventory">📦</span>}
                                                                        </td>
                                                                        <td className="p-4 text-center font-bold">{exp.qty}x</td>
                                                                        <td className="p-4 text-right text-gray-500 text-xs">@₹{exp.price}</td>
                                                                        <td className="p-4">
                                                                            {String(exp.item_name || '').toLowerCase() === 'money' ? (
                                                                                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                                                                                    exp.cash_source === 'Daily Cash Box'
                                                                                        ? 'bg-orange-500/20 text-orange-400'
                                                                                        : 'bg-cyan-500/20 text-cyan-400'
                                                                                }`}>
                                                                                    {exp.cash_source === 'Daily Cash Box' ? '💵 Daily Cash Box' : '👤 Personal Money'}
                                                                                </span>
                                                                            ) : (
                                                                                <span className="text-gray-600 text-xs">—</span>
                                                                            )}
                                                                        </td>
                                                                        <td className="p-4 text-red-400 font-bold text-right font-mono">-₹{exp.total}</td>
                                                                        <td className="p-4 text-center">
                                                                            <button onClick={() => deleteStaffExpense(exp.id)} className="text-gray-600 hover:text-red-400 transition" title="Delete Record">✕</button>
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                        {staffExpenses.filter(se => se.staff_name === activeStaff).length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No expenses recorded for {activeStaff}.</div>}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-gray-500 bg-slate-800/50 rounded-xl border border-white/5 border-dashed">
                                                    <span className="text-4xl mb-4">🧑‍🍳</span>
                                                    <p>Select a staff member from the list to view details.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* --- PART 2: MISSING & DEFECTIVE ITEMS --- */}
                            {opsTab === 'missing' && (
                                <div className="animate-fade-in space-y-6">
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-2">
                                        <div>
                                            <h2 className="text-2xl font-bold text-orange-400">Missing & Defective Tracker</h2>
                                            <p className="text-sm text-gray-400 mt-1">Track lost, damaged, or expired stock. Automatically deducts from inventory.</p>
                                        </div>
                                        <button onClick={() => setMissingModal({open: true})} className="bg-orange-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg hover:bg-orange-400 transition whitespace-nowrap">+ Record Loss/Defect</button>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg flex items-center justify-between border-l-4 border-l-orange-500">
                                            <div>
                                                <p className="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Value Missing</p>
                                                <p className="text-3xl font-black text-white mt-1">₹{missingItemsData.filter(i => (i.type || 'Missing') === 'Missing').reduce((acc, curr) => acc + Number(curr.total), 0)}</p>
                                            </div>
                                            <div className="text-4xl opacity-50">❓</div>
                                        </div>
                                        <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg flex items-center justify-between border-l-4 border-l-red-500">
                                            <div>
                                                <p className="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Value Defective</p>
                                                <p className="text-3xl font-black text-white mt-1">₹{missingItemsData.filter(i => i.type === 'Defective').reduce((acc, curr) => acc + Number(curr.total), 0)}</p>
                                            </div>
                                            <div className="text-4xl opacity-50">💔</div>
                                        </div>
                                    </div>

                                    <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 shadow-lg w-full max-w-[100vw] overflow-x-auto">
                                        <table className="w-full text-left text-sm text-gray-400 min-w-[700px]">
                                            <thead className="bg-black/30 text-white uppercase text-xs">
                                                <tr>
                                                    <th className="p-4">Date & Time</th>
                                                    <th className="p-4">Type</th>
                                                    <th className="p-4">Item Name</th>
                                                    <th className="p-4 text-center">Qty Lost</th>
                                                    <th className="p-4 text-right">Total Loss</th>
                                                    <th className="p-4 text-center">Action</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {missingItemsData.map(item => (
                                                    <tr key={item.id} className="border-b border-white/5 hover:bg-white/5">
                                                        <td className="p-4 whitespace-nowrap">{item.date} <span className="text-xs text-gray-500 block">{item.time}</span></td>
                                                        <td className="p-4">
                                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${item.type === 'Defective' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>
                                                                {item.type || 'Missing'}
                                                            </span>
                                                        </td>
                                                        <td className="p-4 text-white font-medium">
                                                            {item.item_name}
                                                            {item.is_inv && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded" title="Deducted from Inventory">📦</span>}
                                                        </td>
                                                        <td className="p-4 text-center font-bold text-gray-300">{item.qty}</td>
                                                        <td className="p-4 text-orange-400 font-bold text-right font-mono">₹{item.total}</td>
                                                        <td className="p-4 text-center">
                                                            <button onClick={() => deleteMissingItem(item.id)} className="bg-red-500/10 text-red-400 p-2 rounded hover:bg-red-50 hover:text-white transition">🗑</button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                        {missingItemsData.length === 0 && <div className="text-center py-10 text-gray-500 font-bold">No items recorded yet. Great!</div>}
                                    </div>
                                </div>
                            )}

                        </div>
                    )}

             

                        {/* --- TAB: INVENTORY MANAGER --- */}
{activeTab === 'inventory' && (
    <div className="max-w-7xl mx-auto pb-10">

        {/* ------------------------------------------------------------
            INVENTORY HEADER
           ------------------------------------------------------------ */}
        <div className="mb-5">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-white truncate">Inventory Manager</h2>
                    <p className="text-sm text-gray-400 mt-1 hidden sm:block">
                        Manage stock, prices, barcodes and inventory items.
                    </p>
                </div>
            </div>

            {/* WhatsApp + Add Item — always one row */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end sm:items-center">
                <button
                    type="button"
                    onClick={() => setInventoryWhatsAppModal(true)}
                    className="w-full sm:w-auto bg-[#25D366] hover:bg-[#1ebe5d] text-black px-4 py-2.5 rounded-xl font-bold text-sm transition shadow-lg flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                    <span>📲</span>
                    <span>WhatsApp</span>
                </button>

                <button
                    type="button"
                    onClick={() => setInvModal({open: true, mode: 'add', data: null})}
                    className="w-full sm:w-auto bg-cyan-500 text-black px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-cyan-400 transition shadow-lg flex items-center justify-center gap-2 active:scale-[0.98]"
                >
                    <span>＋</span>
                    <span>Add Item</span>
                </button>
            </div>
        </div>

        {/* ------------------------------------------------------------
            WHATSAPP REPORT CHOOSER
           ------------------------------------------------------------ */}
        {inventoryWhatsAppModal && (
            <div
                className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
                onClick={() => setInventoryWhatsAppModal(false)}
            >
                <div
                    className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md p-6"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between mb-5">
                        <div>
                            <h3 className="text-xl font-bold text-white">WhatsApp Stock Report</h3>
                            <p className="text-xs text-gray-400 mt-1">
                                Send manually to <span className="text-green-400 font-bold">7972506748</span>
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setInventoryWhatsAppModal(false)}
                            className="text-gray-400 hover:text-white text-2xl"
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>

                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={() => {
                                const lowItems = inventoryItems.filter(
                                    item => Number(item.stock) <= 5
                                );

                                if (lowItems.length === 0) {
                                    alert('No low stock items right now.');
                                    return;
                                }

                                let msg =
                                    `🚨 *VALO LOW STOCK REPORT* 🚨\n\n` +
                                    `📅 ${getFormattedDate()} ${getFormattedTime()}\n\n` +
                                    `*Items at or below 5 units:*\n\n`;

                                lowItems.forEach(item => {
                                    msg +=
                                        `• *${item.name}* — ${Number(item.stock) || 0} units\n`;
                                });

                                msg += `\nPlease arrange stock refill.`;

                                setInventoryWhatsAppModal(false);
                                openWhatsAppReport(msg);
                            }}
                            className="w-full bg-yellow-500 hover:bg-yellow-400 text-black p-4 rounded-xl font-bold text-left transition active:scale-[0.99]"
                        >
                            🚨 Send Low Stock Report
                            <span className="block text-xs font-normal mt-1 opacity-70">
                                Only items with 5 or fewer units
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={() => {
                                let msg =
                                    `📊 *VALO INVENTORY STOCK REPORT* 📊\n\n` +
                                    `📅 ${getFormattedDate()} ${getFormattedTime()}\n\n` +
                                    `*Current Stock Levels:*\n\n`;

                                if (inventoryItems.length === 0) {
                                    msg += `No inventory items found.\n`;
                                } else {
                                    inventoryItems.forEach(item => {
                                        const stock = Number(item.stock) || 0;
                                        msg +=
                                            `• *${item.name}* — ${stock} units` +
                                            `${stock <= 5 ? ' 🚨' : ''}\n`;
                                    });
                                }

                                msg +=
                                    `\nTotal items: ${inventoryItems.length}` +
                                    `\n\nGenerated manually from VALO Admin.`;

                                setInventoryWhatsAppModal(false);
                                openWhatsAppReport(msg);
                            }}
                            className="w-full bg-[#25D366] hover:bg-[#1ebe5d] text-black p-4 rounded-xl font-bold text-left transition active:scale-[0.99]"
                        >
                            📦 Send Full Stock Report
                            <span className="block text-xs font-normal mt-1 opacity-70">
                                All inventory items and current quantities
                            </span>
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={() => setInventoryWhatsAppModal(false)}
                        className="w-full mt-4 bg-white/5 hover:bg-white/10 text-gray-300 p-3 rounded-xl font-bold transition"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        )}

        {/* ------------------------------------------------------------
            FILTERS + SEARCH
           ------------------------------------------------------------ */}
        <div className="flex flex-col lg:flex-row gap-3 mb-6">
            <div className="flex gap-2 overflow-x-auto pb-1 w-full lg:w-auto">
                {['All', 'Inventory', 'Food'].map(cat => (
                    <button
                        key={cat}
                        type="button"
                        onClick={() => setInventoryCategoryFilter(cat)}
                        className={`px-4 sm:px-6 py-2 rounded-lg text-sm font-bold transition whitespace-nowrap ${inventoryCategoryFilter === cat ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-slate-800 text-gray-400 hover:bg-slate-700'}`}
                    >
                        {cat === 'All' ? 'All Items' : cat}
                    </button>
                ))}
            </div>

            <div className="w-full lg:flex-1 lg:max-w-md lg:ml-auto">
                <input
                    type="text"
                    placeholder="Search inventory items or barcodes..."
                    value={inventorySearchQuery}
                    onChange={(e) => setInventorySearchQuery(e.target.value)}
                    className="w-full bg-slate-800 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:border-cyan-500 outline-none"
                />
            </div>
        </div>

        {/* ------------------------------------------------------------
            INVENTORY CARDS
            Mobile: 2 cards / row
            Tablet: 3-4 cards / row
            Desktop: up to 8 cards / row
           ------------------------------------------------------------ */}
        {filteredInventory.length === 0 ? (
            <div className="bg-slate-800 rounded-xl border border-white/10 shadow-lg text-center py-14 text-gray-500">
                No inventory items found.
            </div>
        ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3">
                {filteredInventory.map(item => {
                    const stock = Number(item.stock) || 0;
                    const price = Number(item.price) || 0;
                    const isCritical = stock <= 2;
                    const isLow = stock <= 5;

                    return (
                        <div
                            key={item.id}
                            className={`bg-slate-800 rounded-xl border shadow-lg p-3.5 flex flex-col min-w-0 transition-all hover:-translate-y-0.5 ${
                                isCritical
                                    ? 'border-red-500/40'
                                    : isLow
                                        ? 'border-yellow-500/30'
                                        : 'border-white/10 hover:border-cyan-500/50'
                            }`}
                        >
                            {/* Category */}
                            <div className="flex items-center justify-between gap-1 mb-2">
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase truncate max-w-[80%] ${
                                    item.category === 'Food'
                                        ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/20'
                                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/20'
                                }`}>
                                    {item.category || 'Inventory'}
                                </span>
                                {isCritical && <span className="text-[10px]">🚨</span>}
                                {!isCritical && isLow && <span className="text-[10px]">⚠️</span>}
                            </div>

                            {/* Name */}
                            <h3
                                className="font-bold text-white text-sm leading-tight min-h-[2.5rem] line-clamp-2"
                                title={item.name}
                            >
                                {item.name}
                            </h3>

                            {/* Stock */}
                            <div className={`mt-3 rounded-lg p-2 text-center ${
                                isCritical
                                    ? 'bg-red-500/10 border border-red-500/20'
                                    : isLow
                                        ? 'bg-yellow-500/10 border border-yellow-500/20'
                                        : 'bg-green-500/10 border border-green-500/20'
                            }`}>
                                <p className="text-[8px] uppercase tracking-wider text-gray-500 font-bold">Stock</p>
                                <p className={`text-xl font-black leading-none mt-1 ${
                                    isCritical ? 'text-red-400' : isLow ? 'text-yellow-400' : 'text-green-400'
                                }`}>
                                    {stock}
                                </p>
                                <p className="text-[8px] text-gray-500 mt-0.5">units</p>
                            </div>

                            {/* Details */}
                            <div className="mt-3 space-y-1.5 text-[10px]">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-gray-500">Price</span>
                                    <span className="font-bold text-cyan-400">₹{price}</span>
                                </div>

                                <div className="pt-1.5 border-t border-white/5">
                                    <p className="text-gray-500 uppercase text-[7px] tracking-wide">Barcode / SKU</p>
                                    <p
                                        className="font-mono text-gray-300 truncate mt-0.5"
                                        title={item.barcode || '-'}
                                    >
                                        {item.barcode || '-'}
                                    </p>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="grid grid-cols-2 gap-1.5 mt-3 pt-2 border-t border-white/5">
                                <button
                                    type="button"
                                    onClick={() => setInvModal({open: true, mode: 'edit', data: item})}
                                    className="bg-blue-500/15 text-blue-400 py-2 rounded-lg hover:bg-blue-500 hover:text-white transition text-xs font-bold"
                                    title="Edit Item"
                                >
                                    ✏️ Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => deleteInventoryItem(item.id)}
                                    className="bg-red-500/15 text-red-400 py-2 rounded-lg hover:bg-red-500 hover:text-white transition text-xs font-bold"
                                    title="Delete Item"
                                >
                                    🗑 Delete
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        )}
    </div>
)}

                    {/* TAB: LIVE ORDERS */}
                    {activeTab === 'orders' && ( 
                        <div className="max-w-4xl mx-auto space-y-4">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-2xl font-bold">Live Orders</h2>
                                <button onClick={() => setCreateBillModal(true)} className="bg-cyan-500 hover:bg-cyan-400 text-black px-4 py-2 rounded-xl font-bold shadow-lg shadow-cyan-500/20 transition">+ Create Bill</button>
                            </div>
                            
                            {getFilteredLiveOrders().length === 0 && <div className="text-center py-20 text-gray-500">No active orders</div>}
                            
                            {getFilteredLiveOrders().map(order => {
                                const regularItems = Object.entries(order.items || {}).map(([id, qty]) => {
                                    const mItem = menuItems.find(i => i.id === parseInt(id));
                                    return { key: `menu_${id}`, name: mItem?.name || 'Item', qty: qty, price: mItem?.price, menuId: id, isCustom: false };
                                });
                                const customItems = (order.customItems || []).map(cItem => ({
                                    key: cItem.id, name: cItem.name, qty: cItem.qty, price: cItem.price, isCustom: true, isInv: cItem.isInv, invId: cItem.invId
                                }));
                                const allItemsToRender = [...regularItems, ...customItems];

                                return (
                                    <div key={order.id} className={`bg-slate-800 p-5 rounded-xl border-l-4 shadow-lg ${order.status === 'Received' ? 'border-yellow-500' : 'border-green-500'} ${scanOrderId === order.id ? 'ring-2 ring-blue-500 scale-[1.01] transition-all' : ''}`}>
                                        <div className="flex justify-between items-start mb-4">
                                            <div>
                                                <div className="flex items-center gap-3">
                                                    <span className="text-2xl font-bold">Order #{order.displayId || order.id}</span>
                                                    {order.paymentStatus === 'Paid' ? <span className="bg-green-500 text-black text-[10px] font-bold px-2 py-1 rounded">{order.paymentMethod || 'PAID'}</span> : <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-1 rounded">PENDING</span>}
                                                </div>
                                                <p className="text-sm text-gray-400">Location: {order.tableNo} • {order.customer?.name} • {order.customer?.phone}</p>
                                                 {order.created_by_name && <p className="text-[10px] text-cyan-400 mt-1">Created by: <span className="font-bold">{order.created_by_name}</span></p>}
                                                 {order.last_updated_by_name && <p className="text-[10px] text-gray-500">Last updated by: <span className="font-bold text-gray-300">{order.last_updated_by_name}</span></p>}
                                                 
                                                {order.paymentId && <p className="text-[10px] text-cyan-400 mt-1 font-mono">Txn ID: {order.paymentId}</p>}
                                            </div>
                                            <div className="flex flex-col items-end gap-2">
                                                <span className="text-xl font-bold">₹{order.total}</span>
                                                 <div className="flex items-center gap-2">
                                                     <button type="button" onClick={() => openOrderActivity(order)} className="text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 bg-purple-500/20 text-purple-400 hover:bg-purple-500 hover:text-white transition">🕘 Activity</button>
                                                     
                                                 </div>
                                            </div>
                                        </div>

                                        {/* ITEMS RENDERED WITH CHECKBOXES AND QUANTITY EDITORS */}
                                        <div className="bg-black/30 p-3 rounded-lg mb-4 text-sm space-y-1">
                                            {allItemsToRender.map(item => {
                                                const isReady = order.itemStatuses?.[item.key];
                                                return (
                                                    <div key={item.key} className="flex justify-between items-center py-2 border-b border-white/5 last:border-0 last:pb-0">
                                                        <div className="flex items-center gap-3">
                                                            <button 
                                                                onClick={() => toggleItemReady(order, item.key)} 
                                                                className={`w-5 h-5 rounded flex items-center justify-center border transition-all ${isReady ? 'bg-green-500 border-green-500 text-black' : 'border-gray-500 text-transparent hover:border-green-500'}`}
                                                            >✓</button>
                                                            <span className={`${isReady ? 'line-through text-gray-500' : 'text-white'}`}>
                                                                {item.name} 
                                                                {item.isInv && <span className="text-[8px] bg-blue-500/20 text-blue-400 px-1 rounded ml-2" title="Inventory Item">📦</span>}
                                                                {item.isCustom && !item.isInv && <span className="text-[8px] bg-cyan-500/20 text-cyan-400 px-1 rounded ml-2">CUSTOM</span>}
                                                            </span>
                                                        </div>
                                                        <div className="flex flex-col items-end gap-1">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button 
                                                                    onClick={() => updateLiveOrderItemQty(order.id, item.key, item.isCustom, item.qty - 1)} 
                                                                    disabled={item.qty <= 1 || isReady} 
                                                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >-</button>
                                                                <span className={`font-bold w-4 text-center ${isReady ? 'text-gray-500' : 'text-white'}`}>{item.qty}</span>
                                                                <button 
                                                                    onClick={() => updateLiveOrderItemQty(order.id, item.key, item.isCustom, item.qty + 1)} 
                                                                    disabled={isReady}
                                                                    className="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed"
                                                                >+</button>
                                                                
                                                                <button 
                                                                    onClick={() => removeLiveOrderItem(order.id, item.key, item.isCustom)}
                                                                    disabled={isReady}
                                                                    className="w-6 h-6 rounded bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white flex items-center justify-center transition disabled:opacity-50 disabled:cursor-not-allowed ml-1"
                                                                    title="Remove Item"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                            <div className="text-[9px] text-gray-500 text-right">{item.isCustom ? `₹${item.price}/ea` : item.price}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* ADD CUSTOM ITEM FORM */}
                                            <div className="mt-3 border-t border-white/10 pt-3">
                                                {addingItemTo === order.id ? (
                                                    <div className="flex flex-col gap-2 bg-black/40 p-2 rounded-lg border border-cyan-500/30 overflow-visible">
                                                        <div className="relative">
                                                            <input 
                                                                type="text" 
                                                                placeholder="Item Name (Search menu or type custom)" 
                                                                className="bg-slate-800 text-xs p-2 rounded text-white outline-none w-full" 
                                                                value={customItemForm.name} 
                                                                onChange={e => {
                                                                    setCustomItemForm({...customItemForm, name: e.target.value, menuId: null});
                                                                    setShowSuggestions(true);
                                                                }} 
                                                                onFocus={() => setShowSuggestions(true)}
                                                                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                                                            />
                                                            {showSuggestions && customItemForm.name && (
                                                                <div className="absolute top-full left-0 w-full mt-1 bg-slate-700 border border-white/10 rounded-lg shadow-xl max-h-40 overflow-y-auto z-[100]">
                                                                    {combinedCustomSuggestions.map(item => {
                                                                        const isInv = item.barcode !== undefined;
                                                                        return (
                                                                            <div key={isInv ? `inv_${item.id}` : `menu_${item.id}`} onMouseDown={(e) => {
                                                                                e.preventDefault();
                                                                                setCustomItemForm({
                                                                                    ...customItemForm,
                                                                                    name: item.name,
                                                                                    price: parseInt(String(item.price).replace(/[^0-9]/g, '')) || 0,
                                                                                    menuId: isInv ? null : item.id,
                                                                                    invId: isInv ? item.id : null,
                                                                                    isInv: isInv
                                                                                });
                                                                                setShowSuggestions(false);
                                                                            }} className="p-2 hover:bg-cyan-500 hover:text-black cursor-pointer border-b border-white/5 last:border-0 flex justify-between text-xs">
                                                                                <span>{item.name} {isInv && <span className="ml-2 text-[10px] bg-blue-500/20 text-blue-400 px-1 py-0.5 rounded" title="Inventory Item">📦 In Stock: {item.stock}</span>}</span>
                                                                                <span className="font-bold font-mono">₹{item.price}</span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                    {combinedCustomSuggestions.length === 0 && (
                                                                        <div className="p-2 text-gray-400 text-[10px] italic">Custom item will be created</div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <input type="number" placeholder="Qty" className="bg-slate-800 text-xs p-2 rounded text-white outline-none w-16" value={customItemForm.qty} onChange={e => setCustomItemForm({...customItemForm, qty: e.target.value})} min="1" />
                                                            <input type="number" placeholder="Total Rate/ea (₹)" className={`bg-slate-800 text-xs p-2 rounded text-white outline-none flex-1 ${customItemForm.menuId || customItemForm.invId ? 'opacity-50 cursor-not-allowed' : ''}`} value={customItemForm.price} onChange={e => setCustomItemForm({...customItemForm, price: e.target.value})} disabled={!!customItemForm.menuId || !!customItemForm.invId} />
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button onClick={() => { setAddingItemTo(null); setCustomItemForm({name: '', qty: 1, price: '', menuId: null, invId: null, isInv: false}); }} className="flex-1 text-xs py-2 bg-red-500/20 text-red-400 rounded hover:bg-red-500 hover:text-white transition">Cancel</button>
                                                            <button onClick={() => handleAddCustomItem(order.id)} className="flex-1 text-xs py-2 bg-cyan-500 text-black font-bold rounded hover:bg-cyan-400 transition">Add Item</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button onClick={() => { setAddingItemTo(order.id); setCustomItemForm({name: '', qty: 1, price: '', menuId: null, invId: null, isInv: false}); }} className="w-full text-xs text-cyan-400 hover:bg-cyan-500/10 py-2 border border-dashed border-cyan-500/30 rounded transition">+ Add Item to Order</button>
                                                )}
                                            </div>
                                        </div>
                                        
                                        <div className="flex gap-3">
                                            {order.status === 'Received' && <button onClick={() => updateOrder(order.id, {status: 'Preparing'})} className="bg-slate-700 hover:bg-cyan-500 hover:text-black px-6 py-3 rounded-lg font-bold flex-1">Accept</button>}
                                            
                                            {order.status === 'Preparing' && <button onClick={() => updateOrder(order.id, {status: 'Ready'})} className="bg-green-600 px-6 py-3 rounded-lg font-bold flex-1">Ready</button>}
                                            
                                          {order.status === 'Ready' && (
    <button 
        onClick={async () => {
            const result = await updateOrder(order.id, {status: 'Picked Up'});
            if (result?.error) return;
        }} 
        className={`px-6 py-3 rounded-lg font-bold flex-1 transition-all ${
            order.paymentStatus === 'Paid' 
                ? 'bg-slate-600 hover:bg-slate-500 text-white shadow-lg' 
                : 'bg-yellow-500 hover:bg-yellow-400 text-black shadow-lg'
        }`}
    >
        {order.paymentStatus === 'Paid' ? 'Complete' : 'Complete (Pending)'}
    </button>

)}

                                            {(order.paymentStatus === 'Pending' || !order.paymentStatus) && ( 
                                                <button onClick={() => setAdminPaymentModal({ open: true, orderId: order.id, total: order.total })} className="bg-green-900/50 text-green-400 px-4 py-2 rounded-lg text-sm border border-green-500/30 hover:bg-green-500 hover:text-black transition">
                                                    Mark Paid
                                                </button> 
                                            )}
                                        </div>
                                    </div> 
                                );
                            })}
                        </div> 
                    )}

                  {/* --- ADVANCED ANALYTICS & TRANSACTIONS TAB --- */}
                    {activeTab === 'analytics' && (() => {
                        // Calculate separate Cash and Online totals based on the current filter
                        let totalCash = 0;
                        let totalOnline = 0;
                        let totalFoodRevenue = 0;
                        let totalInvRevenue = 0;
                        let totalCustomRevenue = 0;
                        
                        filteredTxns.forEach(order => {
                            // 1. Calculate Cash / Online Split
                            const pm = String(order.paymentMethod || 'Cash').toLowerCase();
                            if (pm === 'split') {
                                totalCash += Number(order.splitAmounts?.cash || 0);
                                totalOnline += Number(order.splitAmounts?.online || 0);
                            } else if (pm.includes('online') || pm.includes('upi') || pm.includes('card')) {
                                totalOnline += Number(order.total || 0);
                            } else {
                                totalCash += Number(order.total || 0);
                            }

                            // 2. Calculate Revenue by Item Category
                            // A. Regular Food/Menu Items
                            if (order.items) {
                                Object.entries(order.items).forEach(([id, qty]) => {
                                    const mItem = menuItems.find(i => i.id === parseInt(id));
                                    const price = mItem ? parseInt(String(mItem.price).replace(/[^0-9]/g, '')) : 0;
                                    totalFoodRevenue += (Number(qty) * price);
                                });
                            }
                            
                            // B. Custom & Inventory Items
                            if (order.customItems) {
                                order.customItems.forEach(cItem => {
                                    if (cItem.isInv) {
                                        totalInvRevenue += (Number(cItem.qty) * Number(cItem.price));
                                    } else if (cItem.isCustom) {
                                        totalCustomRevenue += (Number(cItem.qty) * Number(cItem.price));
                                    }
                                });
                            }
                        });

                        const totalRevenue = totalCash + totalOnline;

                        return ( 
                            <div className="max-w-6xl mx-auto pb-10">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                    <h2 className="text-2xl font-bold">Sales & Transactions</h2>
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <button onClick={() => setDrawerModal(true)} className="flex-1 md:flex-none bg-yellow-500 hover:bg-yellow-400 text-black px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition whitespace-nowrap">💵 Daily Cash In Box</button>
                                        <button onClick={handleExportAnalytics} className="flex-1 md:flex-none bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                                    </div>
                                </div>
                                
                                <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide items-center w-full max-w-[100vw]">
                                    {['Today', 'Weekly', 'Monthly', 'Yearly', 'All', 'Custom'].map(filter => (
                                        <button 
                                            key={filter} 
                                            onClick={() => handleFilterChange(filter)} 
                                            className={`px-6 py-2 rounded-lg text-sm font-bold transition ${analyticsFilter === filter ? 'bg-cyan-500 text-black shadow-lg shadow-cyan-500/20' : 'bg-slate-800 text-gray-400 hover:bg-slate-700 hover:text-white border border-white/10'}`}
                                        >
                                            {filter}
                                        </button>
                                    ))}
                                    {analyticsFilter === 'Custom' && (
                                        <input 
                                            type="date" 
                                            value={analyticsCustomDate}
                                            onChange={(e) => setAnalyticsCustomDate(e.target.value)}
                                            className="bg-slate-800 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-cyan-500 outline-none transition ml-2"
                                        />
                                    )}
                                </div>

                                {/* PRIMARY 3 STAT CARDS (Total, Cash, Online) */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                    <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-cyan-500">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Total Revenue ({analyticsFilter})</p>
                                        <p className="text-3xl font-black text-white mt-1">₹{totalRevenue}</p>
                                    </div>
                                    <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-green-500">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Cash Received</p>
                                        <p className="text-3xl font-black text-green-400 mt-1">₹{totalCash}</p>
                                    </div>
                                    <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-blue-500">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Online Received</p>
                                        <p className="text-3xl font-black text-blue-400 mt-1">₹{totalOnline}</p>
                                    </div>
                                </div>

                                
                               {/* NEW: REVENUE SOURCE SPLIT CARDS */}
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                                    <div onClick={() => setSelectedRevenueCategory('Food')} className="bg-slate-800 p-5 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-orange-500 cursor-pointer hover:-translate-y-1 transition hover:border-orange-500/50">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Food Revenue</p>
                                        <p className="text-2xl font-black text-orange-400 mt-1">₹{totalFoodRevenue}</p>
                                    </div>
                                    <div onClick={() => setSelectedRevenueCategory('Inventory')} className="bg-slate-800 p-5 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-purple-500 cursor-pointer hover:-translate-y-1 transition hover:border-purple-500/50">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Inventory Revenue</p>
                                        <p className="text-2xl font-black text-purple-400 mt-1">₹{totalInvRevenue}</p>
                                    </div>
                                    <div onClick={() => setSelectedRevenueCategory('Custom')} className="bg-slate-800 p-5 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-pink-500 cursor-pointer hover:-translate-y-1 transition hover:border-pink-500/50">
                                        <p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Custom Items Revenue</p>
                                        <p className="text-2xl font-black text-pink-400 mt-1">₹{totalCustomRevenue}</p>
                                    </div>
                                </div>

                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 h-[400px] w-full shadow-lg mb-6">
                                    {getAnalyticsData().length > 0 ? (
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={getAnalyticsData()}>
                                                <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} />
                                                <XAxis dataKey="name" stroke="#888" tickLine={false} axisLine={false} />
                                                <YAxis stroke="#888" tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} />
                                                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} itemStyle={{ color: '#06b6d4', fontWeight: 'bold' }} cursor={{fill: '#334155'}} />
                                                <Bar dataKey="sales" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={60} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 font-bold space-y-3">
                                            <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                                            <p>No sales data found for {analyticsFilter.toLowerCase()}.</p>
                                        </div>
                                    )}
                                </div>

                                <h3 className="text-xl font-bold mb-4">Transaction Ledger ({analyticsFilter})</h3>
                                <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full max-w-[100vw] overflow-x-auto shadow-lg">
                                    <table className="w-full text-left text-sm text-gray-400 min-w-[800px]">
                                        <thead className="bg-black/30 text-white uppercase text-xs">
                                            <tr>
                                                <th className="p-4">Order ID</th>
                                                <th className="p-4">Date</th>
                                                <th className="p-4">Customer</th>
                                                <th className="p-4">Amount</th>
                                                <th className="p-4">Method</th>
                                                <th className="p-4">Txn ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {currentTxns.map(order => ( 
                                                <tr key={order.id} className="border-b border-white/5 hover:bg-white/5">
                                                    <td className="p-4 font-mono text-white">#{order.displayId || order.id}</td>
                                                    <td className="p-4">{order.date} {order.time}</td>
                                                    <td className="p-4">{order.customer?.name || 'Walk-in'}</td>
                                                    <td className="p-4 font-bold text-green-400">₹{order.total}</td>
                                                    <td className="p-4">
                                                        {order.paymentMethod === 'Split' ? (
                                                            <div className="flex flex-col items-start">
                                                                <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs font-bold mb-1">Split</span>
                                                                <span className="text-[10px] text-gray-500">Cash: ₹{order.splitAmounts?.cash} | Online: ₹{order.splitAmounts?.online}</span>
                                                            </div>
                                                        ) : (
                                                            <span className={`px-2 py-1 rounded text-xs font-bold ${String(order.paymentMethod || '').toLowerCase().includes('online') || String(order.paymentMethod || '').toLowerCase().includes('upi') || String(order.paymentMethod || '').toLowerCase().includes('card') ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                                                                {order.paymentMethod || 'Cash'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4 font-mono text-xs text-gray-500">{order.paymentId || '-'}</td>
                                                </tr> 
                                            ))}
                                        </tbody>
                                    </table>
                                    {currentTxns.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No transactions found for this period.</div>}
                                </div>
                                
                                {/* Pagination Controls */}
                                {totalTxnPages > 1 && (
                                    <div className="flex justify-between items-center mt-4">
                                        <button onClick={() => setTransactionPage(prev => Math.max(1, prev - 1))} disabled={transactionPage === 1} className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 hover:bg-slate-700 transition">Previous</button>
                                        <span className="text-sm text-gray-400">Page {transactionPage} of {totalTxnPages}</span>
                                        <button onClick={() => setTransactionPage(prev => Math.min(totalTxnPages, prev + 1))} disabled={transactionPage === totalTxnPages} className="px-4 py-2 bg-slate-800 text-white rounded-lg disabled:opacity-50 hover:bg-slate-700 transition">Next</button>
                                    </div>
                                )}
                            </div> 
                        );
                    })()}
                    
                    {/* TAB: REGISTERED USERS */}
                    {activeTab === 'users' && ( <div className="max-w-6xl mx-auto"><h2 className="text-2xl font-bold mb-6">Registered Users</h2><div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full overflow-x-auto"><table className="w-full text-sm text-left text-gray-400 min-w-[600px]"><thead className="text-xs text-gray-200 uppercase bg-black/30"><tr><th className="p-4">Name</th><th className="p-4">Phone</th><th className="p-4">Joined</th><th className="p-4">Orders</th></tr></thead><tbody>{users.map((u, idx) => <tr key={idx} className="border-b border-white/5 hover:bg-white/5"><td className="p-4 font-bold text-white capitalize">{u.name}</td><td className="p-4 font-mono text-cyan-400">{u.phone}</td><td className="p-4">{u.joined_at || 'N/A'}</td><td className="p-4"><span className="bg-white/10 px-2 py-1 rounded text-xs font-bold text-white">{u.total_orders || 0}</span></td></tr>)}</tbody></table></div></div> )}
                    
                    {/* TAB: MENU MANAGER */}
                    {activeTab === 'menu' && ( 
                        <div className="max-w-4xl mx-auto">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                <h2 className="text-2xl font-bold">Stock Manager</h2>
                                <div className="flex gap-2 w-full md:w-auto">
                                    <button onClick={() => setCatModal(true)} className="flex-1 md:flex-none bg-slate-700 hover:bg-white hover:text-black px-4 py-2 rounded-lg text-sm font-bold transition">+ Category</button>
                                    <button onClick={() => setItemModal({open:true, mode:'add', data:null})} className="flex-1 md:flex-none bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-400 transition">+ Item</button>
                                </div>
                            </div>
                            <div className="mb-6">
                                <div className="relative">
                                    <span className="absolute inset-y-0 left-0 flex items-center pl-4 text-gray-400"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg></span>
                                    <input type="text" placeholder="Search categories or items..." value={menuSearchQuery} onChange={(e) => setMenuSearchQuery(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-white focus:border-cyan-500 outline-none placeholder-gray-500 transition" />
                                    {menuSearchQuery && ( <button onClick={() => setMenuSearchQuery("")} className="absolute inset-y-0 right-0 flex items-center pr-4 text-gray-400 hover:text-white">✕</button> )}
                                </div>
                            </div>
                            <div className="space-y-6">
                                {filteredCategoriesForMenu.length === 0 ? ( <div className="text-center py-12 bg-slate-800/30 rounded-xl border border-white/5"><p className="text-gray-400 font-bold">No categories or items found for "{menuSearchQuery}"</p></div> ) : (
                                    filteredCategoriesForMenu.map(cat => ( 
                                        <div key={cat.id} className="bg-slate-800/50 rounded-xl p-6 border border-white/5">
                                            <div className="flex justify-between items-center border-b border-white/10 pb-2 mb-4">
                                                <h3 className="text-xl font-bold text-cyan-400">{cat.name}</h3>
                                                <button onClick={() => deleteCategory(cat.id)} className="text-red-400 text-xs hover:text-red-300">Delete Category</button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                {menuItems.filter(item => {
                                                    if (!menuSearchQuery) return item.category_id === cat.id;
                                                    const lowerQ = menuSearchQuery.toLowerCase();
                                                    return item.category_id === cat.id && (cat.name.toLowerCase().includes(lowerQ) || item.name.toLowerCase().includes(lowerQ) || (item.description && item.description.toLowerCase().includes(lowerQ)));
                                                }).map((item, idx) => ( 
                                                    <div key={idx} className={`flex items-center gap-3 bg-black/20 p-3 rounded-xl border ${item.in_stock === false ? 'border-red-500/30 opacity-75' : 'border-white/5 hover:border-white/10 transition'}`}>
                                                        <img src={item.img} className={`w-12 h-12 rounded-lg object-cover ${item.in_stock === false ? 'grayscale' : ''}`} />
                                                        <div className="flex-1 min-w-0"><h4 className="font-bold text-sm truncate">{item.name} {item.is_special && '⭐'}</h4><p className="text-xs text-gray-500">{item.price}</p></div>
                                                        <div className="flex gap-2"><button onClick={() => toggleSpecial(item)} className={`p-2 rounded text-xs ${item.is_special ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}>★</button><button onClick={() => setItemModal({open:true, mode:'edit', data:item})} className="text-xs bg-blue-500/10 text-blue-400 p-2 rounded hover:bg-blue-50 hover:text-white">✏️</button><button onClick={() => toggleStock(item)} className={`text-[10px] font-bold px-2 py-1 rounded transition ${item.in_stock !== false ? 'bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-black' : 'bg-red-500/20 text-red-400 hover:bg-red-50 hover:text-white'}`}>{item.in_stock !== false ? 'In' : 'Out'}</button><button onClick={() => deleteItem(item.id)} className="text-xs bg-red-500/10 text-red-400 p-2 rounded hover:bg-red-50 hover:text-white">🗑</button></div>
                                                    </div> 
                                                ))}
                                            </div>
                                        </div> 
                                    ))
                                )}
                            </div>
                        </div> 
                    )}
                    
                    {/* TAB: MOMENTS */}
                    {activeTab === 'moments' && ( 
                        <div className="max-w-5xl mx-auto">
                            <div className="flex justify-between items-center mb-6">
                                <h2 className="text-2xl font-bold">Moments Gallery</h2>
                                <button onClick={() => setMomentModal({ open: true, mode: 'add', data: null })} className="bg-cyan-500 text-black px-4 py-2 rounded-lg text-sm font-bold hover:bg-cyan-400 transition">+ Upload Moment</button>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {moments.map(m => ( 
                                    <div key={m.id} className="relative group rounded-xl overflow-hidden aspect-[3/4]">
                                        <img src={m.src} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"></div>
                                        <p className="absolute bottom-2 left-2 text-xs font-bold text-white z-10">{m.caption}</p>
                                        
                                       <div className="absolute top-2 right-2 flex gap-2 opacity-100 group-hover:opacity-100 transition">
                                            <button onClick={() => setMomentModal({ open: true, mode: 'edit', data: m })} className="bg-blue-500 text-white p-2 rounded-md shadow-lg hover:bg-blue-400 transition flex items-center justify-center" title="Edit">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
                                            </button>
                                            <button onClick={() => deleteMoment(m.id)} className="bg-red-500 text-white p-2 rounded-md shadow-lg hover:bg-red-400 transition flex items-center justify-center" title="Delete">
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                            </button>
                                        </div>
                                    </div> 
                                ))}
                            </div>
                        </div> 
                    )}

                  {/* TAB: HISTORY */}
                    {activeTab === 'history' && (() => {
                        // 1. Calculate totals for the searched item
                        let searchedItemQty = 0;
                        let searchedItemRevenue = 0;
                        
                        if (historyItemSearch.trim() !== '') {
                            const query = historyItemSearch.toLowerCase();
                            
                            getSortedHistory().forEach(order => {
                                // Only calculate revenue and quantity from completed orders
                                if (order.status !== 'Picked Up') return; 
                                
                                const itemsObj = order.items || {};
                                const customArr = order.customItems || [];
                                
                                // Check regular menu items
                                Object.entries(itemsObj).forEach(([id, qty]) => {
                                    const mItem = menuItems.find(i => i.id === parseInt(id));
                                    if (mItem && mItem.name.toLowerCase().includes(query)) {
                                        searchedItemQty += Number(qty);
                                        const price = parseInt(String(mItem.price).replace(/[^0-9]/g, '')) || 0;
                                        searchedItemRevenue += (Number(qty) * price);
                                    }
                                });
                                
                                // Check custom/inventory items
                                customArr.forEach(cItem => {
                                    if (cItem.name.toLowerCase().includes(query)) {
                                        searchedItemQty += Number(cItem.qty);
                                        searchedItemRevenue += (Number(cItem.qty) * Number(cItem.price));
                                    }
                                });
                            });
                        }

                        return (
                            <div className="max-w-6xl mx-auto">
                                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                    <h2 className="text-2xl font-bold">Order History</h2>
                                     <div className="relative flex-1 md:w-72">
                                            
                                            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">🔍</span>
                                            <input 
                                                type="text" 
                                                placeholder="Search" 
                                                value={historyItemSearch}
                                                onChange={(e) => setHistoryItemSearch(e.target.value)}
                                                className="w-full bg-slate-800 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white focus:border-cyan-500 outline-none transition"
                                            />
                                        </div>
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <button onClick={() => setPendingModal(true)} className="bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm font-bold transition shadow-lg flex items-center gap-2">
                                    ⚠️ Pending
                                    <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">
                                        {orders.filter(o => o.paymentStatus === 'Pending').length}
                                    </span>
                                </button>
                                       
                                        <button onClick={handleExportHistory} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-xl text-sm font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                                    </div>
                                </div>

                                {/* NEW: ITEM SEARCH SUMMARY BANNER */}
                                {historyItemSearch.trim() !== '' && (
                                    <div className="bg-cyan-500/10 border border-cyan-500/30 p-5 rounded-xl mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-lg animate-fade-in">
                                        <div>
                                            <h3 className="text-cyan-400 font-bold text-lg">Search Results for "{historyItemSearch}"</h3>
                                            <p className="text-xs text-gray-400 mt-1">Total units sold and revenue from <strong className="text-white">completed orders</strong> matching this item.</p>
                                        </div>
                                        <div className="flex gap-8 bg-black/20 p-3 rounded-lg border border-white/5">
                                            <div>
                                                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Total Qty Sold</p>
                                                <p className="text-2xl font-black text-white">{searchedItemQty}</p>
                                            </div>
                                            <div>
                                                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Total Revenue</p>
                                                <p className="text-2xl font-black text-green-400">₹{searchedItemRevenue}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full max-w-[100vw] overflow-x-auto shadow-lg">
                                    <table className="w-full text-sm text-left text-gray-400 min-w-[850px]">
                                        <thead className="text-xs text-gray-200 uppercase bg-black/30">
                                            <tr>
                                                <th className="p-4">ID</th>
                                                <th className="p-4">Time</th>
                                                <th className="p-4">Location</th>
                                                <th className="p-4">Amount</th>
                                                <th className="p-4">Method</th>
                                                <th className="p-4">Status</th>
                                                <th className="p-4 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {getSortedHistory().map(order => ( 
                                                <tr key={order.id} className="border-b border-white/5 hover:bg-white/5 transition">
                                                    <td className="p-4 font-bold text-white">#{order.displayId || order.id}</td>
                                                    <td className="p-4">{order.date} {order.time}</td>
                                                    <td className="p-4">{order.tableNo} • {order.customer?.name}</td>
                                                    <td className="p-4 text-green-400 font-bold">₹{order.total}</td>
                                                    <td className="p-4">
                                                        {order.paymentMethod === 'Split' ? (
                                                            <div className="flex flex-col items-start">
                                                                <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs font-bold mb-1">Split</span>
                                                                <span className="text-[10px] text-gray-500">Cash: ₹{order.splitAmounts?.cash} | Online: ₹{order.splitAmounts?.online}</span>
                                                            </div>
                                                        ) : (
                                                            <span className={`px-2 py-1 rounded text-xs font-bold ${String(order.paymentMethod || '').toLowerCase().includes('online') || String(order.paymentMethod || '').toLowerCase().includes('upi') || String(order.paymentMethod || '').toLowerCase().includes('card') ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>
                                                                {order.paymentMethod || 'Cash'}
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="p-4">
                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${order.status === 'Picked Up' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                                            {order.status}
                                                        </span>
                                                    </td>
                                                    <td className="p-4 text-center flex justify-center gap-2">
                                                        
                                                        {/* NEW EYE ICON - VIEW DETAILS */}
                                                        <button onClick={() => setViewOrderDetails(order)} className="bg-blue-500/20 hover:bg-blue-500 text-blue-400 hover:text-white p-2 rounded-lg transition" title="View Details">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                        </button>

                                                        <button onClick={() => openOrderActivity(order)} className="bg-purple-500/20 hover:bg-purple-500 text-purple-400 hover:text-white p-2 rounded-lg transition" title="Order Activity">🕘</button>
                                                         {/* NEW EDIT HISTORY BUTTON */}
                                                        <button onClick={() => setEditHistoryModal({ open: true, order: order, tempMethod: order.paymentMethod || 'Cash' })} className="bg-yellow-500/20 hover:bg-yellow-500 text-yellow-400 hover:text-black p-2 rounded-lg transition" title="Edit Order Details">
                                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                        </button>

                                                        {/* WHATSAPP PDF BUTTON */}
                                                        {order.paymentStatus === 'Paid' && (
                                                            <button onClick={(e) => sendWhatsAppPDF(order, e)} className="bg-[#25D366]/20 hover:bg-[#25D366] text-[#25D366] hover:text-white p-2 rounded-lg transition" title="Share Bill as PDF">
                                                                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 00-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                                                        </button>
                                                    )}
                                                    
                                                    <button onClick={() => printBill(order)} className="bg-slate-700 hover:bg-white hover:text-black p-2 rounded-lg transition" title="Print Bill">
                                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                                                    </button>
                                                </td>
                                            </tr> 
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div> 
                    );
                    })()}
                    
                    {/* --- SETTINGS TAB --- */}
                    {activeTab === 'settings' && (
                        <div className="max-w-4xl mx-auto space-y-8 pb-10">
                            <h2 className="text-2xl font-bold mb-6">App Settings</h2>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-blue-500">
                                <h3 className="text-xl font-bold mb-2 text-white">Push Notifications</h3>
                                <p className="text-sm text-gray-400 mb-4">Enable lock-screen notifications for new orders on this device.</p>
                                <button
    onClick={requestValoNotificationPermission}
    className="bg-blue-500 hover:bg-blue-400 text-white font-bold px-6 py-3 rounded-lg transition shadow-lg shadow-blue-500/20 flex items-center gap-2"
>
    🔔 Enable Notifications
</button>
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-xl font-bold mb-2">App Name</h3>
                                <p className="text-sm text-gray-400 mb-4">Change the name displayed in the sidebar and header.</p>
                                <div className="flex gap-4 max-w-sm">
                                    <input type="text" id="appNameInput" defaultValue={appName} className="flex-1 bg-black/30 border border-white/10 rounded-lg p-3 text-white focus:border-cyan-500 outline-none transition" />
                                    <button onClick={() => {
                                        const newName = document.getElementById('appNameInput').value;
                                        setAppName(newName);
                                        localStorage.setItem('valo_app_name', newName);
                                        alert("App name successfully updated!");
                                    }} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg transition">Save</button>
                                </div>
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-xl font-bold mb-2">Custom Alert Tone</h3>
                                <p className="text-sm text-gray-400 mb-4">Upload a short audio file (MP3, WAV) to loop when a new order arrives. (Stored locally on your device).</p>
                                <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                                    <input type="file" accept="audio/*" onChange={(e) => {
                                        const file = e.target.files[0];
                                        if(file) {
                                            const reader = new FileReader();
                                            reader.onloadend = () => {
                                                setAlertTone(reader.result);
                                                localStorage.setItem('valo_alert_tone', reader.result);
                                                alert("Alert tone updated!");
                                            };
                                            reader.readAsDataURL(file);
                                        }
                                    }} className="block w-full max-w-sm text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-cyan-500 file:text-black hover:file:bg-cyan-400 cursor-pointer" />
                                    
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <button onClick={() => {
                                            if (audioRef.current) {
                                                audioRef.current.currentTime = 0;
                                                audioRef.current.play().catch(() => alert("Click anywhere on the screen first to unlock audio testing."));
                                                setTimeout(() => { if(audioRef.current) audioRef.current.pause(); }, 3000);
                                            }
                                        }} className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 px-6 py-2 rounded-lg text-sm font-bold transition">Test Tone</button>
                                        
                                        <button onClick={() => {
                                            const defaultTone = 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg';
                                            setAlertTone(defaultTone);
                                            localStorage.removeItem('valo_alert_tone');
                                        }} className="flex-1 md:flex-none bg-red-500/20 text-red-400 hover:bg-red-50 hover:text-white px-6 py-2 rounded-lg text-sm font-bold transition">Reset Default</button>
                                    </div>
                                </div>
                            </div>
                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-cyan-500">
                                <h3 className="text-xl font-bold mb-1">Operator Accounts</h3>
                                <p className="text-sm text-gray-400 mb-4">Create a separate name and 4-digit PIN for each person who handles orders.</p>
                                <form onSubmit={saveStaffAccount} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 mb-5">
                                    <input type="text" value={staffAccountForm.name} onChange={e => setStaffAccountForm(prev => ({...prev, name: e.target.value}))} placeholder="Operator name" required className="bg-black/30 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-cyan-500" />
                                    <input type="password" value={staffAccountForm.pin} onChange={e => setStaffAccountForm(prev => ({...prev, pin: e.target.value.replace(/\D/g,'').slice(0,4)}))} placeholder="4-digit PIN" maxLength="4" required className="bg-black/30 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-cyan-500" />
                                    <button type="submit" disabled={staffAccountSaving} className="bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-5 py-3 rounded-lg disabled:opacity-50">{staffAccountSaving ? 'Saving...' : staffAccountForm.id ? 'Update' : 'Add Operator'}</button>
                                </form>
                                <div className="space-y-2">
                                    {staffAccounts.length === 0 ? <div className="text-sm text-gray-500 py-4">No operator accounts yet.</div> : staffAccounts.map(staff => (
                                        <div key={staff.id} className="flex items-center justify-between gap-3 bg-black/20 rounded-xl border border-white/5 p-3">
                                            <div><p className="font-bold text-white">{staff.name}</p><p className="text-[10px] text-gray-500">Operator ID: {staff.id}</p></div>
                                            <div className="flex gap-2">
                                                <button type="button" onClick={() => setStaffAccountForm({id:staff.id,name:staff.name,pin:''})} className="bg-blue-500/20 text-blue-400 hover:bg-blue-500 hover:text-white px-3 py-2 rounded-lg text-xs font-bold">Edit</button>
                                                <button type="button" onClick={() => deactivateStaffAccount(staff.id)} className="bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white px-3 py-2 rounded-lg text-xs font-bold">Remove</button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>


                           <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
    <h3 className="text-xl font-bold mb-2">Change Admin PIN</h3>
    <p className="text-sm text-gray-400 mb-4">Update the 4-digit code required to unlock this dashboard globally across all devices.</p>
    <form onSubmit={async (e) => {
        e.preventDefault();
        
        // 1. Fetch current PIN from Database to verify old PIN
        const { data: dbData } = await supabase.from('app_settings').select('admin_pin').eq('id', 1).single();
        const currentPin = dbData ? dbData.admin_pin : '6748';
        
        const oldPin = e.target.oldPin.value;
        const newPin = e.target.newPin.value;
        
        if(oldPin !== currentPin) {
            alert("Old PIN is incorrect!");
            return;
        }
        if(newPin.length < 4) {
            alert("New PIN must be exactly 4 digits.");
            return;
        }
        
        // 2. Save the New PIN to the Database permanently
        const { error } = await supabase.from('app_settings').update({ admin_pin: newPin }).eq('id', 1);
        
        if (error) {
            alert("Error updating database: " + error.message);
        } else {
            alert("Admin PIN successfully synced to Database!");
            e.target.reset();
        }
    }} className="space-y-4 max-w-sm">
        <input name="oldPin" type="password" placeholder="Current PIN" maxLength="4" autoComplete="new-password" required className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white tracking-widest text-center focus:border-cyan-500 outline-none transition" />
        <input name="newPin" type="password" placeholder="New PIN" maxLength="4" autoComplete="new-password" required className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-white tracking-widest text-center focus:border-cyan-500 outline-none transition" />
        <button type="submit" className="w-full bg-cyan-500 hover:bg-cyan-400 text-black font-bold px-6 py-3 rounded-lg shadow-lg shadow-cyan-500/20 transition">Update Global PIN</button>
    </form>
</div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

function SidebarBtn({ icon, label, active, onClick, badge }) { return (<button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-cyan-500 text-black font-bold shadow-lg shadow-cyan-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}><span className="text-lg">{icon}</span><span className="flex-1 text-left text-sm">{label}</span>{badge > 0 && <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-bounce">{badge}</span>}</button>); }
function StatusCard({ label, count, color }) { return (<div className="flex items-center gap-3 bg-slate-800 p-3 rounded-xl border border-white/5 shadow-lg"><div className={`w-3 h-3 rounded-full ${color} animate-pulse`}></div><div><p className="text-[10px] text-gray-400 uppercase font-bold">{label}</p><p className="text-xl font-bold text-white leading-none">{count}</p></div></div>); }
function getStatusColor(status) { switch(status) { case 'Received': return 'border-yellow-500 shadow-yellow-900/20'; case 'Preparing': return 'border-orange-500 shadow-orange-900/20'; case 'Ready': return 'border-green-500 shadow-green-900/20'; default: return 'border-gray-500'; } }
function getStatusBadge(status) { switch(status) { case 'Received': return 'bg-yellow-500 text-black'; case 'Preparing': return 'bg-orange-500 text-white animate-pulse'; case 'Ready': return 'bg-green-500 text-black'; default: return 'bg-gray-500 text-white'; } }
