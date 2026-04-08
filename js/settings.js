// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.viewSettings) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    
    try {
        await loadSettings();
        await loadRestrictions();
        renderAllLists();
        updateButtonsVisibility();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

function updateButtonsVisibility() {
    if (!currentUser.permissions.manageTrucks) {
        const btn = document.getElementById('btnAddTruck');
        if (btn) btn.style.display = 'none';
    }
    if (!currentUser.permissions.manageSettings) {
        const btnMaterial = document.getElementById('btnAddMaterial');
        const btnFactory = document.getElementById('btnAddFactory');
        if (btnMaterial) btnMaterial.style.display = 'none';
        if (btnFactory) btnFactory.style.display = 'none';
    }
}

// ==================== عرض القوائم ====================
function renderAllLists() {
    renderTrucksList();
    renderMaterialsList();
    renderFactoriesList();
}

function renderTrucksList() {
    const searchEl = document.getElementById('truckSearchSettings');
    const search = searchEl ? searchEl.value.toLowerCase() : '';
    
    const filtered = trucks.filter(t => 
        t.number.toLowerCase().includes(search) || 
        t.driver.toLowerCase().includes(search)
    );
    
    document.getElementById('trucksCount').textContent = trucks.length;
    const container = document.getElementById('trucksList');
    if (!container) return;
    
    if (filtered.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1; text-align: center;">لا توجد نتائج</p>';
        return;
    }
    
    container.innerHTML = filtered.map(t => {
        const idx = trucks.indexOf(t);
        const truckRestrictions = getDriverRestrictions(t.number);
        
        return `
            <div class="list-item">
                <div>
                    <strong style="color: #667eea;">🚛 ${t.number}</strong> - 👤 ${t.driver}
                    ${truckRestrictions.length > 0 ? 
                        `<span class="restriction-badge">⛔ ${truckRestrictions.length} قيود</span>` : ''}
                </div>
                <div style="display: flex; gap: 5px;">
                    ${currentUser.permissions.manageTrucks ? `
                        <button class="btn btn-sm btn-warning" onclick="openEditTruckModal(${idx})">✏️</button>
                        <button class="btn btn-sm btn-danger" onclick="deleteTruck(${idx})">🗑️</button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function renderMaterialsList() {
    document.getElementById('materialsCount').textContent = materials.length;
    const container = document.getElementById('materialsList');
    if (!container) return;
    
    if (materials.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1;">لا توجد أنواع</p>';
        return;
    }
    
    container.innerHTML = materials.map(m => `
        <div class="list-item">
            <span class="chip">📦 ${m}</span>
            ${currentUser.permissions.manageSettings ? 
                `<button class="btn btn-sm btn-danger" onclick="deleteMaterial('${m}')">🗑️</button>` : ''}
        </div>
    `).join('');
}

function renderFactoriesList() {
    document.getElementById('factoriesCount').textContent = factories.length;
    const container = document.getElementById('factoriesList');
    if (!container) return;
    
    if (factories.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1;">لا توجد مصانع</p>';
        return;
    }
    
    container.innerHTML = factories.map(f => `
        <div class="list-item">
            <span class="chip">🏭 ${f}</span>
            ${currentUser.permissions.manageSettings ? 
                `<button class="btn btn-sm btn-danger" onclick="deleteFactory('${f}')">🗑️</button>` : ''}
        </div>
    `).join('');
}

// ==================== السيارات ====================
function openAddTruckModal() {
    if (!requirePermission('manageTrucks')) return;
    
    document.getElementById('truckModalTitle').textContent = '➕ إضافة سيارة';
    document.getElementById('truckEditIndex').value = '';
    document.getElementById('truckNumber').value = '';
    document.getElementById('truckDriver').value = '';
    openModal('truckModal');
}

function openEditTruckModal(idx) {
    if (!requirePermission('manageTrucks')) return;
    
    document.getElementById('truckModalTitle').textContent = '✏️ تعديل السيارة';
    document.getElementById('truckEditIndex').value = idx;
    document.getElementById('truckNumber').value = trucks[idx].number;
    document.getElementById('truckDriver').value = trucks[idx].driver;
    openModal('truckModal');
}

async function saveTruck() {
    const number = document.getElementById('truckNumber').value.trim();
    const driver = document.getElementById('truckDriver').value.trim();
    const editIdx = document.getElementById('truckEditIndex').value;
    
    if (!number || !driver) {
        showToast('املأ جميع الحقول', 'error');
        return;
    }
    
    if (trucks.some((t, i) => t.number === number && i != editIdx)) {
        showToast('رقم السيارة موجود مسبقاً', 'error');
        return;
    }
    
    if (editIdx !== '') {
        trucks[parseInt(editIdx)] = { number, driver };
    } else {
        trucks.push({ number, driver });
    }
    
    if (await saveSettings()) {
        renderTrucksList();
        closeModal('truckModal');
        showToast('✅ تم الحفظ', 'success');
    }
}

async function deleteTruck(idx) {
    if (!requirePermission('manageTrucks')) return;
    if (!confirm(`حذف السيارة ${trucks[idx].number}؟`)) return;
    
    trucks.splice(idx, 1);
    
    if (await saveSettings()) {
        renderTrucksList();
        showToast('تم الحذف', 'info');
    }
}

// ==================== أنواع البحص ====================
function openAddMaterialModal() {
    if (!requirePermission('manageSettings')) return;
    
    document.getElementById('materialName').value = '';
    openModal('materialModal');
}

async function saveMaterial() {
    const name = document.getElementById('materialName').value.trim();
    
    if (!name) {
        showToast('أدخل اسم النوع', 'error');
        return;
    }
    
    if (materials.includes(name)) {
        showToast('النوع موجود مسبقاً', 'error');
        return;
    }
    
    materials.push(name);
    
    if (await saveSettings()) {
        renderMaterialsList();
        closeModal('materialModal');
        showToast('✅ تم الإضافة', 'success');
    }
}

async function deleteMaterial(m) {
    if (!requirePermission('manageSettings')) return;
    if (!confirm(`حذف نوع "${m}"؟`)) return;
    
    materials = materials.filter(x => x !== m);
    
    if (await saveSettings()) {
        renderMaterialsList();
        showToast('تم الحذف', 'info');
    }
}

// ==================== المصانع ====================
function openAddFactoryModal() {
    if (!requirePermission('manageSettings')) return;
    
    document.getElementById('factoryName').value = '';
    openModal('factoryModal');
}

async function saveFactory() {
    const name = document.getElementById('factoryName').value.trim();
    
    if (!name) {
        showToast('أدخل اسم المصنع', 'error');
        return;
    }
    
    if (factories.includes(name)) {
        showToast('المصنع موجود مسبقاً', 'error');
        return;
    }
    
    factories.push(name);
    
    if (await saveSettings()) {
        renderFactoriesList();
        closeModal('factoryModal');
        showToast('✅ تم الإضافة', 'success');
    }
}

async function deleteFactory(f) {
    if (!requirePermission('manageSettings')) return;
    if (!confirm(`حذف مصنع "${f}"؟`)) return;
    
    factories = factories.filter(x => x !== f);
    
    if (await saveSettings()) {
        renderFactoriesList();
        showToast('تم الحذف', 'info');
    }
}