export const getFormattedDate = (dateObj = new Date()) => {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${d}/${m}/${y}`;
};

export const getFormattedTime = (dateObj = new Date()) => {
    return dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

export const getFormattedDateForInput = (dateObj = new Date()) => {
    const d = String(dateObj.getDate()).padStart(2, '0');
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const y = dateObj.getFullYear();
    return `${y}-${m}-${d}`;
};

export const normalizeDateStr = (dStr) => {
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

export const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
});

export const exportCSV = (data, filename) => {
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