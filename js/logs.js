// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (currentUser.role !== 'admin') {
        showToast('هذه الصفحة للمدير فقط', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    
    try {
        await loadLogs();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

// ==================== تحميل السجلات ====================
async function loadLogs() {
    try {
        const logs = await apiCall('/logs');
        renderLogs(logs);
    } catch (error) {
        console.error('Error loading logs:', error);
    }
}

function renderLogs(logs) {
    const container = document.getElementById('logsList');
    if (!container) return;
    
    if (!logs || logs.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1; text-align: center; padding: 30px;">لا توجد سجلات</p>';
        return;
    }
    
    container.innerHTML = logs.map(log => `
        <div class="log-item">
            <div>
                <span class="log-user">👤 ${log.user}</span>
                <span style="margin: 0 10px; color: #a8b2d1;">|</span>
                <span class="log-action">${log.action}</span>
                ${log.details ? `<span style="color: #a8b2d1;"> - ${log.details}</span>` : ''}
            </div>
            <span class="log-time">${new Date(log.timestamp).toLocaleString('ar-SA')}</span>
        </div>
    `).join('');
}