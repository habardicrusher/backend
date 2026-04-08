// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.manageUsers) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    
    try {
        await loadUsers();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
});

// ==================== تحميل المستخدمين ====================
async function loadUsers() {
    try {
        const users = await apiCall('/users');
        renderUsersList(users);
    } catch (error) {
        console.error('Error loading users:', error);
    }
}

function renderUsersList(users) {
    const container = document.getElementById('usersList');
    if (!container) return;
    
    if (!users || users.length === 0) {
        container.innerHTML = '<p style="color: #a8b2d1; text-align: center;">لا يوجد مستخدمين</p>';
        return;
    }
    
    container.innerHTML = users.map(u => `
        <div class="list-item">
            <div>
                <strong style="color: #667eea;">👤 ${u.username}</strong>
                <span class="chip ${u.role === 'admin' ? 'admin' : ''}">
                    ${u.role === 'admin' ? '👑 مدير' : '👤 مستخدم'}
                </span>
                <div style="font-size: 0.8em; color: #a8b2d1; margin-top: 5px;">
                    تاريخ الإنشاء: ${new Date(u.createdAt).toLocaleDateString('ar-SA')}
                </div>
            </div>
            <div style="display: flex; gap: 5px;">
                <button class="btn btn-sm btn-warning" onclick="openEditUserModal(${u.id})">✏️</button>
                ${u.username !== 'Admin' ? 
                    `<button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');
}

// ==================== إدارة المستخدمين ====================
function openAddUserModal() {
    document.getElementById('userModalTitle').textContent = '➕ إضافة مستخدم جديد';
    document.getElementById('userEditId').value = '';
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newUserRole').value = 'user';
    
    renderPermissionsCheckboxes({});
    openModal('userModal');
}

async function openEditUserModal(id) {
    try {
        const users = await apiCall('/users');
        const user = users.find(u => u.id === id);
        if (!user) return;
        
        document.getElementById('userModalTitle').textContent = '✏️ تعديل المستخدم';
        document.getElementById('userEditId').value = id;
        document.getElementById('newUsername').value = user.username;
        document.getElementById('newPassword').value = '';
        document.getElementById('newUserRole').value = user.role;
        
        renderPermissionsCheckboxes(user.permissions || {});
        openModal('userModal');
    } catch (error) {
        showToast('خطأ في تحميل بيانات المستخدم', 'error');
    }
}

function renderPermissionsCheckboxes(currentPerms) {
    const container = document.getElementById('permissionsCheckboxes');
    if (!container) return;
    
    container.innerHTML = Object.entries(allPermissions).map(([key, label]) => `
        <label class="permission-item">
            <input type="checkbox" id="perm_${key}" ${currentPerms[key] ? 'checked' : ''}>
            <span>${label}</span>
        </label>
    `).join('');
}

async function saveUser() {
    const id = document.getElementById('userEditId').value;
    const username = document.getElementById('newUsername').value.trim();
    const password = document.getElementById('newPassword').value;
    const role = document.getElementById('newUserRole').value;
    
    if (!username) {
        showToast('أدخل اسم المستخدم', 'error');
        return;
    }
    
    if (!id && !password) {
        showToast('أدخل كلمة المرور', 'error');
        return;
    }
    
    // جمع الصلاحيات
    const permissions = {};
    Object.keys(allPermissions).forEach(key => {
        const checkbox = document.getElementById(`perm_${key}`);
        permissions[key] = checkbox ? checkbox.checked : false;
    });
    
    // المدير يحصل على كل الصلاحيات
    if (role === 'admin') {
        Object.keys(allPermissions).forEach(key => permissions[key] = true);
    }
    
    try {
        const url = id ? `/users/${id}` : '/users';
        const method = id ? 'PUT' : 'POST';
        const body = { username, role, permissions };
        if (password) body.password = password;
        
        await apiCall(url, method, body);
        closeModal('userModal');
        await loadUsers();
        showToast('✅ تم الحفظ', 'success');
    } catch (error) {
        showToast(error.message || 'خطأ في الحفظ', 'error');
    }
}

async function deleteUser(id) {
    if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
    
    try {
        await apiCall(`/users/${id}`, 'DELETE');
        await loadUsers();
        showToast('تم الحذف', 'info');
    } catch (error) {
        showToast(error.message || 'خطأ في الحذف', 'error');
    }
}