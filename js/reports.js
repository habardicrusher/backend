// ==================== متغيرات الرسوم البيانية ====================
let driversChart = null;
let factoriesChart = null;
let materialsChart = null;
let dailyChart = null;

// ==================== تهيئة الصفحة ====================
document.addEventListener('DOMContentLoaded', async function() {
    showLoading(true);
    
    if (!await checkSession()) {
        showLoading(false);
        return;
    }
    
    if (!currentUser.permissions.viewReports) {
        showToast('ليس لديك صلاحية للوصول لهذه الصفحة', 'error');
        setTimeout(() => window.location.href = '/orders.html', 2000);
        return;
    }
    
    updateUserInfo();
    buildNavigation();
    initReportDates();
    updateButtonsVisibility();
    
    try {
        await generateReports();
        showToast(`مرحباً ${currentUser.username}!`, 'success');
    } catch (error) {
        console.error('Init error:', error);
    }
    
    showLoading(false);
});

function updateButtonsVisibility() {
    if (!currentUser.permissions.exportReports) {
        const exportButtons = document.getElementById('exportButtons');
        if (exportButtons) exportButtons.style.display = 'none';
    }
}

// ==================== إدارة التواريخ ====================
function initReportDates() {
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    document.getElementById('reportStartDate').value = firstDay.toISOString().split('T')[0];
    document.getElementById('reportEndDate').value = today.toISOString().split('T')[0];
}

function updateReportDates() {
    const period = document.getElementById('reportPeriod').value;
    const today = new Date();
    let start;
    
    switch (period) {
        case 'day':
            start = today;
            break;
        case 'week':
            start = new Date(today);
            start.setDate(today.getDate() - 6);
            break;
        case 'month':
            start = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'custom':
            return;
    }
    
    document.getElementById('reportStartDate').value = start.toISOString().split('T')[0];
    document.getElementById('reportEndDate').value = today.toISOString().split('T')[0];
}

// ==================== توليد التقارير ====================
async function generateReports() {
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    
    if (!startDate || !endDate) {
        showToast('اختر الفترة', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const data = await getReportData(startDate, endDate);
        
        renderReportSummary(data.allDistributions, data.driverStats);
        renderDriversChart(data.driverStats);
        renderFactoriesChart(data.factoryStats);
        renderMaterialsChart(data.materialStats);
        renderDailyChart(data.dailyData);
        renderDriversRankTable(data.driverStats, data.allDistributions.length);
        
        showToast('✅ تم تحديث التقرير', 'success');
    } catch (error) {
        showToast('خطأ في تحميل البيانات', 'error');
    }
    
    showLoading(false);
}

// ==================== عرض الملخص ====================
function renderReportSummary(distributions, driverStats) {
    const totalTrips = distributions.length;
    const totalDrivers = Object.keys(driverStats).length;
    const avgTrips = totalDrivers > 0 ? (totalTrips / totalDrivers).toFixed(1) : 0;
    const maxTrips = Math.max(0, ...Object.values(driverStats).map(d => d.total));
    
    const container = document.getElementById('reportSummary');
    if (container) {
        container.innerHTML = `
            <div class="summary-card">
                <div class="value">${totalTrips}</div>
                <div class="label">إجمالي الرحلات</div>
            </div>
            <div class="summary-card">
                <div class="value">${totalDrivers}</div>
                <div class="label">عدد السائقين</div>
            </div>
            <div class="summary-card">
                <div class="value">${avgTrips}</div>
                <div class="label">متوسط الرحلات/سائق</div>
            </div>
            <div class="summary-card">
                <div class="value">${maxTrips}</div>
                <div class="label">أعلى رحلات</div>
            </div>
        `;
    }
}

// ==================== الرسوم البيانية ====================
function renderDriversChart(stats) {
    const canvas = document.getElementById('driversChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (driversChart) driversChart.destroy();
    
    const sorted = Object.values(stats).sort((a, b) => b.total - a.total).slice(0, 15);
    
    driversChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(d => d.number),
            datasets: [
                {
                    label: 'رود 1',
                    data: sorted.map(d => d.road1),
                    backgroundColor: 'rgba(102,126,234,0.8)',
                    borderRadius: 5
                },
                {
                    label: 'رود 2',
                    data: sorted.map(d => d.road2),
                    backgroundColor: 'rgba(245,87,108,0.8)',
                    borderRadius: 5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#fff' } } },
            scales: {
                x: { stacked: true, ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { stacked: true, ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' } }
            }
        }
    });
}

function renderFactoriesChart(stats) {
    const canvas = document.getElementById('factoriesChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (factoriesChart) factoriesChart.destroy();
    
    const sorted = Object.entries(stats).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
    
    factoriesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(([name]) => name.substring(0, 20)),
            datasets: [{
                label: 'عدد الطلبات',
                data: sorted.map(([, s]) => s.total),
                backgroundColor: 'rgba(56,239,125,0.8)',
                borderRadius: 5
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' } }
            }
        }
    });
}

function renderMaterialsChart(stats) {
    const canvas = document.getElementById('materialsChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (materialsChart) materialsChart.destroy();
    
    const colors = [
        'rgba(102,126,234,0.8)',
        'rgba(245,87,108,0.8)',
        'rgba(56,239,125,0.8)',
        'rgba(79,172,254,0.8)',
        'rgba(240,147,251,0.8)'
    ];
    
    const keys = Object.keys(stats);
    
    materialsChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: keys.map(m => 'بحص ' + m),
            datasets: [{
                data: Object.values(stats).map(s => s.total),
                backgroundColor: colors.slice(0, keys.length),
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#fff', padding: 20 }
                }
            }
        }
    });
}

function renderDailyChart(data) {
    const canvas = document.getElementById('dailyChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (dailyChart) dailyChart.destroy();
    
    const dates = Object.keys(data).sort();
    
    dailyChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates.map(d => {
                const dt = new Date(d);
                return `${dt.getDate()}/${dt.getMonth() + 1}`;
            }),
            datasets: [{
                label: 'عدد الرحلات',
                data: dates.map(d => data[d]),
                borderColor: 'rgba(102,126,234,1)',
                backgroundColor: 'rgba(102,126,234,0.2)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { labels: { color: '#fff' } } },
            scales: {
                x: { ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' } },
                y: { ticks: { color: '#a8b2d1' }, grid: { color: 'rgba(255,255,255,0.1)' }, beginAtZero: true }
            }
        }
    });
}

// ==================== جدول الترتيب ====================
function renderDriversRankTable(stats, total) {
    const container = document.getElementById('driversRankBody');
    if (!container) return;
    
    const sorted = Object.values(stats).sort((a, b) => b.total - a.total);
    
    container.innerHTML = sorted.map((d, i) => {
        const percent = total > 0 ? ((d.total / total) * 100).toFixed(1) : 0;
        let rankClass = '';
        if (i === 0) rankClass = 'rank-1';
        else if (i === 1) rankClass = 'rank-2';
        else if (i === 2) rankClass = 'rank-3';
        
        return `
            <tr>
                <td><span class="driver-rank ${rankClass}">${i + 1}</span></td>
                <td><strong>${d.number}</strong></td>
                <td>${d.driver}</td>
                <td><strong>${d.total}</strong></td>
                <td>${d.road1}</td>
                <td>${d.road2}</td>
                <td>
                    <div class="progress-bar">
                        <div class="progress-bar-fill" style="width: ${percent}%"></div>
                    </div>
                    <small>${percent}%</small>
                </td>
            </tr>
        `;
    }).join('');
}

// ==================== التصدير ====================
async function exportReportToExcel() {
    if (!requirePermission('exportReports')) return;
    
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    
    try {
        const data = await getReportData(startDate, endDate);
        if (data.allDistributions.length === 0) {
            showToast('لا توجد بيانات', 'error');
            return;
        }
        
        const wb = XLSX.utils.book_new();
        
        // شيت السائقين
        const drArr = [['#', 'رقم السيارة', 'السائق', 'إجمالي', 'رود 1', 'رود 2']];
        Object.values(data.driverStats).sort((a, b) => b.total - a.total).forEach((d, i) => {
            drArr.push([i + 1, d.number, d.driver, d.total, d.road1, d.road2]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(drArr), 'السائقين');
        
        // شيت المصانع
        const fArr = [['المصنع', 'عدد الطلبات']];
        Object.entries(data.factoryStats).forEach(([name, stats]) => {
            fArr.push([name, stats.total]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(fArr), 'المصانع');
        
        // شيت المواد
        const mArr = [['نوع البحص', 'عدد الطلبات']];
        Object.entries(data.materialStats).forEach(([name, stats]) => {
            mArr.push(['بحص ' + name, stats.total]);
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mArr), 'أنواع البحص');
        
        XLSX.writeFile(wb, `تقرير_${startDate}_${endDate}.xlsx`);
        showToast('✅ تم التصدير', 'success');
    } catch (error) {
        showToast('خطأ في التصدير', 'error');
    }
}

async function exportReportToExcelWithCharts() {
    if (!requirePermission('exportReports')) return;
    
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    
    if (!startDate || !endDate) {
        showToast('اختر الفترة أولاً', 'error');
        return;
    }
    
    showLoading(true);
    
    try {
        const data = await getReportData(startDate, endDate);
        if (data.allDistributions.length === 0) {
            showLoading(false);
            showToast('لا توجد بيانات', 'error');
            return;
        }

        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'نظام إدارة طلبات البحص';
        workbook.created = new Date();

        // الستايلات
        const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
        const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
        const titleFont = { bold: true, color: { argb: 'FF1F4E79' }, size: 16 };
        const centerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true };
        const thinBorder = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };

        const totalTrips = data.allDistributions.length;
        const sortedDrivers = Object.values(data.driverStats).sort((a, b) => b.total - a.total);

        // === شيت الملخص ===
        const ws1 = workbook.addWorksheet('ملخص التقرير', { views: [{ rightToLeft: true }] });
        ws1.columns = [{ width: 35 }, { width: 25 }];
        
        ws1.mergeCells('A1:B1');
        ws1.getCell('A1').value = '📊 التقرير الشامل لطلبات البحص';
        ws1.getCell('A1').font = { ...titleFont, size: 20 };
        ws1.getCell('A1').alignment = centerAlign;
        ws1.getRow(1).height = 45;

        ws1.mergeCells('A2:B2');
        ws1.getCell('A2').value = `الفترة: من ${startDate} إلى ${endDate}`;
        ws1.getCell('A2').alignment = centerAlign;

        const summaryData = [
            ['إجمالي الرحلات', totalTrips],
            ['عدد السائقين', Object.keys(data.driverStats).length],
            ['عدد المصانع', Object.keys(data.factoryStats).length],
            ['أنواع البحص', Object.keys(data.materialStats).length]
        ];
        
        summaryData.forEach((item, idx) => {
            const row = ws1.getRow(4 + idx);
            row.values = item;
            row.height = 25;
            row.eachCell(cell => {
                cell.border = thinBorder;
                cell.alignment = centerAlign;
            });
        });

        // === شيت السائقين ===
        const ws2 = workbook.addWorksheet('تقرير السائقين', { views: [{ rightToLeft: true }] });
        ws2.columns = [{ width: 8 }, { width: 14 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 12 }];
        
        const driverHeaders = ['#', 'رقم السيارة', 'السائق', 'إجمالي', 'رود 1', 'رود 2'];
        const headerRow2 = ws2.getRow(1);
        headerRow2.values = driverHeaders;
        headerRow2.height = 30;
        headerRow2.eachCell(cell => {
            cell.font = headerFont;
            cell.fill = headerFill;
            cell.alignment = centerAlign;
            cell.border = thinBorder;
        });

        sortedDrivers.forEach((d, i) => {
            const row = ws2.getRow(2 + i);
            row.values = [i + 1, d.number, d.driver, d.total, d.road1, d.road2];
            row.height = 22;
            row.eachCell(cell => {
                cell.alignment = centerAlign;
                cell.border = thinBorder;
            });
        });

        // === شيت المصانع ===
        const ws3 = workbook.addWorksheet('المصانع', { views: [{ rightToLeft: true }] });
        ws3.columns = [{ width: 30 }, { width: 15 }];
        
        const factoryHeaders = ['المصنع', 'عدد الطلبات'];
        const headerRow3 = ws3.getRow(1);
        headerRow3.values = factoryHeaders;
        headerRow3.height = 30;
        headerRow3.eachCell(cell => {
            cell.font = headerFont;
            cell.fill = headerFill;
            cell.alignment = centerAlign;
            cell.border = thinBorder;
        });

        const sortedFactories = Object.entries(data.factoryStats).sort((a, b) => b[1].total - a[1].total);
        sortedFactories.forEach(([name, stats], i) => {
            const row = ws3.getRow(2 + i);
            row.values = [name, stats.total];
            row.height = 22;
            row.eachCell(cell => {
                cell.alignment = centerAlign;
                cell.border = thinBorder;
            });
        });

        // تصدير الملف
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        saveAs(blob, `تقرير_شامل_${startDate}_إلى_${endDate}.xlsx`);
        
        showLoading(false);
        showToast('✅ تم تصدير التقرير بنجاح!', 'success');
    } catch (error) {
        showLoading(false);
        console.error('خطأ:', error);
        showToast('❌ خطأ في التصدير', 'error');
    }
}