// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.manageRestrictions) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    
    try {
        await loadSettings();
        await loadRestrictions();
        renderRestrictionsList();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

// ==================== عرض القيود ====================
function renderRestrictionsList() {
    const container = document.getElementById('restrictionsList');
    if (!container) return;
    
    if (restrictions.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1; text-align: center; padding: 30px;">لا توجد قيود مسجلة</p>';
        return;
    }
    
    container.innerHTML = restrictions.map(r => `
        <div class="list-item" style="border-right: 4px solid ${r.active ? '#eb3349' : '#a8b2d1'};">
            <div style="flex: 1;">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <strong style="color: #667eea;">🚛 ${r.truckNumber}</strong>
                    <span>👤 ${r.driverName}</span>
                    <span class="chip ${r.active ? 'restricted' : ''}">
                        ${r.active ? '⛔ نشط' : '✅ معطل'}
                    </span>
                </div>
                <div style="margin-top: 8px;">
                    <span style="color: #f5576c;">المصانع الممنوعة: ${r.restrictedFactories.join('، ')}</span>
                </div>
                ${r.reason ? `<div style="color: #a8b2d1; font-size: 0.85em; margin-top: 5px;">📝 ${r.reason}</div>` : ''}
                <div style="color: #a8b2d1; font-size: 0.8em; margin-top: 5px;">
                    أُنشئ بواسطة: ${r.createdBy} - ${new Date(r.createdAt).toLocaleDateString('ar-SA')}
                </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <label style="display: flex; align-items: center; gap: 5px; cursor: pointer;">
                    <input type="checkbox" ${r.active ? 'checked' : ''} onchange="toggleRestriction(${r.id}, this.checked)">
                    فعّال
                </label>
                <button class="btn btn-sm btn-danger" onclick="deleteRestriction(${r.id})">🗑️</button>
            </div>
        </div>
    `).join('');
}

// ==================== إدارة القيود ====================
function openAddRestrictionModal() {
    document.getElementById('restrictionModalTitle').textContent = '⛔ إضافة قيد جديد';
    document.getElementById('restrictionEditId').value = '';
    document.getElementById('restrictionDriver').value = '';
    document.getElementById('restrictionReason').value = '';
    
    // ملء قائمة السيارات
    const select = document.getElementById('restrictionTruck');
    select.innerHTML = '<option value="">-- اختر السيارة --</option>' +
        trucks.map(t => `<option value="${t.number}" data-driver="${t.driver}">${t.number} - ${t.driver}</option>`).join('');
    
    // ملء المصانع
    const container = document.getElementById('factoriesCheckboxes');
    container.innerHTML = factories.map(f => `
        <label style="display: flex; align-items: center; gap: 8px; padding: 8px; cursor: pointer; background: rgba(255,255,255,0.03); border-radius: 5px; margin-bottom: 5px;">
            <input type="checkbox" value="${f}">
            <span>${f}</span>
        </label>
    `).join('');
    
    openModal('restrictionModal');
}

function updateRestrictionDriver() {
    const select = document.getElementById('restrictionTruck');
    const option = select.options[select.selectedIndex];
    document.getElementById('restrictionDriver').value = option?.dataset?.driver || '';
}

async function saveRestriction() {
    const truckNumber = document.getElementById('restrictionTruck').value;
    const driverName = document.getElementById('restrictionDriver').value;
    const reason = document.getElementById('restrictionReason').value.trim();
    
    const restrictedFactories = [];
    document.querySelectorAll('#factoriesCheckboxes input:checked').forEach(cb => {
        restrictedFactories.push(cb.value);
    });
    
    if (!truckNumber) {
        showToast('اختر السيارة', 'error');
        return;
    }
    
    if (restrictedFactories.length === 0) {
        showToast('اختر مصنع واحد على الأقل', 'error');
        return;
    }
    
    try {
        await apiCall('/restrictions', 'POST', {
            truckNumber,
            driverName,
            restrictedFactories,
            reason,
            active: true
        });
        
        closeModal('restrictionModal');
        await loadRestrictions();
        renderRestrictionsList();
        showToast('✅ تم إضافة القيد', 'success');
    } catch (error) {
        showToast(error.message || 'خطأ في الحفظ', 'error');
    }
}

async function toggleRestriction(id, active) {
    try {
        await apiCall(`/restrictions/${id}`, 'PUT', { active });
        await loadRestrictions();
        renderRestrictionsList();
    } catch (error) {
        console.error('Error:', error);
    }
}

async function deleteRestriction(id) {
    if (!confirm('هل أنت متأكد من حذف هذا القيد؟')) return;
    
    try {
        await apiCall(`/restrictions/${id}`, 'DELETE');
        await loadRestrictions();
        renderRestrictionsList();
        showToast('تم الحذف', 'info');
    } catch (error) {
        showToast('خطأ في الحذف', 'error');
    }
}