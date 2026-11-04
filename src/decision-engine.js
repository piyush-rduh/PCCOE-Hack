const CROPS = {
  Soybean: { type: 'legume', season: 'Kharif', variety: 'JS-335', waterMm: 450, baseYield: 10, cost: 22000, price: 4600 },
  Cotton: { type: 'fibre', season: 'Kharif', variety: 'Bt hybrid', waterMm: 700, baseYield: 8, cost: 42000, price: 6800 },
  Wheat: { type: 'cereal', season: 'Rabi', variety: 'HD-2189', waterMm: 450, baseYield: 18, cost: 24000, price: 2300 },
  'Green gram': { type: 'legume', season: 'Summer', variety: 'Pusa Vishal', waterMm: 300, baseYield: 4, cost: 12000, price: 7500 },
  Chickpea: { type: 'legume', season: 'Rabi', variety: 'Digvijay', waterMm: 300, baseYield: 7, cost: 15000, price: 5400 }
};

const num = (value) => Number(value) || 0;
const sum = (values) => values.reduce((total, value) => total + num(value), 0);
const currentSeason = () => { const month = new Date().getMonth(); return month >= 5 && month <= 9 ? 'Kharif' : month >= 10 || month <= 1 ? 'Rabi' : 'Summer'; };
const latestBy = (items, field, value) => items.filter((item) => item.parameter === value).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
const source = (value, fallback = 'DECISION_ENGINE') => value || fallback;

export function landPower({ farm, seasons = [], soilTests = [], zones = [], activities = [] }) {
  let score = 60;
  const strengths = [];
  const limitations = [];
  const missing = [];
  const value = (parameter) => latestBy(soilTests, 'parameter', parameter)?.value;
  const ph = value('pH');
  const ec = value('EC');
  const oc = value('Organic carbon');
  if (ph == null) missing.push('Soil pH'); else if (ph >= 6 && ph <= 7.8) { score += 6; strengths.push(`pH ${ph} is within the prototype workable range`); } else { score -= 7; limitations.push(`pH ${ph} is outside the prototype workable range`); }
  if (ec == null) missing.push('Electrical conductivity'); else if (ec > 4) { score -= 10; limitations.push(`EC ${ec} dS/m suggests salinity attention`); } else strengths.push(`EC ${ec} dS/m shows no prototype salinity flag`);
  if (oc == null) missing.push('Organic carbon'); else if (oc >= 0.75) { score += 8; strengths.push(`Organic carbon ${oc}% is a strength`); } else if (oc < 0.5) { score -= 8; limitations.push(`Organic carbon ${oc}% is low for this prototype indicator`); }
  ['N', 'P', 'K'].forEach((parameter) => { if (value(parameter) == null) missing.push(parameter === 'N' ? 'Nitrogen' : parameter === 'P' ? 'Phosphorus' : 'Potassium'); });
  const sortedSeasons = [...seasons].sort((a, b) => a.year - b.year || String(a.id).localeCompare(String(b.id)));
  const last = sortedSeasons.at(-1);
  const prior = sortedSeasons.at(-2);
  if (last && CROPS[last.crop]?.type === 'legume') { score += 5; strengths.push(`${last.crop} was the latest recorded legume`); }
  if (last && prior && last.crop === prior.crop) { score -= 8; limitations.push('The latest two recorded seasons repeat the same crop'); }
  if (farm?.waterSource === 'Rain-fed') { score -= 4; limitations.push('Rain-fed water supply increases variability'); }
  if (farm?.irrigationMethod === 'Drip') { score += 3; strengths.push('Drip irrigation improves water efficiency'); }
  if (farm?.soilType === 'Sandy loam') { score -= 3; limitations.push('Sandy loam has lower water retention'); }
  const dataPoints = [ph, ec, oc, value('N'), value('P'), value('K')].filter((item) => item != null).length;
  const confidence = dataPoints >= 5 && seasons.length >= 2 && activities.length >= 2 ? 'High' : dataPoints >= 3 || zones.length ? 'Medium' : 'Low';
  const trend = sortedSeasons.map((season) => ({ year: season.year, score: Math.max(0, Math.min(100, Math.round(58 + (season.yieldQuintal / Math.max(season.areaAcres, 1)) * 1.5))) }));
  return { score: Math.max(0, Math.min(100, Math.round(score))), strengths, limitations, missing, confidence, trend, assumptions: ['Prototype indicator; not a standardized soil-health measurement.', 'Missing data reduces confidence and is not treated as poor soil quality.', 'Thresholds are decision-support assumptions and require local agronomist validation.'] };
}

export function recommendations({ farm, seasons = [], soilTests = [], zones = [], weather = [] }) {
  const land = landPower({ farm, seasons, soilTests, zones });
  const last = [...seasons].sort((a, b) => a.year - b.year).at(-1);
  const season = currentSeason();
  return Object.entries(CROPS).map(([crop, definition]) => {
    let suitability = 50;
    const reasons = [];
    const risks = [];
    if (last?.crop === crop) { suitability -= 20; risks.push('Repeating the latest crop can increase carry-over risk'); } else if (last && definition.type === 'legume' && CROPS[last.crop]?.type !== 'legume') { suitability += 8; reasons.push(`Legume rotation after ${last.crop}`); }
    if (land.score < 55 && definition.type === 'legume') { suitability += 8; reasons.push('Restoration-oriented choice while the indicator is below 55'); }
    if ((farm?.waterSource === 'Rain-fed' || farm?.irrigationMethod === 'None') && definition.waterMm > 500) { suitability -= 15; risks.push(`High seasonal water requirement (${definition.waterMm} mm)`); } else { reasons.push(`Water requirement (${definition.waterMm} mm) fits the recorded water context better`); }
    if (definition.season === season) { suitability += 6; reasons.push(`${definition.season} is the current planning season`); } else { suitability -= 12; risks.push(`Usual season is ${definition.season}; current planning season is ${season}`); }
    if (weather.reduce((total, day) => total + num(day.rainfallMm), 0) < 5 && definition.waterMm > 500) { suitability -= 4; risks.push('Low near-term rainfall in the demonstration outlook'); }
    const soilMultiplier = farm?.soilType === 'Black cotton' ? 1 : farm?.soilType === 'Sandy loam' ? 0.92 : 0.98;
    const waterMultiplier = farm?.waterSource === 'Rain-fed' ? 0.9 : 1;
    const expectedYield = definition.baseYield * soilMultiplier * waterMultiplier;
    const cost = definition.cost * (farm?.areaAcres ? 1 : 1);
    const revenue = expectedYield * definition.price;
    return { crop, category: definition.type === 'legume' ? 'Restoration-oriented' : 'Balanced productivity', variety: definition.variety, season: definition.season, waterRequirementMm: definition.waterMm, expectedYieldRange: [Number((expectedYield * 0.85).toFixed(1)), Number((expectedYield * 1.15).toFixed(1))], estimatedCostPerAcre: Math.round(cost), expectedRevenuePerAcre: Math.round(revenue), estimatedProfitPerAcre: Math.round(revenue - cost), suitabilityScore: Math.max(0, Math.min(100, suitability)), reasons, risks, confidence: land.confidence, assumptions: ['Scenario yield and price are demonstration estimates unless replaced by verified local data.', 'Critical agronomic constraints should be validated locally before planting.'] };
  }).sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}

export function categorizedRecommendations(input) {
  const all = recommendations(input);
  const restoration = all.find((item) => item.category === 'Restoration-oriented') || all[0];
  const balanced = all.find((item) => item.crop !== restoration.crop && item.season === currentSeason()) || all.find((item) => item.crop !== restoration.crop) || all[0];
  const profit = [...all].sort((a, b) => (b.estimatedProfitPerAcre * b.suitabilityScore) - (a.estimatedProfitPerAcre * a.suitabilityScore)).find((item) => item.crop !== restoration.crop && item.crop !== balanced.crop) || all[0];
  return [{ ...restoration, category: 'Restoration-oriented' }, { ...balanced, category: 'Balanced productivity' }, { ...profit, category: 'Profit-oriented' }];
}

export function waterBudget({ farm, zones = [], activeCrops = [], sensorReadings = [], weather = [] }) {
  const rain = weather.slice(0, 3).reduce((total, day) => total + num(day.rainfallMm), 0);
  const area = zones.reduce((total, zone) => total + num(zone.areaAcres), 0) || num(farm?.areaAcres) || 1;
  const active = activeCrops[0];
  const crop = CROPS[active?.crop] || CROPS.Chickpea;
  const stageFactor = active?.growthStage === 'Flowering' || active?.growthStage === 'Grain filling' ? 1.15 : 0.8;
  const efficiency = farm?.irrigationMethod === 'Drip' ? 0.9 : 0.7;
  const litresPerMmAcre = 4046;
  const effectiveRainfallFactor = 0.25;
  const projectedDemand = Math.round(crop.waterMm / 120 * 3 * stageFactor * area * litresPerMmAcre / efficiency);
  const rainfallContribution = Math.round(rain * area * litresPerMmAcre * effectiveRainfallFactor);
  const irrigationRequirement = Math.max(0, projectedDemand - rainfallContribution);
  const available = num(farm?.availableWaterLitres);
  const balance = available - irrigationRequirement;
  const zoneAllocation = zones.map((zone) => ({ zoneId: zone.id, zoneName: zone.name, areaAcres: zone.areaAcres, allocationLitres: Math.round(irrigationRequirement * (num(zone.areaAcres) / area)) }));
  return { availableWaterLitres: available, projectedDemandLitres: projectedDemand, expectedRainfallContributionLitres: rainfallContribution, irrigationRequirementLitres: irrigationRequirement, balanceLitres: balance, status: balance < 0 ? 'deficit' : 'surplus', affectedZones: zoneAllocation, assumptions: [`Three-day planning proxy using ${crop.crop || active?.crop || 'Chickpea'} seasonal water requirement`, `${litresPerMmAcre} L per mm-acre conversion; replace with local ETc/soil calibration`, `${Math.round(efficiency * 100)}% irrigation efficiency assumption`, `${Math.round(effectiveRainfallFactor * 100)}% effective-rainfall factor for short-horizon planning`, 'No pump is controlled automatically'] };
}

export function irrigationAdvice({ farm, activeCrops = [], soilTests = [], activities = [], weather = [] }) {
  const crop = activeCrops[0];
  const moisture = latestBy(soilTests, 'parameter', 'Moisture');
  const recentIrrigation = activities.filter((item) => item.type === 'Irrigation').sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  const rain = weather.slice(0, 3).reduce((total, day) => total + num(day.rainfallMm), 0);
  if (!crop) return { recommendation: 'Register the actually planted crop before making an irrigation decision.', timing: 'After crop registration', quantityLitres: 0, reasons: ['No active crop record'], confidence: 'Low', source: 'DECISION_ENGINE' };
  const sensitive = ['Flowering', 'Grain filling'].includes(crop.growthStage);
  const threshold = sensitive ? 30 : 22;
  let recommendation = 'Re-check moisture in 2–3 days';
  let timing = 'Next field check';
  if (rain >= 15) { recommendation = 'Hold irrigation and reassess after the forecast rain'; timing = 'After rainfall event'; }
  else if (!moisture) { recommendation = 'Measure soil moisture before irrigating'; timing = 'Today'; }
  else if (num(moisture.value) < threshold) { recommendation = 'Irrigation likely helpful if field inspection confirms dry topsoil'; timing = 'Within 1–2 days'; }
  else if (num(moisture.value) >= 40) { recommendation = 'Hold irrigation; soil moisture is high'; timing = 'Re-check in 1–2 days'; }
  const daysSince = recentIrrigation ? Math.max(0, Math.round((Date.now() - new Date(recentIrrigation.date).getTime()) / 86400000)) : null;
  return { recommendation, timing, quantityLitres: moisture && num(moisture.value) < threshold ? 4500 : 0, reasons: [`${crop.crop} at ${crop.growthStage} stage${sensitive ? ' is water-sensitive' : ''}`, moisture ? `Latest moisture ${moisture.value}% on ${moisture.date}` : 'No moisture reading is recorded', `Rainfall in next three days: ${rain} mm`, daysSince == null ? 'No recent irrigation record' : `Last irrigation logged ${daysSince} day(s) ago`], confidence: moisture ? 'Medium' : 'Low', source: moisture?.source || 'DECISION_ENGINE', safety: 'Farmer confirmation and hardware safety interlock required before pump operation' };
}

export function climateRisks({ farm, zones = [], sensorReadings = [], weather = [], water = {} }) {
  const rain = weather.slice(0, 5).reduce((total, day) => total + num(day.rainfallMm), 0);
  const moisture = sensorReadings[0]?.soilMoisturePct;
  const droughtScore = (rain < 10 ? 40 : 10) + (num(moisture) < 25 ? 35 : 0) + (water.status === 'deficit' ? 25 : 0);
  const floodScore = (rain >= 70 ? 60 : rain >= 40 ? 30 : 0) + (farm?.soilType === 'Black cotton' ? 15 : 0) + (num(sensorReadings[0]?.waterLevelPct) > 80 ? 25 : 0);
  const risk = (score, kind) => ({ type: kind, level: score >= 70 ? 'High' : score >= 40 ? 'Moderate' : 'Low', score, affectedZones: zones.filter((zone) => kind === 'drought' ? zone.waterAvailability !== 'Adequate' || zone.currentCrop : zone.soilType === 'Black cotton').map((zone) => zone.name), reasons: kind === 'drought' ? ['Low effective rainfall or soil moisture', water.status === 'deficit' ? 'Water budget is in deficit' : 'Available water is not currently flagged as deficit'] : ['Forecast rainfall and drainage conditions should be monitored', farm?.soilType === 'Black cotton' ? 'Black cotton soil can drain slowly during heavy rain' : 'No soil drainage flag recorded'], consequences: kind === 'drought' ? ['Crop stress and yield loss if moisture declines'] : ['Waterlogging, root stress, and delayed field access'], actions: kind === 'drought' ? ['Prioritize water for sensitive growth stages', 'Check soil moisture by zone', 'Review water budget before irrigating'] : ['Clear drainage paths', 'Avoid irrigation before heavy rain', 'Inspect low-lying zones after rainfall'], confidence: weather[0]?.source === 'SIMULATED_WEATHER' ? 'Low — demonstration forecast' : 'Medium' });
  return [risk(droughtScore, 'drought'), risk(floodScore, 'flood_waterlogging')];
}

export function profitAnalysis({ seasons = [], recommendation }) {
  const actual = seasons.map((season) => { const expense = sum(Object.values(season.expenses || {})); const revenue = num(season.yieldQuintal) * num(season.sellingPricePerQuintal); return { ...season, totalExpenses: expense, revenue, profit: revenue - expense, profitPerAcre: (revenue - expense) / Math.max(num(season.areaAcres), 1) }; });
  const actualTotals = { expenses: sum(actual.map((item) => item.totalExpenses)), revenue: sum(actual.map((item) => item.revenue)), profit: sum(actual.map((item) => item.profit)), seasons: actual.length };
  const expected = recommendation ? recommendation.estimatedProfitPerAcre : 0;
  return { actual: { ...actualTotals, profitPerAcre: actualTotals.profit / Math.max(sum(seasons.map((item) => item.areaAcres)), 1) }, future: { conservative: Math.round(expected * 0.75), expected: Math.round(expected), optimistic: Math.round(expected * 1.2), assumptions: ['Estimated yield range is ±15% around the rule-based scenario.', 'Price and costs are demonstration values unless a verified source is connected.', 'Estimated profit is not guaranteed income.'] }, records: actual };
}

export function buildAlerts({ farm, water, risks, irrigation, activeCrops = [], sensorDevices = [], sensorReadings = [] }) {
  const alerts = [];
  if (water.status === 'deficit') alerts.push({ farmId: farm.id, severity: 'warning', category: 'water', title: 'Water budget deficit', message: `Projected deficit of ${Math.abs(water.balanceLitres).toLocaleString('en-IN')} litres.` });
  risks.filter((risk) => risk.level === 'High' || risk.level === 'Moderate').forEach((risk) => alerts.push({ farmId: farm.id, severity: risk.level === 'High' ? 'critical' : 'warning', category: risk.type, title: `${risk.type === 'drought' ? 'Drought' : 'Waterlogging'} risk is ${risk.level.toLowerCase()}`, message: risk.reasons[0] }));
  if (irrigation.confidence === 'Low') alerts.push({ farmId: farm.id, severity: 'info', category: 'irrigation', title: 'Moisture reading needed', message: 'Measure soil moisture before deciding to irrigate.' });
  sensorDevices.filter((device) => Date.now() - new Date(device.lastReadingAt).getTime() > 60 * 60 * 1000).forEach((device) => alerts.push({ farmId: farm.id, severity: 'warning', category: 'sensor', title: `${device.name} may be offline`, message: 'Last reading is stale; no fake reading is substituted.' }));
  activeCrops.filter((crop) => crop.growthStage === 'Flowering').forEach((crop) => alerts.push({ farmId: farm.id, severity: 'info', category: 'crop', title: `${crop.crop} is in a water-sensitive stage`, message: 'Check moisture and rainfall before the next irrigation decision.' }));
  return alerts;
}

export { CROPS, currentSeason, latestBy };
