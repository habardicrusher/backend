// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.viewTrucks) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    initDate();
    
    try {
        await loadSettings();
        await loadDayDataAndRender();
        await loadRestrictions();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

// ==================== تحميل البيانات ====================
async function loadDayDataAndRender() {
    await loadDayData();
    renderTrucksGrid();
}

// ==================== عرض السيارات ====================
function renderTrucksGrid() {
    const searchEl = document.getElementById('truckSearch');
    const search = searchEl ? searchEl.value.toLowerCase() : '';
    
    // حساب السيارات المعينة
    const assigned = {};
    distribution.forEach(d => {
        if (!assigned[d.truck.number]) assigned[d.truck.number] = [];
        assigned[d.truck.number].push(d.road);
    });
    
    // فلترة السيارات
    const filtered = trucks.filter(t => 
        t.number.toLowerCase().includes(search) || 
        t.driver.toLowerCase().includes(search)
    );
    
    const container = document.getElementById('trucksGrid');
    if (!container) return;
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #a8b2d1; padding: 30px;">لا توجد نتائج</p>';
        updateStats(assigned);
        return;
    }
    
    container.innerHTML = filtered.map(t => {
        const roads = assigned[t.number] || [];
        const hasRestrictions = getDriverRestrictions(t.number).length > 0;
        
        let cls = 'available';
        let txt = '🟢 متاح';
        
        if (roads.includes(1) && roads.includes(2)) {
            cls = 'assigned-road2';
            txt = '🔴🔵 رود 1+2';
        } else if (roads.includes(2)) {
            cls = 'assigned-road2';
            txt = '🔴 رود 2';
        } else if (roads.includes(1)) {
            cls = 'assigned-road1';
            txt = '🔵 رود 1';
        }
        
        if (hasRestrictions) cls += ' restricted';
        
        return `
            <div class="truck-card ${cls}">
                <div class="truck-number">${t.number}</div>
                <div class="truck-driver">${t.driver}</div>
                <div style="margin-top: 8px; font-size: 0.8em;">${txt}</div>
                ${roads.length > 0 ? `<div style="font-size: 0.75em; color: #a8b2d1;">${roads.length} رحلة</div>` : ''}
                ${hasRestrictions ? '<div class="restriction-badge" style="margin-top: 5px;">⛔ قيود</div>' : ''}
            </div>
        `;
    }).join('');
    
    updateStats(assigned);
}

function updateStats(assigned) {
    const usedTrucks = new Set(Object.keys(assigned));
    const road1 = distribution.filter(d => d.road === 1).length;
    const road2 = distribution.filter(d => d.road === 2).length;
    
    document.getElementById('totalTrucksCount').textContent = trucks.length;
    document.getElementById('availableTrucks').textContent = trucks.length - usedTrucks.size;
    document.getElementById('road1Trucks').textContent = road1;
    document.getElementById('road2Trucks').textContent = road2;
}

function filterTrucks() {
    renderTrucksGrid();
}