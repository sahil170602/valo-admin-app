import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

const getFormattedDateForInput = (dateObj = new Date()) => {
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${year}-${month}-${day}`;
};

const normalizeDateStr = (dStr) => {
    if (!dStr) return null;
    const parts = dStr.split('/');
    if (parts.length === 3) {
        if (parts[0] === '8' || parts[0] === '08') {
            let y = parts[2]; if (y.length === 2) y = `20${y}`;
            return `${parts[1].padStart(2, '0')}/${parts[0].padStart(2, '0')}/${y}`;
        }
        let y = parts[2]; if (y.length === 2) y = `20${y}`;
        return `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${y}`;
    }
    return dStr; 
};

const exportCSV = (data, filename) => {
    if (!data || data.length === 0) return alert("No data available to export.");
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    for (const row of data) {
        const values = headers.map(header => `"${('' + (row[header] ?? '')).replace(/"/g, '\\"')}"`);
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

const processDocumentFile = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
        return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 1200; const MAX_HEIGHT = 1200;
            let width = img.width; let height = img.height;
            if (width > height) { if (width > MAX_WIDTH) { height = Math.round((height * MAX_WIDTH) / width); width = MAX_WIDTH; } } 
            else { if (height > MAX_HEIGHT) { width = Math.round((width * MAX_HEIGHT) / height); height = MAX_HEIGHT; } }
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(event.target.result);
    };
    reader.onerror = error => reject(error);
});

const getBookingDateObj = (dateStr, timeStr) => {
    if (!dateStr || !timeStr) return new Date();
    let year, month, day;
    if (dateStr.includes('/')) {
        [day, month, year] = dateStr.split('/');
    } else {
        [year, month, day] = dateStr.split('-');
    }
    const [hour, minute] = timeStr.split(':');
    return new Date(year, month - 1, day, hour, minute, 0);
};

const triggerNativeNotification = async (title, body) => {
    if (typeof window !== 'undefined' && "Notification" in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/splash.png' });
    }
    if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
        try {
            await LocalNotifications.requestPermissions();
            await LocalNotifications.schedule({
                notifications: [
                    {
                        title: title,
                        body: body,
                        id: new Date().getTime(),
                        schedule: { at: new Date(Date.now() + 1000) },
                        sound: null,
                        attachments: null,
                        actionTypeId: "",
                        extra: null
                    }
                ]
            });
        } catch(e) { console.error("Local Notification Error", e); }
    }
};

export default function RoomManagement({ appMode, toggleMode }) {
    const [activeTab, setActiveTab] = useState('live');
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [bookings, setBookings] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [roomPrices, setRoomPrices] = useState({ 'Room 1': 1000, 'Room 2': 1000 }); // Settings State
    const [tick, setTick] = useState(Date.now());
    const notifiedRef = useRef(new Set());
    const appName = localStorage.getItem('valo_app_name') || 'VALO';

    const [step, setStep] = useState(1);
    const [bookingDate, setBookingDate] = useState(getFormattedDateForInput());
    const [roomNo, setRoomNo] = useState('Room 1');
    const [numMembers, setNumMembers] = useState(1);
    const [membersData, setMembersData] = useState([{ id: 1, name: '', phone: '', age: '', gender: 'Male', aadhaarFront: null, aadhaarBack: null, isSaved: false }]);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [customAmount, setCustomAmount] = useState(null);
    const [advanceAmount, setAdvanceAmount] = useState(0);

    const [bookingFilter, setBookingFilter] = useState('Live'); 
    const [checkoutModal, setCheckoutModal] = useState({ open: false, bookingId: null, total: 0, advance: 0 });
    const [isSplitMode, setIsSplitMode] = useState(false);
    const [splitCash, setSplitCash] = useState('');
    const [splitOnline, setSplitOnline] = useState('');

    const [expenseForm, setExpenseForm] = useState({ desc: '', amount: '', mode: 'Cash' });
    const [expenseDateFilter, setExpenseDateFilter] = useState(() => getFormattedDateForInput());
    const [analyticsFilter, setAnalyticsFilter] = useState('Today'); 
    const [analyticsCustomDate, setAnalyticsCustomDate] = useState(() => getFormattedDateForInput());
    const [selectedRevenueCategory, setSelectedRevenueCategory] = useState(null);
    const [transactionPage, setTransactionPage] = useState(1);

    // ============================================================
    // LOW-EGRESS ROOM DATA SYNC
    // Initial load fetches each room table once. Realtime changes are
    // applied directly to local state instead of re-downloading all
    // bookings, expenses and settings for every change.
    // ============================================================
    const fetchRoomBookings = async () => {
        const { data } = await supabase.from('room_bookings').select('*').order('booking_date', { ascending: true });
        if (data) setBookings(data);
    };

    const fetchRoomExpenses = async () => {
        const { data } = await supabase.from('room_expenses').select('*').order('timestamp', { ascending: false });
        if (data) setExpenses(data);
    };

    const fetchRoomSettings = async () => {
        const { data } = await supabase.from('room_settings').select('*');
        if (data) {
            const prices = {};
            data.forEach(row => { prices[row.room_no] = Number(row.price_per_slot); });
            setRoomPrices(prev => ({ ...prev, ...prices }));
        }
    };

    const fetchRoomData = async () => {
        await Promise.all([fetchRoomBookings(), fetchRoomExpenses(), fetchRoomSettings()]);
    };

    const applyRoomRealtimeRow = (table, eventType, newRow, oldRow) => {
        const row = eventType === 'DELETE' ? oldRow : newRow;
        if (!row) return;
        const rowId = row.id;

        if (table === 'room_bookings') {
            if (eventType === 'DELETE') {
                setBookings(prev => prev.filter(item => String(item.id) !== String(rowId)));
                return;
            }
            setBookings(prev => {
                const index = prev.findIndex(item => String(item.id) === String(rowId));
                const next = [...prev];
                if (index === -1) next.push(row);
                else next[index] = { ...next[index], ...row };
                next.sort((a, b) => {
                    const ad = String(a.booking_date || '');
                    const bd = String(b.booking_date || '');
                    if (ad !== bd) return ad.localeCompare(bd);
                    return String(a.slot_start || '').localeCompare(String(b.slot_start || ''));
                });
                return next;
            });
            return;
        }

        if (table === 'room_expenses') {
            if (eventType === 'DELETE') {
                setExpenses(prev => prev.filter(item => String(item.id) !== String(rowId)));
                return;
            }
            setExpenses(prev => {
                const index = prev.findIndex(item => String(item.id) === String(rowId));
                const next = [...prev];
                if (index === -1) next.push(row);
                else next[index] = { ...next[index], ...row };
                next.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
                return next;
            });
            return;
        }

        if (table === 'room_settings') {
            if (eventType === 'DELETE') return;
            if (row.room_no) {
                setRoomPrices(prev => ({ ...prev, [row.room_no]: Number(row.price_per_slot) }));
            }
        }
    };

    useEffect(() => {
        fetchRoomData();
        const channel = supabase
            .channel('room-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'room_bookings' }, payload =>
                applyRoomRealtimeRow(payload?.table, payload?.eventType, payload?.new, payload?.old)
            )
            .on('postgres_changes', { event: '*', schema: 'public', table: 'room_expenses' }, payload =>
                applyRoomRealtimeRow(payload?.table, payload?.eventType, payload?.new, payload?.old)
            )
            .on('postgres_changes', { event: '*', schema: 'public', table: 'room_settings' }, payload =>
                applyRoomRealtimeRow(payload?.table, payload?.eventType, payload?.new, payload?.old)
            )
            .subscribe();
        return () => supabase.removeChannel(channel);
    }, []);

    useEffect(() => {
        const interval = setInterval(() => {
            const now = Date.now();
            setTick(now);
            
            bookings.forEach(b => {
                if (b.status === 'Upcoming') {
                    const startObj = getBookingDateObj(b.booking_date, b.slot_start);
                    const diffSecs = Math.floor((startObj.getTime() - now) / 1000);

                    if (diffSecs <= 43200 && diffSecs > 43190 && !notifiedRef.current.has(`${b.id}_12h`)) {
                        notifiedRef.current.add(`${b.id}_12h`);
                        triggerNativeNotification(`12 Hours Left!`, `Booking for ${b.customer_name} starts in 12 hours.`);
                    }
                    if (diffSecs <= 7200 && diffSecs > 7190 && !notifiedRef.current.has(`${b.id}_2h`)) {
                        notifiedRef.current.add(`${b.id}_2h`);
                        triggerNativeNotification(`Live Dashboard Alert`, `Booking for ${b.customer_name} is now in Live Dashboard!`);
                    }
                    if (diffSecs <= 0 && diffSecs > -10 && !notifiedRef.current.has(`${b.id}_start`)) {
                        notifiedRef.current.add(`${b.id}_start`);
                        triggerNativeNotification(`Room Started`, `The slot for ${b.customer_name} has just begun!`);
                    }
                }
            });
        }, 1000);
        return () => clearInterval(interval);
    }, [bookings]);

    const handleSaveSettings = async (e) => {
        e.preventDefault();
        const updates = [
            { room_no: 'Room 1', price_per_slot: roomPrices['Room 1'] },
            { room_no: 'Room 2', price_per_slot: roomPrices['Room 2'] }
        ];
        const { error } = await supabase.from('room_settings').upsert(updates);
        if (error) alert(error.message);
        else alert('Room prices updated successfully!');
    };

    const handleNumMembersChange = (e) => {
        const num = parseInt(e.target.value);
        setNumMembers(num);
        setMembersData(Array.from({ length: num }, (_, i) => membersData[i] || { id: i + 1, name: '', phone: '', age: '', gender: 'Male', aadhaarFront: null, aadhaarBack: null, isSaved: false }));
    };

    const updateMemberField = (id, field, value) => {
        setMembersData(membersData.map(m => m.id === id ? { ...m, [field]: value } : m));
    };

    const saveMember = (id) => {
        const member = membersData.find(m => m.id === id);
        if (!member.name || !member.phone || !member.age) return alert('Fill all basic details to save.');
        setMembersData(membersData.map(m => m.id === id ? { ...m, isSaved: true } : m));
    };

    const editMember = (id) => {
        setMembersData(membersData.map(m => m.id === id ? { ...m, isSaved: false } : m));
    };

    const getAvailableSlots = () => {
        const slots = [];
        const selectedIsToday = bookingDate === getFormattedDateForInput();
        const currentHour = new Date().getHours();
        for (let i = 0; i < 24; i++) {
            if (selectedIsToday && i <= currentHour) continue;
            const startHour = String(i).padStart(2, '0');
            const endHour = String((i + 1) % 24).padStart(2, '0');
            const displayStart = new Date(`2000-01-01T${startHour}:00:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const displayEnd = new Date(`2000-01-01T${endHour}:00:00`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            slots.push({ startVal: `${startHour}:00:00`, endVal: `${endHour}:00:00`, label: `${displayStart} - ${displayEnd}` });
        }
        return slots;
    };

    const handleConfirmBooking = async () => {
        let finalAdvance = advanceAmount;
        if (finalAdvance === 0 || finalAdvance === null) {
            const adv = window.prompt("Enter Advance Amount Paid (₹):", "0");
            if (adv === null) return;
            finalAdvance = Number(adv);
        }

        const processedMembers = await Promise.all(membersData.map(async m => ({
            name: m.name, phone: m.phone, age: m.age, gender: m.gender,
            aadhaar_front: m.aadhaarFront ? await processDocumentFile(m.aadhaarFront) : null,
            aadhaar_back: m.aadhaarBack ? await processDocumentFile(m.aadhaarBack) : null
        })));

        const payload = {
            customer_name: processedMembers[0].name,
            phone: processedMembers[0].phone,
            room_no: roomNo,
            members: numMembers,
            booking_date: bookingDate,
            slot_start: selectedSlot.startVal,
            slot_end: selectedSlot.endVal,
            status: 'Upcoming',
            members_data: processedMembers,
            total_amount: customAmount !== null ? customAmount : roomPrices[roomNo],
            advance_paid: finalAdvance
        };

        const { error } = await supabase.from('room_bookings').insert([payload]);
        if (error) alert(error.message);
        else {
            alert('Booking Confirmed Successfully!');
            setStep(1); setBookingDate(getFormattedDateForInput()); setRoomNo('Room 1'); setNumMembers(1);
            setMembersData([{ id: 1, name: '', phone: '', age: '', gender: 'Male', aadhaarFront: null, aadhaarBack: null, isSaved: false }]);
            setSelectedSlot(null); setCustomAmount(null); setAdvanceAmount(0);
            setBookingFilter('Upcoming');
            setActiveTab('live');
        }
    };

    const handleCheckoutComplete = async (method, splitData = null) => {
        const { bookingId } = checkoutModal;
        const updates = { status: 'Completed', payment_method: method };
        if (splitData) {
            updates.split_cash = splitData.cash;
            updates.split_online = splitData.online;
        }
        const { error } = await supabase.from('room_bookings').update(updates).eq('id', bookingId);
        if (error) { alert(error.message); return; }
        setBookings(prev => prev.map(b => String(b.id) === String(bookingId) ? { ...b, ...updates } : b));
        setCheckoutModal({ open: false, bookingId: null, total: 0, advance: 0 });
        setIsSplitMode(false);
    };

    const handleAddExpense = async (e) => {
        e.preventDefault();
        const d = new Date();
        const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
        const payload = {
            description: expenseForm.desc,
            amount: Number(expenseForm.amount),
            mode: expenseForm.mode,
            date: `${y}-${m}-${day}`,
            time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            timestamp: Date.now()
        };
        const { data, error } = await supabase.from('room_expenses').insert([payload]).select('*').single();
        if (error) { alert(error.message); return; }
        if (data) setExpenses(prev => [data, ...prev.filter(item => String(item.id) !== String(data.id))]);
        setExpenseForm({ desc: '', amount: '', mode: 'Cash' });
    };

    const calculateDailyFinancials = () => {
        const dailyData = {};
        bookings.forEach(b => {
            if (b.status === 'Completed') {
                const nDate = normalizeDateStr(b.booking_date);
                if (!nDate) return;
                if (!dailyData[nDate]) dailyData[nDate] = { cashIn: 0, onlineIn: 0, cashOut: 0, onlineOut: 0 };
                let cIn = 0; let oIn = 0;
                const pm = String(b.payment_method || 'Cash').toLowerCase();
                if (pm === 'split') { cIn = Number(b.split_cash || 0); oIn = Number(b.split_online || 0); } 
                else if (pm.includes('online') || pm.includes('upi') || pm.includes('card')) { oIn = Number(b.total_amount); } 
                else { cIn = Number(b.total_amount); }
                dailyData[nDate].cashIn += cIn; dailyData[nDate].onlineIn += oIn;
            }
        });

        expenses.forEach(e => {
            const nDate = normalizeDateStr(e.date);
            if (!nDate) return;
            if (!dailyData[nDate]) dailyData[nDate] = { cashIn: 0, onlineIn: 0, cashOut: 0, onlineOut: 0 };
            if (e.mode === 'Online') dailyData[nDate].onlineOut += Number(e.amount);
            else dailyData[nDate].cashOut += Number(e.amount);
        });

        const sortedDates = Object.keys(dailyData).sort((a, b) => {
            const [ya, ma, da] = a.includes('/') ? a.split('/').reverse() : a.split('-');
            const [yb, mb, db] = b.includes('/') ? b.split('/').reverse() : b.split('-');
            return new Date(`${ya}-${ma}-${da}`).getTime() - new Date(`${yb}-${mb}-${db}`).getTime();
        });

        let runningRemaining = 0; let totalLifetimeCashIn = 0; let totalLifetimeOnlineIn = 0; let totalLifetimeCashOut = 0; let totalLifetimeOnlineOut = 0;
        const ledger = {};
        sortedDates.forEach(date => {
            const day = dailyData[date]; const initialAmount = runningRemaining;
            const dayNet = (day.cashIn + day.onlineIn) - (day.cashOut + day.onlineOut);
            runningRemaining += dayNet;
            totalLifetimeCashIn += day.cashIn; totalLifetimeOnlineIn += day.onlineIn;
            totalLifetimeCashOut += day.cashOut; totalLifetimeOnlineOut += day.onlineOut;
            ledger[date] = { ...day, initialAmount, remainingAmount: runningRemaining };
        });

        const filterDateParts = expenseDateFilter.split('-');
        const displayFilterDate = filterDateParts.length === 3 ? `${filterDateParts[0]}-${filterDateParts[1]}-${filterDateParts[2]}` : expenseDateFilter;
        const todayStats = ledger[displayFilterDate] || { cashIn: 0, onlineIn: 0, cashOut: 0, onlineOut: 0, initialAmount: 0, remainingAmount: 0 };
        const dayExpenses = expenses.filter(e => normalizeDateStr(e.date) === normalizeDateStr(displayFilterDate));

       return {
            dateStr: displayFilterDate, initialAmount: todayStats.initialAmount, cashIn: todayStats.cashIn, onlineIn: todayStats.onlineIn,
            cashOut: todayStats.cashOut, onlineOut: todayStats.onlineOut, totalRem: todayStats.remainingAmount,
            lifetimeCashIn: totalLifetimeCashIn, lifetimeOnlineIn: totalLifetimeOnlineIn, lifetimeCashOut: totalLifetimeCashOut, lifetimeOnlineOut: totalLifetimeOnlineOut,
            lifetimeCashRem: totalLifetimeCashIn - totalLifetimeCashOut, lifetimeOnlineRem: totalLifetimeOnlineIn - totalLifetimeOnlineOut,
            lifetimeTotalRem: runningRemaining, dayExpenses
        };
    };

    const financials = calculateDailyFinancials();

    const getFilteredTransactions = () => {
        let filtered = bookings.filter(b => b.status === 'Completed');
        if (analyticsFilter === 'Custom') {
            filtered = filtered.filter(b => b.booking_date === analyticsCustomDate);
        } else if (analyticsFilter !== 'All') {
            const now = new Date();
            filtered = filtered.filter(b => {
                const bDate = getBookingDateObj(b.booking_date, b.slot_start);
                if (analyticsFilter === 'Today') return bDate.toDateString() === now.toDateString();
                if (analyticsFilter === 'Weekly') return Math.ceil(Math.abs(now - bDate) / (1000 * 60 * 60 * 24)) <= 7;
                if (analyticsFilter === 'Monthly') return bDate.getMonth() === now.getMonth() && bDate.getFullYear() === now.getFullYear();
                if (analyticsFilter === 'Yearly') return bDate.getFullYear() === now.getFullYear();
                return true;
            });
        }
        return filtered.sort((a, b) => b.id - a.id);
    };

    const getAnalyticsData = () => {
        const map = {};
        const filteredTxns = getFilteredTransactions();
        filteredTxns.forEach(b => {
            const bDate = getBookingDateObj(b.booking_date, b.slot_start);
            let key = '';
            if (analyticsFilter === 'Today' || analyticsFilter === 'Custom') key = bDate.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
            else if (analyticsFilter === 'Weekly') key = bDate.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });
            else if (analyticsFilter === 'Monthly') key = bDate.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
            else if (analyticsFilter === 'Yearly' || analyticsFilter === 'All') key = bDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
            if (!map[key]) map[key] = { name: key, sales: 0, ts: bDate.getTime() };
            map[key].sales += Number(b.total_amount) || 0;
        });
        return Object.values(map).sort((a, b) => a.ts - b.ts);
    };

    const filteredTxns = getFilteredTransactions();
    const txnsPerPage = 15;
    const totalTxnPages = Math.max(1, Math.ceil(filteredTxns.length / txnsPerPage));
    const currentTxns = filteredTxns.slice((transactionPage - 1) * txnsPerPage, transactionPage * txnsPerPage);

    const nowMs = tick;

    const liveBookings = bookings.filter(b => {
        if (b.status !== 'Upcoming') return false;
        const startObj = getBookingDateObj(b.booking_date, b.slot_start);
        const endObj = getBookingDateObj(b.booking_date, b.slot_end);
        if (startObj.getTime() < endObj.getTime() && endObj.getTime() < nowMs) return true;
        const diffHrs = (startObj.getTime() - nowMs) / (1000 * 60 * 60);
        return diffHrs <= 2.0; 
    });

    const upcomingBookings = bookings.filter(b => {
        if (b.status !== 'Upcoming') return false;
        const startObj = getBookingDateObj(b.booking_date, b.slot_start);
        const diffHrs = (startObj.getTime() - nowMs) / (1000 * 60 * 60);
        return diffHrs > 2.0;
    });

    const completedBookings = bookings.filter(b => b.status === 'Completed');

    const getTimerData = (booking) => {
        const startObj = getBookingDateObj(booking.booking_date, booking.slot_start);
        const endObj = getBookingDateObj(booking.booking_date, booking.slot_end);
        const startMs = startObj.getTime();
        const endMs = endObj.getTime();

        if (nowMs < startMs) {
            const diff = startMs - nowMs;
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            return { label: 'Starts In', timeString: `-${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`, color: 'text-yellow-400', pulse: false };
        } else if (nowMs >= startMs && nowMs <= endMs) {
            const diff = nowMs - startMs;
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            return { label: 'Running Time', timeString: `+${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`, color: 'text-green-400', pulse: false };
        } else {
            const diff = nowMs - endMs;
            const h = Math.floor(diff / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);
            return { label: 'Overdue By', timeString: `+${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`, color: 'text-red-500', pulse: true };
        }
    };

    return (
        <div className="h-screen w-full bg-slate-900 text-white font-sans flex overflow-hidden">
            <style dangerouslySetInnerHTML={{__html: `::-webkit-scrollbar { display: none; } * { -ms-overflow-style: none; scrollbar-width: none; }`}} />

            {isSidebarOpen && (<div onClick={() => setIsSidebarOpen(false)} className="fixed inset-0 bg-black/80 z-40 md:hidden backdrop-blur-sm animate-fade-in"></div>)}
            
            <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-950 border-r border-yellow-500/30 p-6 flex flex-col transition-transform duration-300 md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
                <div className="flex justify-between items-center mb-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-yellow-500 rounded-lg flex items-center justify-center font-bold text-black text-xl">{appName.charAt(0).toUpperCase()}</div>
                        <div><h1 className="text-md font-bold font-serif tracking-wide text-yellow-500">{appName.toUpperCase()}</h1></div>
                    </div>
                    <div onClick={toggleMode} className="hidden md:flex w-14 h-7 items-center rounded-full p-1 cursor-pointer transition-colors duration-300 bg-yellow-500/20 border border-yellow-500/50" title="Switch to Food Mode">
                        <div className="w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center text-[10px] translate-x-7 bg-yellow-500">🏨</div>
                    </div>
                    <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-2 text-gray-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <nav className="space-y-2 flex-1 overflow-y-auto pr-2">
                    <SidebarBtn icon="🛏️" label="Live Bookings" active={activeTab === 'live'} onClick={() => { setActiveTab('live'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📅" label="Booking System" active={activeTab === 'book'} onClick={() => { setActiveTab('book'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="💸" label="Room Expenses" active={activeTab === 'expenses'} onClick={() => { setActiveTab('expenses'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="📈" label="Analytics" active={activeTab === 'analytics'} onClick={() => { setActiveTab('analytics'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="👥" label="Users & History" active={activeTab === 'users'} onClick={() => { setActiveTab('users'); setIsSidebarOpen(false); }} />
                    <SidebarBtn icon="⚙️" label="Settings" active={activeTab === 'settings'} onClick={() => { setActiveTab('settings'); setIsSidebarOpen(false); }} />
                </nav>
            </aside>

            <div className="flex-1 flex flex-col h-screen overflow-hidden">
                <header className="md:hidden bg-slate-900 border-b border-yellow-500/20 p-4 flex items-center justify-between z-30 sticky top-0">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 bg-white/10 rounded-lg text-yellow-500">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                    </button>
                    <span className="font-bold text-[22px] text-yellow-500 tracking-wide">{appName}</span>
                    <div className="flex items-center">
                        <div onClick={toggleMode} className="w-14 h-7 flex items-center rounded-full p-1 cursor-pointer transition-colors duration-300 mr-3 bg-yellow-500/20 border border-yellow-500/50">
                            <div className="w-5 h-5 rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center text-[10px] translate-x-7 bg-yellow-500">🏨</div>
                        </div>
                        <button className="p-2 bg-yellow-500/20 text-yellow-500 rounded-lg hover:bg-yellow-500 hover:text-black transition">🔔</button>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-900 relative">
                    
                    {/* CHECKOUT MODAL */}
                    {checkoutModal.open && (
                        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                            <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-sm border border-yellow-500/30 text-center shadow-2xl animate-scale-in">
                                {!isSplitMode ? (
                                    <>
                                        <h3 className="text-xl font-bold mb-2 text-white">Checkout Room</h3>
                                        <div className="bg-black/30 p-4 rounded-xl mb-6">
                                            <div className="flex justify-between text-gray-400 text-sm mb-2"><span>Total Bill:</span><span>₹{checkoutModal.total}</span></div>
                                            <div className="flex justify-between text-green-400 text-sm mb-2"><span>Advance Paid:</span><span>-₹{checkoutModal.advance}</span></div>
                                            <div className="flex justify-between text-yellow-500 font-bold text-lg border-t border-white/10 pt-2 mt-2">
                                                <span>Remaining Due:</span><span>₹{checkoutModal.total - checkoutModal.advance}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-4 mb-4">
                                            <button onClick={() => handleCheckoutComplete('Cash')} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Cash</button>
                                            <button onClick={() => handleCheckoutComplete('Online')} className="flex-1 bg-blue-500 hover:bg-blue-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95">Online</button>
                                        </div>
                                        <button onClick={() => setIsSplitMode(true)} className="w-full bg-purple-500 hover:bg-purple-400 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 mb-4">Split Payment</button>
                                        <button onClick={() => { setCheckoutModal({ open: false, bookingId: null, total: 0, advance: 0 }); setIsSplitMode(false); }} className="text-gray-400 hover:text-white text-sm font-bold w-full p-2">Cancel</button>
                                    </>
                                ) : (
                                    <>
                                        <h3 className="text-xl font-bold mb-2 text-white">Split Payment</h3>
                                        <div className="text-sm font-bold text-yellow-400 mb-6 bg-yellow-500/10 py-2 rounded-lg">Due: ₹{checkoutModal.total - checkoutModal.advance}</div>
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
                                                const c = Number(splitCash); const o = Number(splitOnline);
                                                if (c + o !== (checkoutModal.total - checkoutModal.advance)) return alert(`Amounts must equal ₹${checkoutModal.total - checkoutModal.advance}`);
                                                handleCheckoutComplete('Split', { cash: c, online: o });
                                            }} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-bold py-3 rounded-xl transition">Confirm</button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* --- TAB 1: LIVE BOOKINGS --- */}
                    {activeTab === 'live' && (
                        <div className="max-w-6xl mx-auto w-full space-y-6">
                            <div className="flex flex-col gap-3 mb-8 border-b border-white/10 pb-6">
                                <div className="flex justify-center gap-3">
                                    <button onClick={() => setBookingFilter('Upcoming')} className={`w-1/2 md:w-48 px-4 py-3 rounded-xl text-sm font-bold transition shadow-lg border ${bookingFilter === 'Upcoming' ? 'bg-yellow-500 text-black border-yellow-500 shadow-[0_0_15px_rgba(234,179,8,0.4)] transform scale-105' : 'bg-slate-800 text-gray-400 border-white/5 hover:bg-slate-700'}`}>
                                        📅 Upcoming ({'>'} 2 Hrs)
                                    </button>
                                    <button onClick={() => setBookingFilter('Completed')} className={`w-1/2 md:w-48 px-4 py-3 rounded-xl text-sm font-bold transition shadow-lg border ${bookingFilter === 'Completed' ? 'bg-green-500 text-black border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.4)] transform scale-105' : 'bg-slate-800 text-gray-400 border-white/5 hover:bg-slate-700'}`}>
                                        ✅ Completed
                                    </button>
                                </div>
                                <div className="flex justify-center">
                                    <button onClick={() => setBookingFilter('Live')} className={`w-full md:w-[396px] px-6 py-3 rounded-xl text-sm font-bold transition shadow-lg border flex items-center justify-center gap-2 ${bookingFilter === 'Live' ? 'bg-red-500 text-white border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.4)] transform scale-105' : 'bg-slate-800 text-gray-400 border-white/5 hover:bg-slate-700'}`}>
                                        <span className={`${bookingFilter === 'Live' ? 'animate-pulse' : ''}`}>🔴</span> Live Dashboard ({'<'} 2 Hrs)
                                    </button>
                                </div>
                            </div>

                            {bookingFilter === 'Live' && (
                                <div className="animate-fade-in">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {liveBookings.length === 0 ? <p className="text-gray-500 text-center col-span-full py-10">No rooms live right now.</p> : liveBookings.map(b => {
                                            const timer = getTimerData(b);
                                            return (
                                                <div key={b.id} className="bg-slate-800 p-5 rounded-xl border-l-4 border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)] relative">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full inline-block">{b.room_no || 'Room 1'}</span>
                                                        <span className="text-xs font-bold bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/50 animate-pulse">{timer.phase === 'countdown' ? 'Starts Soon' : 'Running'}</span>
                                                    </div>
                                                    <h3 className="font-bold text-lg mb-1 text-white">{b.customer_name}</h3>
                                                    <p className="text-sm text-gray-400 mb-4">📞 {b.phone} | 👥 {b.members} Members</p>
                                                    <div className="bg-black/40 p-4 rounded-lg text-center mb-4 border border-red-500/30">
                                                        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{timer.label}</p>
                                                        <p className={`text-3xl font-black font-mono tracking-widest ${timer.color} ${timer.pulse ? 'animate-pulse' : ''}`}>{timer.timeString}</p>
                                                        <p className="text-[10px] text-gray-500 mt-2">Slot: {b.slot_start} - {b.slot_end}</p>
                                                    </div>
                                                    <button onClick={() => setCheckoutModal({ open: true, bookingId: b.id, total: b.total_amount, advance: b.advance_paid })} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition shadow-lg">Checkout & Complete</button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {bookingFilter === 'Upcoming' && (
                                <div className="animate-fade-in">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {upcomingBookings.length === 0 ? <p className="text-gray-600 text-center col-span-full py-10">No distant upcoming bookings.</p> : upcomingBookings.map(b => (
                                            <div key={b.id} className="bg-slate-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-lg relative">
                                                <div className="mb-2"><span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full inline-block">{b.room_no || 'Room 1'}</span></div>
                                                <h3 className="font-bold text-lg mb-1 text-white">{b.customer_name}</h3>
                                                <p className="text-sm text-gray-400 mb-4">📞 {b.phone}</p>
                                                <div className="bg-black/30 p-3 rounded-lg text-sm border border-white/5">
                                                    <p><span className="text-gray-500">Date:</span> {b.booking_date}</p>
                                                    <p><span className="text-gray-500">Slot:</span> <span className="text-yellow-400 font-bold">{b.slot_start} - {b.slot_end}</span></p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {bookingFilter === 'Completed' && (
                                <div className="animate-fade-in">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                        {completedBookings.map(b => (
                                            <div key={b.id} className="bg-slate-800/50 p-5 rounded-xl border-l-4 border-green-500/50 relative shadow-lg">
                                                <div className="flex justify-between items-start mb-2">
                                                    <span className="bg-gray-700 text-white text-[10px] font-bold px-2 py-0.5 rounded-full inline-block">{b.room_no || 'Room 1'}</span>
                                                    <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-1 rounded inline-block">Completed</span>
                                                </div>
                                                <h3 className="font-bold text-lg mb-1 text-gray-300">{b.customer_name}</h3>
                                                <div className="bg-black/30 p-3 rounded-lg text-sm mt-4 border border-white/5">
                                                    <p><span className="text-gray-500">Date:</span> {b.booking_date}</p>
                                                    <p><span className="text-gray-500">Slot:</span> {b.slot_start} - {b.slot_end}</p>
                                                </div>
                                            </div>
                                        ))}
                                        {completedBookings.length === 0 && <p className="text-gray-500 col-span-full text-center py-10">No completed bookings found.</p>}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TAB 2: BOOKING SYSTEM WITH MULTI-STEP FLOW */}
                    {activeTab === 'book' && (
                        <div className="max-w-4xl mx-auto w-full">
                            <h2 className="text-2xl font-bold mb-6 text-yellow-500">Room Booking Flow</h2>
                            <div className="flex gap-2 mb-6">
                                <div className={`h-2 flex-1 rounded-full ${step >= 1 ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-slate-700'}`}></div>
                                <div className={`h-2 flex-1 rounded-full ${step >= 2 ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-slate-700'}`}></div>
                                <div className={`h-2 flex-1 rounded-full ${step >= 3 ? 'bg-yellow-500 shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-slate-700'}`}></div>
                            </div>
                            <div className="bg-slate-800 p-6 rounded-xl border border-yellow-500/20 shadow-lg">
                                {/* STEP 1 */}
                                {step === 1 && (
                                    <div className="space-y-6 animate-fade-in">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-white/10">
                                            <div>
                                                <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-1">Select Room</label>
                                                <select className="w-full bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 font-bold focus:border-yellow-500 outline-none" value={roomNo} onChange={e => setRoomNo(e.target.value)}>
                                                    <option value="Room 1" className="bg-slate-800 text-white">Room 1</option>
                                                    <option value="Room 2" className="bg-slate-800 text-white">Room 2</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-1">Select Date</label>
                                                <input type="date" min={getFormattedDateForInput()} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-yellow-500 outline-none" value={bookingDate} onChange={e=>setBookingDate(e.target.value)} required />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-1">Number of Members</label>
                                            <select className="w-full md:w-48 bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-yellow-500 outline-none" value={numMembers} onChange={handleNumMembersChange}>
                                                <option value={1}>1 Member</option>
                                                <option value={2}>2 Members</option>
                                                <option value={3}>3 Members</option>
                                            </select>
                                        </div>

                                        <div className="space-y-4 pt-4 border-t border-white/5">
                                            {membersData.map((member) => (
                                                <div key={member.id} className="bg-black/30 p-4 rounded-xl border border-white/5 relative">
                                                    {member.isSaved ? (
                                                        <div className="flex justify-between items-center">
                                                            <div>
                                                                <h4 className="font-bold text-lg text-white">#{member.id} {member.name}</h4>
                                                                <p className="text-xs text-green-400 font-bold">✓ Added Successfully</p>
                                                            </div>
                                                            <button onClick={() => editMember(member.id)} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm transition">Edit</button>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-4">
                                                            <h4 className="font-bold text-yellow-500 mb-2">Member {member.id} Details</h4>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                <input type="text" placeholder="Full Name" className="w-full bg-slate-800 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={member.name} onChange={e => updateMemberField(member.id, 'name', e.target.value)} />
                                                                <input type="text" placeholder="Phone Number" className="w-full bg-slate-800 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={member.phone} onChange={e => updateMemberField(member.id, 'phone', e.target.value)} />
                                                                <input type="number" placeholder="Age" className="w-full bg-slate-800 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={member.age} onChange={e => updateMemberField(member.id, 'age', e.target.value)} />
                                                                <select className="w-full bg-slate-800 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={member.gender} onChange={e => updateMemberField(member.id, 'gender', e.target.value)}>
                                                                    <option value="Male">Male</option>
                                                                    <option value="Female">Female</option>
                                                                    <option value="Other">Other</option>
                                                                </select>
                                                            </div>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                                                <div>
                                                                    <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">ID Document Front (JPG, PNG, PDF)</label>
                                                                    <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf" onChange={e => updateMemberField(member.id, 'aadhaarFront', e.target.files[0])} className="w-full text-xs text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-yellow-500/20 file:text-yellow-500 cursor-pointer" />
                                                                </div>
                                                                <div>
                                                                    <label className="text-[10px] text-gray-500 uppercase tracking-widest block mb-1">ID Document Back (JPG, PNG, PDF)</label>
                                                                    <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf" onChange={e => updateMemberField(member.id, 'aadhaarBack', e.target.files[0])} className="w-full text-xs text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-yellow-500/20 file:text-yellow-500 cursor-pointer" />
                                                                </div>
                                                            </div>
                                                            <button onClick={() => saveMember(member.id)} className="w-full bg-yellow-500/20 hover:bg-yellow-500 text-yellow-500 hover:text-black font-bold py-3 rounded-xl transition border border-yellow-500/50 mt-2">Save Member {member.id}</button>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                        <button onClick={() => setStep(2)} disabled={!membersData.every(m => m.isSaved)} className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-black py-4 rounded-xl shadow-lg transition text-lg mt-4 disabled:opacity-30 disabled:cursor-not-allowed">Next: Select Slot</button>
                                    </div>
                                )}

                                {/* STEP 2 */}
                                {step === 2 && (
                                    <div className="space-y-6 animate-fade-in">
                                        <div className="flex justify-between items-center bg-black/30 p-4 rounded-xl border border-white/5">
                                            <div><p className="text-xs text-gray-500 uppercase tracking-widest">Booking Date</p><p className="font-bold text-white text-lg">{bookingDate}</p></div>
                                            <div className="text-right"><p className="text-xs text-gray-500 uppercase tracking-widest">Room</p><p className="font-bold text-yellow-400 text-lg">{roomNo}</p></div>
                                        </div>
                                        <div>
                                            <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-3">Available 1-Hour Slots</label>
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-2">
                                                {getAvailableSlots().length === 0 ? <p className="text-red-400 text-sm col-span-full">No slots available for today.</p> : (
                                                    getAvailableSlots().map(slot => {
                                                        const isBooked = bookings.some(b => b.booking_date === bookingDate && b.slot_start === slot.startVal && b.room_no === roomNo && b.status !== 'Cancelled');
                                                        return (
                                                            <button key={slot.startVal} type="button" disabled={isBooked} onClick={() => setSelectedSlot(slot)} className={`p-3 rounded-lg text-sm font-bold border transition ${isBooked ? 'bg-red-500/10 border-red-500/30 text-red-500 opacity-50 cursor-not-allowed' : selectedSlot?.startVal === slot.startVal ? 'bg-yellow-500 border-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.4)] transform scale-105' : 'bg-black/30 border-white/10 text-gray-300 hover:border-yellow-500'}`}>
                                                                {slot.label}
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-3 mt-8">
                                            <button onClick={() => setStep(1)} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-xl transition">Back</button>
                                            <button onClick={() => setStep(3)} disabled={!selectedSlot} className="w-2/3 bg-yellow-500 hover:bg-yellow-400 text-black font-black py-4 rounded-xl shadow-lg transition text-lg disabled:opacity-30 disabled:cursor-not-allowed">Next: Payment</button>
                                        </div>
                                    </div>
                                )}

                                {/* STEP 3 */}
                                {step === 3 && (
                                    <div className="space-y-6 animate-fade-in text-center py-6">
                                        <div className="bg-black/30 p-6 rounded-xl border border-white/5 max-w-sm mx-auto">
                                            <p className="text-sm text-gray-400 uppercase font-bold tracking-widest mb-2">Total Amount</p>
                                            <h2 className="text-5xl font-black text-yellow-500 mb-6">₹{customAmount !== null ? customAmount : roomPrices[roomNo]}</h2>
                                            <button onClick={() => { const res = window.prompt(`Enter Custom Amount (Discounts/Overtime) ₹:`, roomPrices[roomNo]); if (res !== null && !isNaN(res)) setCustomAmount(Number(res)); }} className="text-xs text-yellow-400 underline hover:text-white transition">Apply Custom Amount / Discount</button>
                                        </div>
                                        <div className="flex gap-3 max-w-sm mx-auto pt-4">
                                            <button onClick={() => setStep(2)} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white font-bold py-4 rounded-xl transition">Back</button>
                                            <button onClick={handleConfirmBooking} className="flex-1 bg-green-500 hover:bg-green-400 text-black font-black py-4 rounded-xl shadow-[0_0_20px_rgba(34,197,94,0.4)] transition text-lg">Confirm</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* TAB 3: EXPENSES */}
                    {activeTab === 'expenses' && financials && (
                        <div className="max-w-6xl mx-auto w-full pb-10">
                            <h2 className="text-2xl font-bold mb-6 text-yellow-500">Room Expense & Income Management</h2>
                            <div className="mb-6 flex gap-4 items-center">
                                <label className="text-sm font-bold text-gray-400">Select Date:</label>
                                <input type="date" value={expenseDateFilter} onChange={(e) => setExpenseDateFilter(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg p-2 text-white focus:border-yellow-500 outline-none transition" />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-green-500">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Total Income</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Cash Income</span><span className="font-bold text-green-400">₹{financials.lifetimeCashIn}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Online Income</span><span className="font-bold text-green-400">₹{financials.lifetimeOnlineIn}</span></div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end"><span className="text-xs text-gray-500 uppercase font-bold">Total</span><span className="text-3xl font-black text-white leading-none">₹{financials.lifetimeCashIn + financials.lifetimeOnlineIn}</span></div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-red-500">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Total Outcome</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Cash Outcome</span><span className="font-bold text-red-400">₹{financials.lifetimeCashOut}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Online Outcome</span><span className="font-bold text-red-400">₹{financials.lifetimeOnlineOut}</span></div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end"><span className="text-xs text-gray-500 uppercase font-bold">Total</span><span className="text-3xl font-black text-white leading-none">₹{financials.lifetimeCashOut + financials.lifetimeOnlineOut}</span></div>
                                </div>
                                <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-t-4 border-t-yellow-500 relative overflow-hidden">
                                    <h3 className="text-sm font-bold text-yellow-500 uppercase tracking-widest mb-4">Remaining Balance</h3>
                                    <div className="space-y-3 mb-4">
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Remaining Cash</span><span className="font-bold text-yellow-300">₹{financials.lifetimeCashRem}</span></div>
                                        <div className="flex justify-between items-center"><span className="text-gray-300 text-sm">Remaining Online</span><span className="font-bold text-yellow-300">₹{financials.lifetimeOnlineRem}</span></div>
                                    </div>
                                    <div className="pt-4 border-t border-white/10 flex justify-between items-end"><span className="text-xs text-yellow-500/50 uppercase font-bold">Total Net</span><span className="text-3xl font-black text-yellow-500 leading-none">₹{financials.lifetimeTotalRem}</span></div>
                                </div>
                            </div>

                            <h3 className="text-xl font-bold mb-4">Daily Report ({financials.dateStr})</h3>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 shadow-lg w-full max-w-[100vw] overflow-x-auto mb-8">
                                <table className="w-full text-left text-sm text-gray-300 min-w-[900px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr><th className="p-4">Date</th><th className="p-4">Initial Amount</th><th className="p-4 text-green-400">Online Income</th><th className="p-4 text-green-400">Cash Income</th><th className="p-4 text-red-400">Online Outcome</th><th className="p-4 text-red-400">Cash Outcome</th><th className="p-4 text-yellow-500 font-bold text-right">Remaining Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b border-white/5 hover:bg-white/5">
                                            <td className="p-4 font-bold text-white">{financials.dateStr}</td>
                                            <td className="p-4 font-mono font-bold text-gray-400">₹{financials.initialAmount}</td>
                                            <td className="p-4 font-mono font-bold text-green-400">₹{financials.onlineIn}</td>
                                            <td className="p-4 font-mono font-bold text-green-400">₹{financials.cashIn}</td>
                                            <td className="p-4 font-mono font-bold text-red-400">₹{financials.onlineOut}</td>
                                            <td className="p-4 font-mono font-bold text-red-400">₹{financials.cashOut}</td>
                                            <td className="p-4 text-right font-mono font-black text-yellow-500 text-lg">₹{financials.totalRem}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg mb-8">
                                <h3 className="text-lg font-bold mb-4">Add New Room Expense</h3>
                                <form onSubmit={handleAddExpense} className="flex flex-col md:flex-row gap-4">
                                    <input type="text" placeholder="Description (e.g., Cleaning)" className="flex-1 bg-black/30 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={expenseForm.desc} onChange={e => setExpenseForm({...expenseForm, desc: e.target.value})} required />
                                    <input type="number" placeholder="Amount (₹)" className="w-full md:w-32 bg-black/30 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} required min="1" />
                                    <select value={expenseForm.mode} onChange={e => setExpenseForm({...expenseForm, mode: e.target.value})} className="w-full md:w-32 bg-black/30 border border-white/10 rounded-lg p-3 text-white outline-none focus:border-yellow-500">
                                        <option value="Cash">Cash</option>
                                        <option value="Online">Online</option>
                                    </select>
                                    <button type="submit" className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-6 py-3 rounded-lg transition whitespace-nowrap">Add Expense</button>
                                </form>
                            </div>

                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-xl font-bold">Expense Ledger ({financials.dateStr})</h3>
                                <button onClick={() => exportCSV(financials.dayExpenses, `Expenses_${financials.dateStr}.csv`)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                            </div>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full overflow-x-auto shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400 min-w-[600px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr><th className="p-4">Time</th><th className="p-4">Description</th><th className="p-4">Mode</th><th className="p-4 text-right">Amount</th></tr>
                                    </thead>
                                    <tbody>
                                        {financials.dayExpenses.map(exp => (
                                            <tr key={exp.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-4">{exp.time}</td>
                                                <td className="p-4 text-white">{exp.description}</td>
                                                <td className="p-4"><span className="bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded text-xs font-bold">{exp.mode}</span></td>
                                                <td className="p-4 text-red-400 font-bold text-right font-mono">-₹{exp.amount}</td>
                                            </tr>
                                        ))}
                                        {financials.dayExpenses.length === 0 && <tr><td colSpan="4" className="text-center py-8 text-gray-500">No room expenses recorded.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 4: ANALYTICS */}
                    {activeTab === 'analytics' && (
                        <div className="max-w-6xl mx-auto w-full pb-10">
                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                <h2 className="text-2xl font-bold text-yellow-500">Room Sales Analytics</h2>
                                <button onClick={() => exportCSV(currentTxns, `Room_Analytics_${analyticsFilter}.csv`)} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-bold shadow-lg transition whitespace-nowrap">⬇ Export CSV</button>
                            </div>
                            <div className="flex gap-2 mb-6 overflow-x-auto pb-2 scrollbar-hide items-center w-full max-w-[100vw]">
                                {['Today', 'Weekly', 'Monthly', 'Yearly', 'All', 'Custom'].map(filter => (
                                    <button key={filter} onClick={() => setAnalyticsFilter(filter)} className={`px-6 py-2 rounded-lg text-sm font-bold transition ${analyticsFilter === filter ? 'bg-yellow-500 text-black shadow-lg shadow-yellow-500/20' : 'bg-slate-800 text-gray-400 hover:bg-slate-700 hover:text-white border border-white/10'}`}>
                                        {filter}
                                    </button>
                                ))}
                                {analyticsFilter === 'Custom' && <input type="date" value={analyticsCustomDate} onChange={(e) => setAnalyticsCustomDate(e.target.value)} className="bg-slate-800 border border-white/10 rounded-lg p-2 text-sm text-white focus:border-yellow-500 outline-none transition ml-2" />}
                            </div>

                            {(() => {
                                let totalRev = 0; let totalC = 0; let totalO = 0;
                                let r1Rev = 0; let r2Rev = 0;
                                filteredTxns.forEach(b => {
                                    const t = Number(b.total_amount);
                                    totalRev += t;
                                    if (b.room_no === 'Room 1') r1Rev += t; else r2Rev += t;
                                    const pm = String(b.payment_method || 'Cash').toLowerCase();
                                    if (pm === 'split') { totalC += Number(b.split_cash||0); totalO += Number(b.split_online||0); }
                                    else if (pm.includes('online')) { totalO += t; }
                                    else { totalC += t; }
                                });
                                return (
                                    <>
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-yellow-500"><p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Total Revenue ({analyticsFilter})</p><p className="text-3xl font-black text-white mt-1">₹{totalRev}</p></div>
                                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-green-500"><p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Cash Received</p><p className="text-3xl font-black text-green-400 mt-1">₹{totalC}</p></div>
                                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-blue-500"><p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Online Received</p><p className="text-3xl font-black text-blue-400 mt-1">₹{totalO}</p></div>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                            <div onClick={() => setSelectedRevenueCategory('Room 1')} className="bg-slate-800 p-5 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-purple-500 cursor-pointer hover:-translate-y-1 transition hover:border-purple-500/50"><p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Room 1 Revenue</p><p className="text-2xl font-black text-purple-400 mt-1">₹{r1Rev}</p></div>
                                            <div onClick={() => setSelectedRevenueCategory('Room 2')} className="bg-slate-800 p-5 rounded-xl border border-white/10 shadow-lg border-l-4 border-l-pink-500 cursor-pointer hover:-translate-y-1 transition hover:border-pink-500/50"><p className="text-gray-400 text-xs font-bold uppercase tracking-wider">Room 2 Revenue</p><p className="text-2xl font-black text-pink-400 mt-1">₹{r2Rev}</p></div>
                                        </div>
                                    </>
                                );
                            })()}

                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 h-[400px] w-full shadow-lg mb-6">
                                {getAnalyticsData().length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={getAnalyticsData()}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#444" vertical={false} />
                                            <XAxis dataKey="name" stroke="#888" tickLine={false} axisLine={false} />
                                            <YAxis stroke="#888" tickLine={false} axisLine={false} tickFormatter={(value) => `₹${value}`} />
                                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }} itemStyle={{ color: '#eab308', fontWeight: 'bold' }} cursor={{fill: '#334155'}} />
                                            <Bar dataKey="sales" fill="#eab308" radius={[4, 4, 0, 0]} maxBarSize={60} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 font-bold space-y-3"><p>No sales data found for {analyticsFilter.toLowerCase()}.</p></div>
                                )}
                            </div>

                            <h3 className="text-xl font-bold mb-4">Booking Ledger ({analyticsFilter})</h3>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full max-w-[100vw] overflow-x-auto shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400 min-w-[800px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr><th className="p-4">Booking ID</th><th className="p-4">Date & Room</th><th className="p-4">Customer</th><th className="p-4">Amount</th><th className="p-4">Payment Method</th></tr>
                                    </thead>
                                    <tbody>
                                        {currentTxns.map(b => ( 
                                            <tr key={b.id} className="border-b border-white/5 hover:bg-white/5 transition">
                                                <td className="p-4 font-mono text-white">#{b.id}</td>
                                                <td className="p-4">{b.booking_date} <span className="text-yellow-500 block text-xs font-bold mt-1">{b.room_no}</span></td>
                                                <td className="p-4">{b.customer_name}</td>
                                                <td className="p-4 font-bold text-green-400">₹{b.total_amount}</td>
                                                <td className="p-4">
                                                    {b.payment_method === 'Split' ? (
                                                        <div className="flex flex-col items-start">
                                                            <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs font-bold mb-1">Split</span>
                                                            <span className="text-[10px] text-gray-500">C: ₹{b.split_cash} | O: ₹{b.split_online}</span>
                                                        </div>
                                                    ) : (
                                                        <span className={`px-2 py-1 rounded text-xs font-bold ${b.payment_method === 'Online' ? 'bg-blue-500/20 text-blue-400' : 'bg-green-500/20 text-green-400'}`}>{b.payment_method || 'Cash'}</span>
                                                    )}
                                                </td>
                                            </tr> 
                                        ))}
                                        {currentTxns.length === 0 && <tr><td colSpan="5" className="text-center py-8 text-gray-500">No transactions found.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* REVENUE CATEGORY MODAL */}
                    {selectedRevenueCategory && (
                        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
                            <div className="bg-slate-800 p-6 rounded-2xl w-full max-w-3xl border border-white/10 shadow-2xl relative max-h-[85vh] flex flex-col">
                                <button onClick={() => setSelectedRevenueCategory(null)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 font-bold text-2xl transition z-50">✕</button>
                                <div className="flex justify-between items-start mb-6 pr-8">
                                    <div><h3 className="text-xl font-bold mb-1 text-white">{selectedRevenueCategory} Details</h3><p className="text-xs text-gray-400">Specific revenue for {analyticsFilter}.</p></div>
                                </div>
                                <div className="overflow-y-auto flex-1 bg-black/20 rounded-xl border border-white/5">
                                    <table className="w-full text-left text-sm text-gray-400">
                                        <thead className="bg-black/40 text-xs uppercase sticky top-0">
                                            <tr><th className="p-4">Booking ID</th><th className="p-4">Date</th><th className="p-4">Customer</th><th className="p-4 text-right">Amount</th></tr>
                                        </thead>
                                        <tbody>
                                            {filteredTxns.filter(b => b.room_no === selectedRevenueCategory).map((row, idx) => (
                                                <tr key={idx} className="border-b border-white/5 hover:bg-white/5">
                                                    <td className="p-4 font-mono text-white">#{row.id}</td>
                                                    <td className="p-4 whitespace-nowrap">{row.booking_date}</td>
                                                    <td className="p-4">{row.customer_name}</td>
                                                    <td className="p-4 text-right font-bold text-yellow-500">₹{row.total_amount}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* TAB 5: ROOM REGISTRY */}
                    {activeTab === 'users' && (
                        <div className="max-w-7xl mx-auto w-full pb-10">
                            <h2 className="text-2xl font-bold mb-6 text-yellow-500">Booking Registry & Guest History</h2>
                            <div className="bg-slate-800 rounded-xl overflow-hidden border border-white/10 w-full overflow-x-auto shadow-lg">
                                <table className="w-full text-left text-sm text-gray-400 min-w-[1000px]">
                                    <thead className="bg-black/30 text-white uppercase text-xs">
                                        <tr><th className="p-4">Sr No</th><th className="p-4">Room & Primary Guest</th><th className="p-4">Finance</th><th className="p-4">Booked Slot</th><th className="p-4">Members & Documents</th><th className="p-4">Contact</th></tr>
                                    </thead>
                                    <tbody>
                                        {bookings.map((b, index) => (
                                            <tr key={b.id} className="border-b border-white/5 hover:bg-white/5">
                                                <td className="p-4 font-bold text-white">{index + 1}</td>
                                                <td className="p-4">
                                                    <span className="bg-yellow-500/20 text-yellow-400 text-[10px] font-bold px-2 py-0.5 rounded block w-fit mb-1">{b.room_no || 'Room 1'}</span>
                                                    <span className="font-bold text-white capitalize">{b.customer_name}</span>
                                                    <span className="text-xs text-gray-500 block">Members: {b.members || 1}</span>
                                                </td>
                                                <td className="p-4">
                                                    <div className="text-white font-mono text-xs">Total: ₹{b.total_amount || 0}</div>
                                                    <div className="text-green-400 font-mono text-xs">Adv: ₹{b.advance_paid || 0}</div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="bg-black/30 px-3 py-1.5 rounded inline-block border border-white/5">
                                                        <span className="text-white block font-bold">{b.booking_date}</span>
                                                        <span className="text-yellow-400 text-xs font-mono">{b.slot_start} - {b.slot_end}</span>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="space-y-2">
                                                        {(b.members_data || []).map((m, mIdx) => (
                                                            <div key={mIdx} className="text-xs bg-black/40 p-2 rounded border border-white/5">
                                                                <span className="font-bold text-white">{m.name} ({m.gender}, {m.age}y)</span>
                                                                <div className="flex gap-2 mt-1">
                                                                    {m.aadhaar_front && (<button onClick={() => { const w = window.open(""); w.document.write(`<iframe src="${m.aadhaar_front}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`); }} className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded hover:bg-yellow-500 hover:text-black transition">Front</button>)}
                                                                    {m.aadhaar_back && (<button onClick={() => { const w = window.open(""); w.document.write(`<iframe src="${m.aadhaar_back}" frameborder="0" style="border:0; top:0px; left:0px; bottom:0px; right:0px; width:100%; height:100%;" allowfullscreen></iframe>`); }} className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded hover:bg-yellow-500 hover:text-black transition">Back</button>)}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="font-mono text-white font-bold">{b.phone}</div>
                                                    {b.email && <div className="text-xs text-gray-400">{b.email}</div>}
                                                </td>
                                            </tr>
                                        ))}
                                        {bookings.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-gray-500">No room registry history found.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 6: SETTINGS */}
                    {activeTab === 'settings' && (
                        <div className="max-w-4xl mx-auto w-full pb-10">
                            <h2 className="text-2xl font-bold mb-6 text-yellow-500">Room Settings</h2>
                            <div className="bg-slate-800 p-6 rounded-xl border border-white/10 shadow-lg">
                                <h3 className="text-lg font-bold mb-4">Pricing Configuration (Per 1-Hour Slot)</h3>
                                <p className="text-sm text-gray-400 mb-6">Set the default base price for each room. This price will automatically be applied when a room is selected during the booking process.</p>
                                <form onSubmit={handleSaveSettings} className="space-y-4">
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="flex-1">
                                            <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-1">Room 1 Base Price (₹)</label>
                                            <input type="number" min="0" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-yellow-500 outline-none" value={roomPrices['Room 1'] || ''} onChange={e => setRoomPrices({...roomPrices, 'Room 1': Number(e.target.value)})} required />
                                        </div>
                                        <div className="flex-1">
                                            <label className="text-xs text-gray-400 uppercase font-bold tracking-wider block mb-1">Room 2 Base Price (₹)</label>
                                            <input type="number" min="0" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white focus:border-yellow-500 outline-none" value={roomPrices['Room 2'] || ''} onChange={e => setRoomPrices({...roomPrices, 'Room 2': Number(e.target.value)})} required />
                                        </div>
                                    </div>
                                    <button type="submit" className="w-full md:w-auto bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-8 py-3 rounded-lg transition shadow-lg mt-4">Save Prices</button>
                                </form>
                            </div>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}

function SidebarBtn({ icon, label, active, onClick }) { 
    return (
        <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${active ? 'bg-yellow-500 text-black font-bold shadow-lg shadow-yellow-500/20' : 'text-gray-400 hover:bg-white/5 hover:text-white'}`}>
            <span className="text-lg">{icon}</span>
            <span className="flex-1 text-left text-sm">{label}</span>
        </button>
    ); 
}