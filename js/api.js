// ==================== وظائف API ====================
const API_BASE = 'https://requests-backend.onrender.com/api';
async function apiCall(endpoint, method = 'GET', data = null) {
    try {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
        };
        
        if (data && (method === 'POST' || method === 'PUT')) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(`${API_BASE}${endpoint}`, options);
        
        if (response.status === 401) {
            window.location.href = 'login.html';
            return null;
        }
        
        const result = await response.json();
        
        if (!response.ok) {
            throw new Error(result.error || 'خطأ في السيرفر');
        }
        
        return result;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ==================== تحميل الإعدادات ====================
async function loadSettings() {
    try {
        const data = await apiCall('/settings');
        if (data) {
            factories = data.factories || [];
            materials = data.materials || [];
            trucks = data.trucks || [];
        }
        return data;
    } catch (error) {
        console.error('Error loading settings:', error);
        return null;
    }
}

async function saveSettings() {
    try {
        await apiCall('/settings', 'PUT', { factories, materials, trucks });
        return true;
    } catch (error) {
        showToast('خطأ في حفظ الإعدادات', 'error');
        return false;
    }
}

// ==================== تحميل بيانات اليوم ====================
async function loadDayData() {
    const dateInput = document.getElementById('orderDate');
    if (dateInput) {
        currentDate = dateInput.value;
    }
    
    if (!currentDate) {
        currentDate = new Date().toISOString().split('T')[0];
    }
    
    try {
        const data = await apiCall(`/day/${currentDate}`);
        if (data) {
            orders = data.orders || [];
            distribution = data.distribution || [];
        }
        return data;
    } catch (error) {
        orders = [];
        distribution = [];
        return null;
    }
}

async function saveData() {
    try {
        await apiCall(`/day/${currentDate}`, 'PUT', { orders, distribution });
        return true;
    } catch (error) {
        showToast('خطأ في حفظ البيانات', 'error');
        return false;
    }
}

// ==================== القيود ====================
async function loadRestrictions() {
    try {
        const data = await apiCall('/restrictions');
        restrictions = data || [];
        return restrictions;
    } catch (error) {
        restrictions = [];
        return [];
    }
}

// ==================== التقارير ====================
async function getReportData(startDate, endDate) {
    try {
        return await apiCall(`/reports?startDate=${startDate}&endDate=${endDate}`);
    } catch (error) {
        return {
            allDistributions: [],
            dailyData: {},
            driverStats: {},
            factoryStats: {},
            materialStats: {},
            startDate,
            endDate
        };
    }
}
