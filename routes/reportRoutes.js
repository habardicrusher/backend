const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getDayData } = require('../models/orderModel');

module.exports = function(app) {
    app.get('/api/reports', requireAuth, requireAdmin, async (req, res) => {
        const { startDate, endDate } = req.query;
        const start = new Date(startDate);
        const end = new Date(endDate);
        let allDistributions = [], dailyData = {}, driverStats = {}, factoryStats = {}, materialStats = {};
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayData = await getDayData(dateStr);
            if (dayData.distribution?.length) {
                dailyData[dateStr] = dayData.distribution.length;
                dayData.distribution.forEach(dist => {
                    dist.date = dateStr;
                    allDistributions.push(dist);
                    const key = dist.truck.number;
                    if (!driverStats[key]) driverStats[key] = { number: key, driver: dist.truck.driver, total: 0 };
                    driverStats[key].total++;
                    if (!factoryStats[dist.factory]) factoryStats[dist.factory] = { name: dist.factory, total: 0 };
                    factoryStats[dist.factory].total++;
                    if (!materialStats[dist.material]) materialStats[dist.material] = { name: dist.material, total: 0 };
                    materialStats[dist.material].total++;
                });
            }
        }
        res.json({ allDistributions, dailyData, driverStats, factoryStats, materialStats, startDate, endDate });
    });
};
