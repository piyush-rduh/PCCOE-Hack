export function buildAlerts({ farm, water, risks = [], irrigation, activeCrops = [], sensorDevices = [] }) {
  const alerts = [];
  if (water.decisionStatus === 'deficit') {
    alerts.push({
      farmId: farm.id,
      severity: 'warning',
      category: 'water',
      title: 'Water budget deficit',
      message: `Calculated planning-period deficit: ${Math.abs(water.balanceLitres).toLocaleString('en-IN')} litres.`
    });
  }
  risks.filter((risk) => risk.level === 'potential_concern').forEach((risk) => alerts.push({
    farmId: farm.id,
    severity: 'warning',
    category: risk.type,
    title: risk.type === 'drought' ? 'Potential water shortage' : 'Waterlogging review needed',
    message: risk.reasons[0] || 'Review the supplied observations before acting.'
  }));
  if (irrigation.missingInputs?.includes('Fresh soil-moisture reading')) {
    alerts.push({
      farmId: farm.id,
      severity: 'info',
      category: 'irrigation',
      title: 'Fresh moisture reading needed',
      message: 'A missing or stale moisture reading is not treated as zero.'
    });
  }
  sensorDevices.filter((device) => device.lastReadingAt
    && Date.now() - new Date(device.lastReadingAt).getTime() > 60 * 60 * 1000)
    .forEach((device) => alerts.push({
      farmId: farm.id,
      severity: 'warning',
      category: 'sensor',
      title: `${device.name} may be offline`,
      message: 'Last reading is stale; no fake reading is substituted.'
    }));
  activeCrops.filter((crop) => crop.growthStage === 'Flowering').forEach((crop) => alerts.push({
    farmId: farm.id,
    severity: 'info',
    category: 'crop',
    title: `${crop.crop} is in a water-sensitive stage`,
    message: 'Check measured moisture and rainfall before deciding on irrigation.'
  }));
  return alerts;
}
