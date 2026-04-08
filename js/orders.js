// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    initDate();
    
    try {
        await loadSettings();
        await loadDayDataAndRender();
        await loadRestrictions();
        
        updateSelectOptions();
        renderQuickAddButtons();
        updateButtonsVisibility();
        
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

// ==================== تحديث القوائم ====================
function updateSelectOptions() {
    populateSelect('factorySelect', factories);
    populateSelect('editOrderFactory', factories);
    populateMaterialSelect('materialType', materials);
    populateMaterialSelect('editOrderMaterial', materials);
}

function renderQuickAddButtons() {
    const container = document.getElementById('quickAddButtons');
    if (!container) return;
    
    container.innerHTML = materials.map(m => 
        [1, 5, 10].map(c => 
            `<button class="quick-btn" onclick="quickAdd('${m}', ${c})">${m} × ${c}</button>`
        ).join('')
    ).join('');
}

function updateButtonsVisibility() {
    const btnAddOrder = document.getElementById('btnAddOrder');
    const quickAddSection = document.getElementById('quickAddSection');
    
    if (!currentUser.permissions.addOrders) {
        if (btnAddOrder) btnAddOrder.style.display = 'none';
        if (quickAddSection) quickAddSection.style.display = 'none';
    }
}

// ==================== تحميل البيانات ====================
async function loadDayDataAndRender() {
    await loadDayData();
    renderTodayOrders();
}

// ==================== الطلبات ====================
async function addOrder() {
    if (!requirePermission('addOrders')) return;
    
    const factory = document.getElementById('factorySelect').value;
    const material = document.getElementById('materialType').value;
    const count = parseInt(document.getElementById('orderCount').value);
    
    if (!factory || !material || !count) {
        showToast('يرجى ملء جميع الحقول', 'error');
        return;
    }
    
    showLoading(true);
    
    for (let i = 0; i < count; i++) {
        orders.push({
            id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
            factory,
            material,
            timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
            createdBy: currentUser.username
        });
    }
    
    const success = await saveData();
    showLoading(false);
    
    if (success) {
        renderTodayOrders();
        document.getElementById('orderCount').value = '1';
        showToast(`✅ تم إضافة ${count} طلب`, 'success');
    }
}

async function quickAdd(material, count) {
    if (!requirePermission('addOrders')) return;
    
    const factory = document.getElementById('factorySelect').value;
    if (!factory) {
        showToast('اختر المصنع أولاً', 'error');
        return;
    }
    
    showLoading(true);
    
    for (let i = 0; i < count; i++) {
        orders.push({
            id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 9),
            factory,
            material,
            timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
            createdBy: currentUser.username
        });
    }
    
    const success = await saveData();
    showLoading(false);
    
    if (success) {
        renderTodayOrders();
        showToast(`✅ تم إضافة ${count} طلب ${material}`, 'success');
    }
}

async function deleteOrder(id) {
    if (!requirePermission('deleteOrders')) return;
    if (!confirm('حذف هذا الطلب؟')) return;
    
    orders = orders.filter(o => o.id !== id);
    
    if (await saveData()) {
        renderTodayOrders();
        showToast('تم الحذف', 'info');
    }
}

function openEditOrderModal(id) {
    if (!requirePermission('editOrders')) return;
    
    const order = orders.find(o => o.id === id);
    if (!order) return;
    
    document.getElementById('editOrderId').value = id;
    document.getElementById('editOrderFactory').value = order.factory;
    document.getElementById('editOrderMaterial').value = order.material;
    openModal('editOrderModal');
}

async function saveOrderEdit() {
    const id = document.getElementById('editOrderId').value;
    const idx = orders.findIndex(o => o.id === id);
    
    if (idx !== -1) {
        orders[idx].factory = document.getElementById('editOrderFactory').value;
        orders[idx].material = document.getElementById('editOrderMaterial').value;
        orders[idx].editedBy = currentUser.username;
        orders[idx].editedAt = new Date().toISOString();
        
        if (await saveData()) {
            renderTodayOrders();
            closeModal('editOrderModal');
            showToast('✅ تم التعديل', 'success');
        }
    }
}

// ==================== عرض الطلبات ====================
function renderTodayOrders() {
    const countEl = document.getElementById('ordersCount');
    const container = document.getElementById('todayOrders');
    
    if (countEl) countEl.textContent = orders.length;
    if (!container) return;
    
    if (orders.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1; text-align: center; padding: 30px;">لا توجد طلبات</p>';
        return;
    }
    
    container.innerHTML = orders.map((o, i) => `
        <div class="order-item">
            <div class="order-info">
                <span><strong>#${i + 1}</strong></span>
                <span>🏭 ${o.factory}</span>
                <span>📦 ${o.material}</span>
                <span>🕐 ${o.timestamp}</span>
                <span style="color: #a8b2d1; font-size: 0.8em;">👤 ${o.createdBy || '-'}</span>
            </div>
            <div class="order-actions">
                ${currentUser.permissions.editOrders ? 
                    `<button class="btn btn-sm btn-warning" onclick="openEditOrderModal('${o.id}')">✏️</button>` : ''}
                ${currentUser.permissions.deleteOrders ? 
                    `<button class="btn btn-sm btn-danger" onclick="deleteOrder('${o.id}')">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

// ==================== التصدير ====================
function exportToExcel() {
    if (orders.length === 0) {
        showToast('لا توجد طلبات', 'error');
        return;
    }
    
    const data = orders.map((o, i) => ({
        '#': i + 1,
        'المصنع': o.factory,
        'نوع البحص': o.material,
        'الوقت': o.timestamp,
        'بواسطة': o.createdBy || '-'
    }));
    
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الطلبات');
    XLSX.writeFile(wb, `طلبات_${currentDate}.xlsx`);
    showToast('✅ تم التصدير', 'success');
}