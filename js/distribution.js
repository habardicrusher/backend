// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    // التحقق من الصلاحية
    if (!currentUser.permissions.viewDistribution) {
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
        updateButtonsVisibility();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

function updateButtonsVisibility() {
    if (!currentUser.permissions.manageDistribution) {
        const btnDistribute = document.getElementById('btnDistribute');
        const btnResetDist = document.getElementById('btnResetDist');
        if (btnDistribute) btnDistribute.style.display = 'none';
        if (btnResetDist) btnResetDist.style.display = 'none';
    }
}

// ==================== تحميل البيانات ====================
async function loadDayDataAndRender() {
    await loadDayData();
    renderDistributionTable();
    updateStats();
}

function updateStats() {
    document.getElementById('totalOrders').textContent = orders.length;
    document.getElementById('distributedCount').textContent = distribution.length;
    document.getElementById('road1Count').textContent = distribution.filter(d => d.road === 1).length;
    document.getElementById('road2Count').textContent = distribution.filter(d => d.road === 2).length;
}

// ==================== التوزيع ====================
async function autoDistribute() {
    if (!requirePermission('manageDistribution')) return;
    
    if (orders.length === 0) {
        showToast('لا توجد طلبات للتوزيع', 'error');
        return;
    }
    
    if (trucks.length === 0) {
        showToast('لا توجد سيارات متاحة', 'error');
        return;
    }
    
    showLoading(true);
    
    distribution = [];
    let truckIdx = 0;
    let road = 1;
    let warnings = [];
    
    orders.forEach((order, idx) => {
        if (truckIdx >= trucks.length) {
            truckIdx = 0;
            road = 2;
        }
        
        const truck = trucks[truckIdx];
        const restricted = isRestricted(truck.number, order.factory);
        
        if (restricted) {
            warnings.push(`⚠️ السيارة ${truck.number} (${truck.driver}) ممنوعة من ${order.factory}`);
        }
        
        distribution.push({
            orderId: order.id,
            orderIndex: idx + 1,
            truck: truck,
            factory: order.factory,
            material: order.material,
            road,
            restricted,
            distributedBy: currentUser.username,
            distributedAt: new Date().toISOString()
        });
        
        truckIdx++;
    });
    
    const success = await saveData();
    showLoading(false);
    
    if (success) {
        renderDistributionTable();
        updateStats();
        
        if (warnings.length > 0) {
            showToast(`تم التوزيع مع ${warnings.length} تحذير!`, 'warning');
            console.warn('تحذيرات التوزيع:', warnings);
        } else {
            showToast('✅ تم التوزيع بنجاح', 'success');
        }
    }
}

async function resetDistribution() {
    if (!requirePermission('manageDistribution')) return;
    if (!confirm('هل أنت متأكد من إعادة تعيين التوزيع؟')) return;
    
    showLoading(true);
    distribution = [];
    const success = await saveData();
    showLoading(false);
    
    if (success) {
        renderDistributionTable();
        updateStats();
        showToast('تم إعادة التعيين', 'info');
    }
}

// ==================== عرض الجدول ====================
function renderDistributionTable() {
    const container = document.getElementById('distributionTable');
    if (!container) return;
    
    if (distribution.length === 0) {
        container.innerHTML = '<tr><td colspan="7" style="padding: 30px; color: #a8b2d1;">لا يوجد توزيع - اضغط على "توزيع تلقائي"</td></tr>';
        return;
    }
    
    container.innerHTML = distribution.map((d, i) => `
        <tr style="${d.restricted ? 'background: rgba(235, 51, 73, 0.1);' : ''}">
            <td>${i + 1}</td>
            <td><strong>${d.truck.number}</strong></td>
            <td>${d.truck.driver}</td>
            <td>${d.factory}</td>
            <td>بحص ${d.material}</td>
            <td><span class="road-badge road-${d.road}">رود ${d.road}</span></td>
            <td>${d.restricted ? '<span class="restriction-badge">⚠️ قيد!</span>' : '✅'}</td>
        </tr>
    `).join('');
}