// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.viewBackup) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    initDate();
    updateButtonsVisibility();
    
    try {
        await loadSettings();
        await loadDayData();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
    }
    
    showLoading(false);
});

function updateButtonsVisibility() {
    if (!currentUser.permissions.manageBackup) {
        const importSection = document.getElementById('importSection');
        const excelSection = document.getElementById('excelSection');
        const dangerZone = document.getElementById('dangerZone');
        
        if (importSection) importSection.style.display = 'none';
        if (excelSection) excelSection.style.display = 'none';
        if (dangerZone) dangerZone.style.display = 'none';
    }
}

// ==================== تصدير البيانات ====================
async function exportDataToFile() {
    showLoading(true);
    
    try {
        const response = await fetch('/api/backup', { credentials: 'include' });
        if (!response.ok) throw new Error('فشل في جلب البيانات');
        
        const data = await response.json();
        
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `نسخة_احتياطية_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showLoading(false);
        showToast('✅ تم حفظ النسخة الاحتياطية', 'success');
    } catch (error) {
        showLoading(false);
        showToast('❌ خطأ: ' + error.message, 'error');
    }
}

// ==================== استيراد البيانات ====================
async function importDataFromFile(event) {
    if (!requirePermission('manageBackup')) return;
    
    const file = event.target.files[0];
    if (!file) return;
    
    showLoading(true);
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = JSON.parse(e.target.result);
            
            const response = await fetch('/api/restore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (response.ok && result.success) {
                await loadSettings();
                await loadDayData();
                showToast('✅ ' + (result.message || 'تم الاستعادة بنجاح'), 'success');
            } else {
                throw new Error(result.error || 'فشل الاستعادة');
            }
        } catch (error) {
            showToast('❌ خطأ: ' + error.message, 'error');
        }
        showLoading(false);
    };
    
    reader.readAsText(file, 'UTF-8');
    event.target.value = '';
}

// ==================== استيراد Excel ====================
async function importFromExcel(event) {
    if (!requirePermission('manageBackup')) return;
    
    const file = event.target.files[0];
    if (!file) return;
    
    showLoading(true);
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            
            let count = 0;
            for (let i = 1; i < json.length; i++) {
                const row = json[i];
                if (row[0] && row[1] && row[2]) {
                    const factory = row[0].toString().trim();
                    const material = row[1].toString().trim();
                    const quantity = parseInt(row[2]) || 1;
                    
                    if (factories.includes(factory) && materials.includes(material)) {
                        for (let j = 0; j < quantity; j++) {
                            orders.push({
                                id: Date.now().toString() + '_' + count + '_' + j,
                                factory,
                                material,
                                timestamp: new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
                                createdBy: currentUser.username
                            });
                            count++;
                        }
                    }
                }
            }
            
            if (count > 0) {
                await saveData();
                showToast(`✅ تم استيراد ${count} طلب`, 'success');
            } else {
                showToast('لا توجد بيانات صالحة للاستيراد', 'error');
            }
        } catch (error) {
            showToast('❌ خطأ في قراءة الملف', 'error');
        }
        
        showLoading(false);
        event.target.value = '';
    };
    
    reader.readAsArrayBuffer(file);
}

function downloadExcelTemplate() {
    const template = [
        ['المصنع', 'نوع البحص', 'العدد'],
        ['SCCCL', '3/4', 5],
        ['YAMAMA', '1/2', 3]
    ];
    
    const ws = XLSX.utils.aoa_to_sheet(template);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قالب');
    XLSX.writeFile(wb, 'قالب_الطلبات.xlsx');
    showToast('✅ تم تحميل القالب', 'success');
}

// ==================== مسح البيانات ====================
async function clearDayOrders() {
    if (!requirePermission('manageBackup')) return;
    if (!confirm('⚠️ هل أنت متأكد من مسح جميع طلبات اليوم؟')) return;
    
    orders = [];
    distribution = [];
    
    if (await saveData()) {
        showToast('تم مسح طلبات اليوم', 'info');
    }
}

async function clearAllData() {
    if (currentUser.role !== 'admin') {
        showToast('هذا الإجراء متاح للمدير فقط', 'error');
        return;
    }
    
    if (!confirm('⚠️⚠️ هل أنت متأكد من مسح جميع البيانات نهائياً؟')) return;
    if (!confirm('هذا الإجراء لا يمكن التراجع عنه! هل أنت متأكد تماماً؟')) return;
    
    try {
        await apiCall('/clear-all', 'DELETE');
        showToast('تم مسح جميع البيانات', 'info');
        setTimeout(() => location.reload(), 2000);
    } catch (error) {
        showToast('خطأ في مسح البيانات', 'error');
    }
}