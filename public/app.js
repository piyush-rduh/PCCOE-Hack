const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const app = $('#app');
const TOKEN_KEY = 'agcro-token';
const state = {
  farmId: null,
  dashboard: null,
  route: 'dashboard',
  chat: [],
  lang: null,
  locale: null,
  farms: [],
  notifications: [],
  market: null,
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null
};
const LOCALE_KEY = 'agcro-language';
const localeTag = () => ({ mr:'mr-IN', hi:'hi-IN' }[state.lang] || 'en-IN');
const esc = (value) => String(value ?? '').replace(/[&<>"'/`]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '/': '&#x2F;', '`': '&#x60;' }[char]));
const number = (value) => Number(value || 0).toLocaleString(localeTag(), { maximumFractionDigits: 0 });
const money = (value) => new Intl.NumberFormat(localeTag(), { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(Number(value) || 0);
const litres = (value) => `${number(value)} ${state.lang === 'mr' ? 'लिटर' : 'L'}`;
const date = (value, options = {}) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : esc(parsed.toLocaleDateString(localeTag(), { day:'numeric', month:'short', year:'numeric', ...options }));
};
const dateTime = (value) => {
  if (!value) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '—' : esc(parsed.toLocaleString(localeTag(), { dateStyle:'medium', timeStyle:'short' }));
};
function getPath(object, path) { return path.split('.').reduce((current, part) => current == null ? undefined : current[part], object); }
function t(key, vars = {}) {
  const value = getPath(state.locale || {}, key);
  if (value === undefined) return esc(key);
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => esc(vars[name] ?? ''));
}
function dataLabel(value) {
  const translated = getPath(state.locale || {}, `data.${value}`);
  return esc(typeof translated === 'string' ? translated : value);
}
function sourceBadge(source) {
  const map = { LIVE_SENSOR:['common.liveSensor','live'], EXTERNAL_API:['common.externalApi','external'], FARMER_ENTERED:['common.farmerEntered','farmer'], SIMULATED_SENSOR:['common.simulated','demo'], SIMULATED_WEATHER:['common.simulated','demo'], DEMO_MARKET_DATA:['common.simulated','demo'], DECISION_ENGINE:['common.decisionEngine','engine'], FARMER_CONFIRMED:['common.farmerEntered','farmer'] };
  const [key, tone] = map[source] || [null, 'muted'];
  return `<span class="provenance ${tone}">${esc(key ? t(key) : source || 'Unknown')}</span>`;
}
function translateError(error) {
  const keys = {
    validation_error:'errors.validation',
    message_required:'errors.messageRequired',
    invalid_credentials:'auth.invalidCredentials',
    user_exists:'errors.userExists',
    unauthorized:'errors.unauthorized',
    token_expired:'errors.unauthorized',
    forbidden:'errors.forbidden',
    not_found:'errors.notFound',
    no_farms:'errors.noFarms',
    zone_farm_mismatch:'errors.zoneMismatch',
    farm_mismatch:'errors.farmMismatch',
    rate_limited:'errors.rateLimited',
    auth_rate_limited:'errors.rateLimited',
    internal_error:'errors.request'
  };
  return keys[error?.code] ? t(keys[error.code]) : t('errors.request');
}
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}
async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
    ...(options.headers || {})
  };
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')) {
    state.token = null;
    state.user = null;
    state.farmId = null;
    state.farms = [];
    state.dashboard = null;
    state.chat = [];
    state.notifications = [];
    localStorage.removeItem(TOKEN_KEY);
    renderAuth();
    const error = new Error(payload.message || 'Authentication required');
    error.code = 'unauthorized';
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.message || t('common.request'));
    error.code = payload.error;
    throw error;
  }
  return payload.data;
}
function currentFarm() { return state.dashboard?.farm || {}; }
function setUpdated() { $('#last-updated').textContent = t('common.updated', { time: new Date().toLocaleTimeString(localeTag(), { hour:'2-digit', minute:'2-digit' }) }); }
function updateStaticCopy() {
  document.documentElement.lang = state.lang;
  document.documentElement.dataset.language = state.lang;
  $$('[data-i18n]').forEach((element) => {
    const value = t(element.dataset.i18n);
    if (value && value !== element.dataset.i18n) element.textContent = value;
  });
  $$('[data-i18n-aria]').forEach((element) => element.setAttribute('aria-label', t(element.dataset.i18nAria)));
  $$('.language-button').forEach((button) => button.classList.toggle('selected', button.dataset.language === state.lang));
  if (state.user) {
    const initials = (state.user.name || state.user.username || 'F').slice(0, 2).toUpperCase();
    const profileBtn = $('#profile-button');
    if (profileBtn) profileBtn.textContent = initials;
  }
  if (state.dashboard) {
    $('#farm-location').innerHTML = `<span aria-hidden="true">⌖</span><span>${esc(state.dashboard.farm.location || '—')}</span>`;
    setUpdated();
  }
}
async function loadLocale(lang) {
  const response = await fetch(`/locales/${lang}.json`);
  if (!response.ok) throw new Error(t('errors.request'));
  state.locale = await response.json();
  state.lang = lang;
  localStorage.setItem(LOCALE_KEY, lang);
  updateStaticCopy();
}
function initialLanguage() {
  const saved = localStorage.getItem(LOCALE_KEY);
  if (['en', 'mr', 'hi'].includes(saved)) return saved;
  const browserLanguage = (navigator.language || '').toLowerCase();
  return browserLanguage.startsWith('en') ? 'en' : browserLanguage.startsWith('hi') ? 'hi' : 'mr';
}
function switchLanguage(lang) {
  if (lang === state.lang) return;
  loadLocale(lang).then(() => {
    if (!state.token) {
      renderAuth();
    } else {
      renderRoute();
    }
  }).catch((error) => toast(translateError(error)));
}
function pageHeading(eyebrow, title, description, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function card(title, body, description = '', meta = '') {
  return `<section class="card"><div class="card-header"><div><h2>${title}</h2>${description ? `<p class="card-description">${description}</p>` : ''}</div>${meta}</div>${body}</section>`;
}
function metric(label, value, sub, tone = '') {
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value ${tone}">${value}</div><div class="metric-sub">${sub}</div></div>`;
}
function actionItem(mark, title, text, action = '') {
  return `<div class="action-item"><div class="action-mark">${esc(mark)}</div><div><b>${title}</b><p>${text}</p>${action ? `<div class="action-control">${action}</div>` : ''}</div></div>`;
}
function alertTitle(alert) {
  const title = String(alert.title || '');
  if (title === 'Water budget deficit') return t('notifications.waterBudgetTitle');
  if (title === 'Moisture reading needed') return t('notifications.moistureTitle');
  const risk = title.match(/^(Drought|Waterlogging) risk is (low|moderate|high)$/i);
  if (risk) return t(`notifications.${risk[1].toLowerCase()}Title`, { level:dataLabel(risk[2][0].toUpperCase() + risk[2].slice(1)) });
  const device = title.match(/^(.+) may be offline$/);
  if (device) return t('notifications.deviceTitle', { name:esc(device[1]) });
  const crop = title.match(/^(.+) is in a water-sensitive stage$/);
  if (crop) return t('notifications.cropTitle', { crop:esc(crop[1]) });
  return dataLabel(title);
}
function alertMessage(message) {
  const deficit = String(message || '').match(/^Projected deficit of ([\d,]+) litres\.$/);
  return deficit ? t('notifications.waterDeficitMessage', { amount:deficit[1] }) : dataLabel(message);
}
function alertMarkup(alert) {
  const title = alertTitle(alert);
  const message = alertMessage(alert.message);
  const severity = esc(alert.severity || 'warning');
  return `<div class="alert-item ${severity === 'critical' ? 'critical' : ''}"><div class="alert-title-row"><b>${title}</b><span class="severity ${severity}">${dataLabel(alert.severity)}</span></div><p>${message}</p><div class="metric-sub">${dateTime(alert.createdAt)}</div><button data-ack="${esc(alert.id)}">${t('common.review')}</button></div>`;
}
function weatherMarkup(weather) {
  const first = weather[0] || {};
  const amount = (value) => value == null ? '—' : number(value);
  return `<div class="weather-head"><div><div class="eyebrow">${sourceBadge(first.source || 'SIMULATED_WEATHER')}</div><div class="weather-temp">${first.temperatureC == null ? '—' : number(first.temperatureC)}°</div><div class="weather-meta">${amount(first.rainfallMm)} mm ${t('monitor.rain')} · ${amount(first.humidityPct)}% ${t('monitor.humidity')}</div></div><div class="weather-meta">${t('dashboard.nextDays')}</div></div><div class="weather-days">${weather.slice(0,5).map((day) => `<div class="weather-day"><span>${day.date ? new Date(day.date).toLocaleDateString(localeTag(), { weekday:'short' }) : t('history.unavailable')}</span><b>${day.temperatureC == null ? '—' : `${number(day.temperatureC)}°`}</b><span>${amount(day.rainfallMm)} mm</span></div>`).join('')}</div>`;
}
function routeLabel(route) {
  const keys = { dashboard:'nav.today', memory:'nav.memory', recommendations:'nav.recommendations', monitor:'nav.monitor', profit:'nav.profit', market:'nav.market', assistant:'nav.assistant', farms:'nav.farms', profile:'nav.profile', notifications:'nav.notifications' };
  return t(keys[route] || 'nav.today');
}

function renderAuth(mode = 'login') {
  app.innerHTML = `
    <div class="page-wrap" style="max-width:540px; margin:2rem auto;">
      <section class="card auth-card">
        <div class="card-header" style="flex-direction:column; align-items:flex-start; gap:8px;">
          <div class="eyebrow">${t('brand.tagline')}</div>
          <h2>${mode === 'login' ? t('auth.signIn') : t('auth.register')}</h2>
          <p class="card-description">${t('auth.loginPrompt')}</p>
        </div>
        <div style="display:flex; gap:10px; margin-bottom:18px;">
          <button type="button" class="btn ${mode === 'login' ? '' : 'secondary'}" id="auth-tab-login">${t('auth.signIn')}</button>
          <button type="button" class="btn ${mode === 'register' ? '' : 'secondary'}" id="auth-tab-register">${t('auth.register')}</button>
        </div>
        <form id="auth-form">
          <div class="form-grid" style="grid-template-columns:1fr;">
            ${mode === 'register' ? `
              <div class="form-field">
                <label>${t('auth.fullName')}
                  <input name="name" type="text" placeholder="Ramesh Patil" required maxlength="100" />
                </label>
              </div>
              <div class="form-field">
                <label>${t('auth.phone')}
                  <input name="phone" type="tel" placeholder="9800000000" pattern="[0-9+\\s-]{8,20}" />
                </label>
              </div>
              <div class="form-field">
                <label>${t('auth.location')}
                  <input name="location" type="text" placeholder="Haveli, Pune" maxlength="120" />
                </label>
              </div>
            ` : ''}
            <div class="form-field">
              <label>${t('auth.username')}
                <input name="username" type="text" placeholder="${mode === 'login' ? 'ramesh' : 'ramesh_patil'}" required pattern="[a-zA-Z0-9_.-]{3,40}" />
              </label>
            </div>
            <div class="form-field">
              <label>${t('auth.password')}
                <input name="password" type="password" placeholder="••••••••" required minlength="8" />
              </label>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px; margin-top:16px;">
            <button class="btn" type="submit">${mode === 'login' ? t('auth.signIn') : t('auth.register')}</button>
            ${mode === 'login' ? `
              <button class="btn secondary" type="button" id="auth-demo-farmer">${t('auth.demoFarmer')}</button>
            ` : ''}
          </div>
        </form>
      </section>
    </div>
  `;

  $('#auth-tab-login')?.addEventListener('click', () => renderAuth('login'));
  $('#auth-tab-register')?.addEventListener('click', () => renderAuth('register'));
  $('#auth-demo-farmer')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'ramesh', password: 'farmer123' })
      });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem(TOKEN_KEY, res.token);
      toast(t('auth.welcome', { name: res.user.name || res.user.username }));
      await loadDashboard();
    } catch (err) {
      toast(translateError(err));
    }
  });

  $('#auth-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = Object.fromEntries(new FormData(e.currentTarget).entries());
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    try {
      const res = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(raw)
      });
      state.token = res.token;
      state.user = res.user;
      localStorage.setItem(TOKEN_KEY, res.token);
      toast(mode === 'register' ? t('auth.registered') : t('auth.welcome', { name: res.user.name || res.user.username }));
      await loadDashboard();
    } catch (err) {
      toast(translateError(err));
    }
  });
}

function renderDashboard() {
  const d = state.dashboard, farm = d.farm, crop = d.activeCrops[0], reading = d.latestReading, water = d.waterBudget, rec = d.recommendations[0], openAlerts = d.alerts || [], risk = d.risks?.find((item) => item.level === 'High') || d.risks?.[0];
  const actions = [];
  if (water.status === 'deficit') actions.push(actionItem('!', t('dashboard.reviewWater'), t('dashboard.waterActionText', { need: litres(water.irrigationRequirementLitres), available: litres(water.availableWaterLitres) }), `<button class="btn warning" data-route-action="monitor">${t('common.open')}</button>`));
  if (!reading) actions.push(actionItem('◌', t('dashboard.reviewMoisture'), t('dashboard.moistureMissing'), `<button class="btn secondary" data-route-action="monitor">${t('common.open')}</button>`));
  if (rec) actions.push(actionItem('✦', t('dashboard.reviewRecommendation', { crop: esc(rec.crop) }), esc(rec.reasons[0] || t('recommendations.explanation')), `<button class="btn secondary" data-route-action="recommendations">${t('common.review')}</button>`));
  if (crop) actions.push(actionItem('↗', t('dashboard.prepareCrop', { crop: esc(crop.crop) }), t('dashboard.currentStage', { stage: dataLabel(crop.growthStage) }), `<button class="btn secondary" data-route-action="monitor">${t('common.open')}</button>`));
  const quick = [['recommendations','recommendations','✦'],['monitor','irrigation','◌'],['profit','profit','₹'],['weather','weather','◒'],['memory','memory','▤'],['schemes','schemes','⌁'],['market','market','⌁'],['assistant','assistant','✧']];
  const serviceCards = quick.map(([route, key, icon]) => `<button class="service-card" data-route-action="${route === 'weather' || route === 'schemes' ? (route === 'weather' ? 'monitor' : 'market') : route}"><span class="service-icon" aria-hidden="true">${icon}</span><span><b>${t(`dashboard.services.${key}`)}</b><small>${t(`dashboard.services.${key}Desc`)}</small></span><span class="service-arrow" aria-hidden="true">→</span></button>`).join('');
  return pageHeading(t('dashboard.eyebrow'), t('dashboard.greeting', { name: esc(d.farmer?.name?.split(' ')[0] || state.user?.name?.split(' ')[0] || t('auth.fullName')) }), t('dashboard.intro', { farm: esc(farm.name) }), `<button class="btn" data-action="log-activity">${t('memory.addActivity')}</button><button class="btn secondary" data-route-action="farms">${t('farms.addFarm')}</button><button class="btn secondary" data-action="ask-ai">${t('dashboard.why')}</button>`) +
  `<div class="farm-context-strip"><span><b>${esc(crop?.crop || '—')}</b><small>${t('farms.currentCrop')}</small></span><span><b>${number(farm.areaAcres)} ac</b><small>${t('farms.area')}</small></span><span><b>${number(d.zones.length)}</b><small>${t('memory.zones')}</small></span><span><b>${dataLabel(crop?.growthStage || '—')}</b><small>${t('forms.growthStage')}</small></span><span><b>${dataLabel(d.seasons.at(-1)?.season || '—')}</b><small>${t('history.season')}</small></span><span><b>${esc(farm.location || '—')}</b><small>${t('header.location')}</small></span></div>` +
  `<div class="today-panel"><section class="hero-card"><div class="eyebrow">${t('dashboard.todayQuestion')}</div><h2>${water.status === 'deficit' ? t('dashboard.waterAction') : rec ? t('dashboard.reviewCrop', { crop: esc(rec.crop) }) : t('dashboard.recordObservation')}</h2><p>${water.status === 'deficit' ? t('dashboard.waterSummary', { amount: litres(Math.abs(water.balanceLitres)) }) : t('dashboard.safeSummary')}</p><div class="hero-action"><button class="btn" data-route-action="monitor">${t('dashboard.openDetail')}</button><button class="btn secondary" data-action="explain-today">${t('dashboard.why')}</button></div></section><section class="weather-card">${weatherMarkup(d.weather)}</section></div>` +
  `<div class="grid metric-grid">${metric(t('dashboard.landPower'), `${d.landPower.score}/100`, `${dataLabel(d.landPower.confidence)} · ${t('common.notStandardized')}`)}${metric(t('dashboard.soilMoisture'), reading ? `${reading.soilMoisturePct}%` : '—', reading ? `${reading.temperatureC}°C · ${sourceBadge(reading.source)}` : t('common.noData'))}${metric(t('monitor.availableWater'), litres(water.availableWaterLitres), `${water.status === 'deficit' ? t('monitor.deficit') : t('monitor.surplus')} · ${sourceBadge('DECISION_ENGINE')}`)}${metric(t('monitor.projectedNeed'), litres(water.irrigationRequirementLitres), t('monitor.formula'))}${metric(t('profit.future'), money(d.profit.future.expected), t('common.notGuaranteed'))}${metric(t('monitor.riskIntelligence'), dataLabel(risk?.level || 'Low'), risk?.type === 'drought' ? t('monitor.drought') : t('monitor.flood'))}</div>` +
  `${card(t('dashboard.important'), actions.length ? `<div class="action-list">${actions.join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('dashboard.actionsNote'), sourceBadge('DECISION_ENGINE'))}` +
  `<section class="service-section"><div class="section-title"><div><div class="eyebrow">${t('dashboard.quickAccess')}</div><h2>${t('dashboard.quickDescription')}</h2></div></div><div class="service-grid">${serviceCards}</div></section>` +
  `<div class="grid content-grid"><div class="section-stack">${card(t('recommendations.title'), d.recommendations.map((item, index) => `<div class="action-item"><div class="action-mark">${index + 1}</div><div class="action-copy"><div class="inline-between"><b>${esc(item.crop)}</b><span class="score-pill">${item.suitabilityScore}/100</span></div><p>${esc(item.reasons[0] || item.risks[0] || t('recommendations.explanation'))}</p></div></div>`).join(''), t('recommendations.notice'), sourceBadge('DECISION_ENGINE'))}</div><div class="section-stack">${card(t('dashboard.important'), openAlerts.length ? `<div class="alert-list">${openAlerts.slice(0,4).map(alertMarkup).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('dashboard.actionsNote'), sourceBadge('DECISION_ENGINE'))}${card(t('memory.seasonHistory'), crop ? `<div class="inline-between"><div><h3>${esc(crop.crop)}</h3><div class="metric-sub">${esc(crop.variety)} · ${dataLabel(crop.growthStage)} · ${dataLabel(crop.status)}</div></div>${sourceBadge(crop.source)}</div><div class="balance"><div class="balance-fill" style="width:${Math.min(100, Math.max(8, ['Sowing','Vegetative','Flowering','Grain filling','Maturity','Harvested'].indexOf(crop.growthStage) / 5 * 100))}%"></div></div><div class="balance-labels"><span>${date(crop.planted)}</span><span>${date(crop.expectedHarvest)}</span></div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('recommendations.explanation'))}</div></div>`;
}

function renderMemory() {
  const d = state.dashboard, land = d.landPower;
  const records = d.profit.records;
  const seasonRows = records.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.seasons')}</th><th>${t('recommendations.crop')}</th><th>${t('history.planted')}</th><th>${t('history.harvested')}</th><th>${t('memory.yield')}</th><th>${t('memory.revenue')}</th><th>${t('memory.profit')}</th><th>${t('common.source')}</th><th></th></tr></thead><tbody>${records.map((record) => `<tr><td>${dataLabel(record.season)} ${record.year}</td><td><b>${esc(record.crop)}</b><div class="metric-sub">${esc(record.variety || '—')}</div></td><td>${record.plantedDate ? date(record.plantedDate) : t('history.unavailable')}</td><td>${record.harvestedDate ? date(record.harvestedDate) : t('history.unavailable')}</td><td>${number(record.yieldQuintal)} q</td><td>${money(record.revenue)}</td><td class="${record.profit < 0 ? 'number-negative' : 'number-positive'}">${money(record.profit)}</td><td>${sourceBadge(record.source)}</td><td><button class="btn secondary small-button" data-edit-season="${esc(record.id)}">${t('common.edit')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noSeasons')}</div>`;
  const activityItems = d.activities.length ? `<div class="action-list">${d.activities.slice().reverse().map((item) => `<div class="action-item"><div class="action-mark">•</div><div class="action-copy"><div class="inline-between"><b>${esc(item.type)} · ${date(item.date)}</b><button class="btn secondary small-button" data-edit-activity="${esc(item.id)}">${t('common.edit')}</button></div><p>${esc(item.quantity)} ${esc(item.unit)}${item.notes ? ` · ${esc(item.notes)}` : ''}</p>${sourceBadge(item.source)}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('memory.noActivities')}</div>`;
  const soilItems = d.soilTests.length ? `<div class="action-list">${d.soilTests.slice().reverse().map((item) => `<div class="action-item"><div class="action-mark">pH</div><div class="action-copy"><div class="inline-between"><b>${esc(item.parameter)}: ${number(item.value)} ${esc(item.unit || '')}</b><button class="btn secondary small-button" data-edit-soil="${esc(item.id)}">${t('common.edit')}</button></div><p>${t('forms.zone')}: ${esc(d.zones.find((zone) => zone.id === item.zoneId)?.name || t('history.unavailable'))} · ${date(item.date)}</p>${sourceBadge(item.source)}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`;
  const decisions = d.decisions?.length ? `<div class="action-list">${d.decisions.map((item) => `<div class="action-item"><div class="action-mark">✓</div><div><b>${esc(item.crop || item.category)}</b><p>${dataLabel(item.status)} · ${dateTime(item.createdAt)}</p>${sourceBadge(item.source)}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('recommendations.noDecisions')}</div>`;
  return pageHeading(t('memory.eyebrow'), t('memory.title'), t('memory.description'), `<button class="btn" data-action="add-season">${t('history.addSeason')}</button><button class="btn secondary" data-action="log-activity">${t('memory.addActivity')}</button><button class="btn secondary" data-action="add-soil">${t('memory.addSoil')}</button>`) +
  `<div class="grid metric-grid">${metric(t('memory.seasons'), d.seasons.length, d.seasons.length ? `${esc(d.seasons.at(-1).crop)} · ${d.seasons.at(-1).year}` : t('memory.noSeasons'))}${metric(t('memory.soilParameters'), new Set(d.soilTests.map((x) => x.parameter)).size, `${land.missing.length} ${t('memory.missing')}`)}${metric(t('memory.zones'), d.zones.length, `${number(d.zones.reduce((a,z)=>a+Number(z.areaAcres||0),0))} ac`)}${metric(t('memory.activities'), d.activities.length, t('common.farmerRecord'))}</div>` +
  `<div class="grid content-grid"><div class="section-stack">${card(t('memory.seasonHistory'), seasonRows, t('profit.formula'))}${card(t('memory.recent'), activityItems)}${card(t('history.soilHistory'), soilItems)}${card(t('recommendations.decisionHistory'), decisions)}</div><div class="section-stack">${card(t('memory.landExplanation'), `<div class="inline-between"><div class="metric-value">${land.score}</div>${sourceBadge('DECISION_ENGINE')}</div><p class="card-description">${dataLabel(land.confidence)} ${t('common.confidence')}. ${t('memory.missingHint')}</p><div class="mini-bars">${(land.trend?.length ? land.trend : [{year:'—',score:land.score}]).map((point) => `<div class="mini-bar" style="height:${Math.max(8, point.score)}%"><span>${point.year}</span></div>`).join('')}</div><div class="explanation-list"><h3>${t('memory.strengths')}</h3><ul class="card-description">${(land.strengths.length ? land.strengths : [t('memory.noStrengths')]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h3>${t('memory.limitations')}</h3><ul class="card-description">${(land.limitations.length ? land.limitations : [t('memory.noLimitations')]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`, t('common.notStandardized'))}${card(t('memory.missing'), land.missing.length ? `<div class="tag-row">${land.missing.map((item) => `<span class="provenance demo">${esc(item)} ${t('memory.parametersNeeded', { parameter:'' }).trim()}</span>`).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('memory.missingHint'))}</div></div>`;
}

function renderProfile() {
  const user = state.user || {};
  return pageHeading(t('profile.eyebrow'), t('profile.title'), t('profile.description')) +
    `<div class="grid content-grid"><section class="card"><div class="card-header"><div><h2>${t('profile.account')}</h2><p class="card-description">${t('profile.accountNote')}</p></div></div><form id="profile-form" class="form-grid"><div class="form-field"><label>${t('auth.fullName')}<input name="name" value="${esc(user.name || '')}" maxlength="100" required></label></div><div class="form-field"><label>${t('auth.phone')}<input name="phone" type="tel" value="${esc(user.phone || '')}" maxlength="20" pattern="[0-9+\\s-]{8,20}"></label></div><div class="form-field form-wide"><label>${t('auth.location')}<input name="location" value="${esc(user.location || '')}" maxlength="160"></label></div><div class="form-wide"><button class="btn" type="submit">${t('common.save')}</button></div></form></section><section class="card"><h2>${t('profile.accountDetails')}</h2><dl class="profile-details"><div><dt>${t('auth.username')}</dt><dd>${esc(user.username || '—')}</dd></div><div><dt>${t('profile.role')}</dt><dd>${esc(user.role || '—')}</dd></div><div><dt>${t('profile.memberSince')}</dt><dd>${user.createdAt ? date(user.createdAt) : t('history.unavailable')}</dd></div><div><dt>${t('header.currentFarm')}</dt><dd>${esc(currentFarm().name || t('history.unavailable'))}</dd></div></dl><button class="btn danger" id="profile-logout-btn">${t('auth.logout')}</button></section></div>`;
}

function renderFarms() {
  const selected = currentFarm();
  const farms = state.farms.length ? `<div class="grid farms-grid">${state.farms.map((farm) => {
    const active = farm.id === state.farmId;
    const zones = active ? state.dashboard?.zones || [] : [];
    return `<section class="card farm-card"><div class="inline-between"><div><h2>${esc(farm.name)}</h2><p class="card-description">${esc(farm.location)}</p></div>${active ? `<span class="provenance live">${t('farms.active')}</span>` : `<button class="btn secondary small-button" data-select-farm="${esc(farm.id)}">${t('farms.select')}</button>`}</div><div class="farm-details"><span><b>${number(farm.areaAcres)} ac</b><small>${t('farms.area')}</small></span><span><b>${esc(farm.soilType)}</b><small>${t('farms.soil')}</small></span><span><b>${esc(farm.irrigationMethod)}</b><small>${t('farms.irrigation')}</small></span><span><b>${litres(farm.availableWaterLitres)}</b><small>${t('monitor.availableWater')}</small></span></div><p class="metric-sub">${t('common.source')}: ${sourceBadge(farm.source)}</p><div class="heading-actions"><button class="btn secondary small-button" data-edit-farm="${esc(farm.id)}">${t('common.edit')}</button><button class="btn danger small-button" data-delete-farm="${esc(farm.id)}">${t('common.delete')}</button></div>${active ? `<div class="farm-zones"><div class="inline-between"><h3>${t('farms.zones')}</h3><button class="btn small-button" data-action="add-zone">${t('farms.addZone')}</button></div>${zones.length ? `<div class="zone-grid">${zones.map((zone) => `<div class="action-item"><div class="action-mark">▦</div><div class="action-copy"><div class="inline-between"><b>${esc(zone.name)}</b><span>${number(zone.areaAcres)} ac</span></div><p>${t('farms.soil')}: ${esc(zone.soilType)} · ${t('farms.waterAvailability')}: ${dataLabel(zone.waterAvailability)}</p><p>${t('farms.currentCrop')}: ${esc(zone.currentCrop || t('history.unavailable'))} · ${dataLabel(zone.growthStage || '—')}</p><div class="heading-actions"><button class="btn secondary small-button" data-edit-zone="${esc(zone.id)}">${t('common.edit')}</button><button class="btn danger small-button" data-delete-zone="${esc(zone.id)}">${t('common.delete')}</button></div></div></div>`).join('')}</div>` : `<div class="empty-state">${t('farms.noZones')}</div>`}</div>` : ''}</section>`;
  }).join('')}</div>` : `<div class="empty-state">${t('farms.noFarms')}</div>`;
  return pageHeading(t('farms.eyebrow'), t('farms.title'), t('farms.description'), `<button class="btn" data-action="add-farm">${t('farms.addFarm')}</button>`) +
    `${!state.farms.length ? `<div class="notice section-card">${t('farms.emptyHint')}</div>` : ''}${farms}`;
}

function renderNotifications() {
  const alerts = state.notifications;
  return pageHeading(t('notifications.eyebrow'), t('notifications.title'), t('notifications.description'), `<button class="btn secondary" data-action="refresh-notifications">${t('common.refresh')}</button>`) +
    `<section class="card">${alerts.length ? `<div class="alert-list">${alerts.map((alert) => `<div class="alert-item ${alert.severity === 'critical' ? 'critical' : ''}"><div class="alert-title-row"><b>${alertTitle(alert)}</b><span class="severity ${esc(alert.severity)}">${dataLabel(alert.severity)}</span></div><p>${alertMessage(alert.message)}</p><div class="inline-between"><span class="metric-sub">${dateTime(alert.createdAt)} · ${sourceBadge(alert.source)}</span>${alert.acknowledged ? `<span class="provenance farmer">${t('notifications.acknowledged')}</span>` : `<button class="btn secondary small-button" data-ack="${esc(alert.id)}">${t('notifications.acknowledge')}</button>`}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('notifications.empty')}</div>`}</section>`;
}

function recCard(item, index) {
  const reasons = item.reasons?.length ? item.reasons.map((reason) => `<li>${dataLabel(reason)}</li>`).join('') : `<li>${t('history.unavailable')}</li>`;
  const risks = item.risks?.length ? `<div class="tag-row rec-risk"><span class="provenance demo">${t('recommendations.risk')}</span><span class="metric-sub">${item.risks.map(dataLabel).join(' · ')}</span></div>` : '';
  return `<article class="recommendation ${index === 1 ? 'featured' : ''}"><div class="rec-top"><div class="rec-category">${dataLabel(item.category)}</div><span class="score-pill">${item.suitabilityScore}/100</span></div><div class="crop-illustration" aria-hidden="true">${index === 0 ? '🌱' : index === 1 ? '🌾' : '🌿'}</div><h3>${esc(item.crop)}</h3><div class="variety">${esc(item.variety)} · ${dataLabel(item.season)} · ${item.waterRequirementMm} mm ${t('recommendations.waterReference')}</div><div class="rec-stats"><div class="rec-stat"><span>${t('recommendations.yieldRange')} · ${t('common.estimated')}</span><b>${item.expectedYieldRange[0]}–${item.expectedYieldRange[1]} q/ac</b></div><div class="rec-stat"><span>${t('recommendations.profitAcre')} · ${t('common.estimated')}</span><b>${money(item.estimatedProfitPerAcre)}</b></div><div class="rec-stat"><span>${t('recommendations.costAcre')} · ${t('common.estimated')}</span><b>${money(item.estimatedCostPerAcre)}</b></div><div class="rec-stat"><span>${t('common.confidence')}</span><b>${dataLabel(item.confidence)}</b></div></div><div class="rec-copy"><b>${t('recommendations.suitability')}</b><ul>${reasons}</ul></div>${risks}<div class="card-actions"><button class="btn" data-rec-explain="${esc(item.crop)}">${t('common.explain')}</button><button class="btn secondary" data-rec-decision="${esc(item.crop)}" data-status="accepted">${t('recommendations.accept')}</button><button class="btn secondary" data-rec-decision="${esc(item.crop)}" data-status="rejected">${t('recommendations.reject')}</button></div></article>`;
}

function renderRecommendations() {
  const d = state.dashboard;
  return pageHeading(t('recommendations.eyebrow'), t('recommendations.title'), t('recommendations.description'), `<button class="btn secondary" data-action="ask-ai">${t('recommendations.compare')}</button>`) +
  `<div class="notice section-card">${sourceBadge('DECISION_ENGINE')} ${t('recommendations.notice')} ${t('common.localAdvice')}</div><div class="recommendations">${d.recommendations.map(recCard).join('')}</div><div class="grid content-grid section-gap"><div>${card(t('recommendations.whyLenses'), `<div class="action-list">${actionItem('01', t('recommendations.restore'), t('recommendations.restoreText'))}${actionItem('02', t('recommendations.balanced'), t('recommendations.balancedText'))}${actionItem('03', t('recommendations.profitLens'), t('recommendations.profitText'))}</div>`)}</div>${card(t('recommendations.decisionHistory'), d.decisions?.length ? d.decisions.slice().reverse().map((x) => `<div class="action-item"><div class="action-mark">✓</div><div><b>${esc(x.crop || x.category)}</b><p>${dataLabel(x.status)} · ${dateTime(x.createdAt)}</p></div></div>`).join('') : `<div class="empty-state">${t('recommendations.noDecisions')}</div>`)}</div></div>`;
}

function renderMonitor() {
  const d = state.dashboard, water = d.waterBudget, irrigation = d.irrigation, max = Math.max(water.availableWaterLitres, water.irrigationRequirementLitres, 1);
  const readings = d.sensorReadings?.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('monitor.recorded')}</th><th>${t('monitor.soilMoisture')}</th><th>${t('forms.temperature')}</th><th>${t('forms.humidity')}</th><th>${t('common.source')}</th></tr></thead><tbody>${d.sensorReadings.map((reading) => `<tr><td>${dateTime(reading.recordedAt)}</td><td>${number(reading.soilMoisturePct)}%</td><td>${reading.temperatureC == null ? '—' : `${number(reading.temperatureC)}°C`}</td><td>${reading.humidityPct == null ? '—' : `${number(reading.humidityPct)}%`}</td><td>${sourceBadge(reading.source)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('monitor.noReadings')}</div>`;
  const forecast = d.weather.length ? weatherMarkup(d.weather) : `<div class="empty-state">${t('common.noData')}</div>`;
  return pageHeading(t('monitor.eyebrow'), t('monitor.title'), t('monitor.description'), `${d.sensorDevices.length ? `<button class="btn" data-action="add-reading">${t('monitor.addReading')}</button>` : ''}<button class="btn secondary" data-action="add-soil">${t('memory.addSoil')}</button>`) +
  `<div class="grid content-grid"><div class="section-stack">${card(t('monitor.waterBudget'), `<div class="grid split-two"><div><div class="metric-label">${t('monitor.availableWater')}</div><div class="metric-value">${litres(water.availableWaterLitres)}</div></div><div><div class="metric-label">${t('monitor.projectedNeed')}</div><div class="metric-value">${litres(water.irrigationRequirementLitres)}</div></div></div><div class="balance"><div class="balance-fill ${water.status === 'deficit' ? 'deficit' : ''}" style="width:${Math.min(100, Math.round((Math.min(water.availableWaterLitres, water.irrigationRequirementLitres) / max) * 100))}%"></div></div><div class="balance-labels"><span>${water.status === 'deficit' ? `${t('monitor.deficit')} ${litres(Math.abs(water.balanceLitres))}` : `${t('monitor.surplus')} ${litres(water.balanceLitres)}`}</span><span>${dataLabel(water.status)}</span></div><div class="grid split-two compact-grid"><div class="rec-stat"><span>${t('monitor.rainContribution')}</span><b>${litres(water.expectedRainfallContributionLitres)}</b></div><div class="rec-stat"><span>${t('monitor.zonesAllocated')}</span><b>${water.affectedZones.length}</b></div></div><details class="details-block"><summary class="metric-label">${t('common.assumptions')}</summary><ul class="card-description">${water.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`, t('monitor.formula'), sourceBadge('DECISION_ENGINE'))}${card(t('monitor.zoneAllocation'), water.affectedZones.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('monitor.zoneAllocation')}</th><th>${t('monitor.area')}</th><th>${t('monitor.allocation')}</th></tr></thead><tbody>${water.affectedZones.map((zone) => `<tr><td><b>${esc(zone.zoneName)}</b></td><td>${zone.areaAcres} ac</td><td>${litres(zone.allocationLitres)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('common.noData')}</div>`)}</div><div class="section-stack">${card(t('monitor.weather'), forecast, t('monitor.weatherNote'))}${card(t('monitor.sensorStatus'), d.sensorDevices.length ? d.sensorDevices.map((device) => `<div class="action-item"><div class="action-mark">◌</div><div><div class="inline-between"><b>${esc(device.name)}</b>${sourceBadge(device.source)}</div><p>${dataLabel(device.status)} · ${t('header.lastReading')} ${dateTime(device.lastReadingAt)}</p></div></div>`).join('') : `<div class="empty-state">${t('monitor.noDevices')}</div>`, t('monitor.staleNote'))}${card(t('monitor.readings'), readings, t('monitor.readingsNote'))}${card(t('monitor.irrigationAdvice'), `<h3>${esc(irrigation.recommendation)}</h3><p class="card-description" style="margin-top:7px">${t('monitor.timing')}: ${esc(irrigation.timing)} · ${t('monitor.suggested')}: ${litres(irrigation.quantityLitres)} · ${t('common.confidence')}: ${dataLabel(irrigation.confidence)}</p><ul class="card-description">${irrigation.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="notice" style="margin-top:12px">${esc(irrigation.safety)}</div>`, t('monitor.safety'))}${card(t('monitor.riskIntelligence'), d.risks.map((risk) => `<div class="action-item"><div class="action-mark ${risk.level === 'High' ? 'risk-mark' : ''}">${risk.level === 'High' ? '!' : 'i'}</div><div><div class="inline-between"><b>${risk.type === 'drought' ? t('monitor.drought') : t('monitor.flood')}</b><span class="score-pill">${dataLabel(risk.level)}</span></div><p>${esc(risk.reasons[0])}</p><div class="metric-sub">${t('common.confidence')}: ${esc(risk.confidence)}</div></div></div>`).join(''), t('monitor.riskSignal'))}</div></div>`;
}

function renderProfit() {
  const p = state.dashboard.profit, future = p.future;
  return pageHeading(t('profit.eyebrow'), t('profit.title'), t('profit.description'), `<button class="btn secondary" data-action="ask-ai">${t('profit.explain')}</button><button class="btn" data-action="export">${t('common.export')}</button>`) +
  `<div class="grid metric-grid">${metric(t('profit.actualRevenue'), money(p.actual.revenue), t('profit.recordedSeasons', { count: p.actual.seasons }))}${metric(t('profit.actualExpenses'), money(p.actual.expenses), t('memory.costCategories'))}${metric(t('profit.actualProfit'), money(p.actual.profit), `${money(p.actual.profitPerAcre)} / ac`)}${metric(t('profit.future'), money(future.expected), t('common.notGuaranteed'))}</div>` +
  `<div class="grid content-grid"><div>${card(t('profit.futureScenarios'), `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('profit.scenario')}</th><th>${t('profit.profitAcre')}</th><th>${t('profit.interpretation')}</th></tr></thead><tbody><tr><td>${t('profit.conservative')}</td><td class="number-positive">${money(future.conservative)}</td><td>${t('profit.lower')}</td></tr><tr><td><b>${t('profit.expected')}</b></td><td class="number-positive"><b>${money(future.expected)}</b></td><td>${t('profit.ruleBased')}</td></tr><tr><td>${t('profit.optimistic')}</td><td class="number-positive">${money(future.optimistic)}</td><td>${t('profit.favourable')}</td></tr></tbody></table></div><div class="notice" style="margin-top:16px">${future.assumptions.map(esc).join(' ')} ${t('common.notGuaranteed')}</div>`, t('profit.formula'), sourceBadge('DECISION_ENGINE'))}</div>${card(t('profit.costCategories'), p.records.length ? `<div class="action-list">${['seeds','fertilizer','pesticide','labour','irrigation','machinery','transport','other'].map((key) => `<div class="action-item"><div class="action-mark">₹</div><div><b>${dataLabel(key)}</b><p>${money(p.records.reduce((total, row) => total + Number(row.expenses?.[key] || 0), 0))}</p></div></div>`).join('')}</div>` : `<div class="empty-state">${t('profit.noRecords')}</div>`)}</div>`;
}

function renderMarket() {
  return pageHeading(t('market.eyebrow'), t('market.title'), t('market.description'), `<button class="btn secondary" data-action="refresh">${t('common.refresh')}</button>`) +
  `<div class="grid content-grid"><div>${card(t('market.marketReference'), `<div class="notice" style="margin-bottom:13px">${sourceBadge('DEMO_MARKET_DATA')} ${t('market.marketNotice')}</div><div id="market-table" class="empty-state">${t('common.loading')}</div>`)}</div><div>${card(t('market.schemes'), `<div id="scheme-list" class="section-stack">${t('common.loading')}</div>`)}</div></div>`;
}

function renderAssistant() {
  const d = state.dashboard;
  return pageHeading(t('assistant.eyebrow'), t('assistant.title'), t('assistant.description'), `<button class="btn" data-action="explain-today">${t('assistant.explainToday')}</button>`) +
  `<div class="grid content-grid"><div>${card(t('assistant.assistant'), `<div class="chat" id="chat-window">${state.chat.length ? state.chat.map((item) => `<div class="chat-message ${item.role === 'user' ? 'user' : ''}"><div class="chat-meta">${item.role === 'user' ? t('assistant.you') : t('assistant.fallback')}</div>${esc(item.text)}</div>`).join('') : `<div class="empty-state">${t('assistant.tryAsk')}</div>`}</div><div class="tag-row chat-suggestions">${t('assistant.suggestions').map((question) => `<button class="btn secondary" data-question="${esc(question)}">${esc(question)}</button>`).join('')}</div><form class="chat-input" id="chat-form"><input id="chat-input" placeholder="${t('assistant.placeholder')}" aria-label="${t('assistant.placeholder')}" required /><button class="btn">${t('common.send')}</button></form>`)}</div>${card(t('assistant.evidence'), `<div class="action-list">${actionItem('LP', t('assistant.land'), `${d.landPower.score}/100 · ${dataLabel(d.landPower.confidence)}`, sourceBadge('DECISION_ENGINE'))}${actionItem('W', t('monitor.waterBudget'), `${dataLabel(d.waterBudget.status)} · ${litres(d.waterBudget.balanceLitres)}`, sourceBadge('DECISION_ENGINE'))}${actionItem('C', t('assistant.crop'), `${esc(d.recommendations[0]?.crop || '—')} · ${t('assistant.topRanked')}`, sourceBadge('DECISION_ENGINE'))}${actionItem('P', t('assistant.scenario'), `${money(d.profit.future.expected)} / ac`, sourceBadge('DECISION_ENGINE'))}</div>`, t('common.assumptions'))}</div>`;
}

async function renderRoute() {
  if (!state.token) {
    renderAuth();
    return;
  }
  state.route = (location.hash.slice(1) || 'dashboard').split('/')[0];
  $$('.nav-link, .mobile-bottom-nav a').forEach((link) => link.classList.toggle('active', link.dataset.route === state.route));
  $('#page-kicker').textContent = routeLabel(state.route);
  const renderers = { dashboard:renderDashboard, memory:renderMemory, recommendations:renderRecommendations, monitor:renderMonitor, profit:renderProfit, market:renderMarket, assistant:renderAssistant, farms:renderFarms, profile:renderProfile, notifications:renderNotifications };
  if (!state.dashboard && !['farms', 'profile', 'notifications'].includes(state.route)) {
    state.route = 'farms';
    location.hash = '#farms';
  }
  app.innerHTML = (renderers[state.route] || renderDashboard)();
  wire();
  if (state.route === 'market') await loadMarket();
  if (state.route === 'notifications') await loadNotifications();
}

function activityForm(record = {}) {
  const types = ['Irrigation','Fertilizer','Pesticide','Weeding','Observation'], typeLabels = t('forms.activityTypes'), units = ['mm','kg','litre','labour-days'], unitLabels = t('forms.units');
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.type')}<select name="type">${types.map((x, i) => `<option value="${esc(x)}" ${record.type === x ? 'selected' : ''}>${esc(typeLabels[i] || x)}</option>`).join('')}${record.type && !types.includes(record.type) ? `<option selected>${esc(record.type)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.date')}<input name="date" type="date" value="${esc(record.date || new Date().toISOString().slice(0,10))}" required></label></div><div class="form-field"><label>${t('forms.quantity')}<input name="quantity" type="number" min="0" step="any" value="${esc(record.quantity ?? 0)}" required></label></div><div class="form-field"><label>${t('forms.unit')}<select name="unit">${units.map((x, i) => `<option value="${esc(x)}" ${record.unit === x ? 'selected' : ''}>${esc(unitLabels[i] || x)}</option>`).join('')}${record.unit && !units.includes(record.unit) ? `<option selected>${esc(record.unit)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId"><option value="">—</option>${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}" ${record.zoneId === zone.id ? 'selected' : ''}>${esc(zone.name)}</option>`).join('')}</select></label></div></div><div class="form-field form-wide"><label>${t('forms.notes')}<textarea name="notes" maxlength="1000">${esc(record.notes || '')}</textarea></label></div><button class="btn" type="submit">${t('forms.saveActivity')}</button></form>`;
}

function soilForm(record = {}) {
  const parameters = ['pH','EC','Organic carbon','N','P','K','Moisture'], labels = t('forms.parameters');
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.parameter')}<select name="parameter">${parameters.map((x, i) => `<option value="${esc(x)}" ${record.parameter === x ? 'selected' : ''}>${esc(labels[i] || x)}</option>`).join('')}${record.parameter && !parameters.includes(record.parameter) ? `<option selected>${esc(record.parameter)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.value')}<input name="value" type="number" min="0" step="any" value="${esc(record.value ?? '')}" required></label></div><div class="form-field"><label>${t('forms.date')}<input name="date" type="date" value="${esc(record.date || new Date().toISOString().slice(0,10))}" required></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId"><option value="">—</option>${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}" ${record.zoneId === zone.id ? 'selected' : ''}>${esc(zone.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.unit')}<input name="unit" value="${esc(record.unit || '')}" maxlength="20"></label></div></div><button class="btn" type="submit">${t('forms.saveSoil')}</button></form>`;
}

function readingForm() {
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.device')}<select name="deviceId">${state.dashboard.sensorDevices.map((device) => `<option value="${esc(device.id)}">${esc(device.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId">${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.soilMoisture')}<input name="soilMoisturePct" type="number" min="0" max="100" step="any" required></label></div><div class="form-field"><label>${t('forms.temperature')}<input name="temperatureC" type="number" min="-20" max="70" step="any" required></label></div><div class="form-field"><label>${t('forms.humidity')}<input name="humidityPct" type="number" min="0" max="100" step="any" required></label></div><div class="form-field"><label>${t('forms.waterLevel')}<input name="waterLevelPct" type="number" min="0" max="100" step="any"></label></div></div><div class="notice form-notice">${t('forms.readingNotice')}</div><button class="btn" type="submit">${t('forms.saveReading')}</button></form>`;
}

function farmForm(farm = {}) {
  const field = (name, key, type = 'text', value = '') => `<div class="form-field"><label>${t(key)}<input name="${name}" type="${type}" value="${esc(value)}" ${name === 'areaAcres' ? 'min="0.01" step="any"' : name === 'availableWaterLitres' ? 'min="0" step="any"' : 'maxlength="160"'} required></label></div>`;
  return `<form id="farm-form" class="form-grid">${field('name', 'farms.name', 'text', farm.name)}${field('areaAcres', 'farms.area', 'number', farm.areaAcres)}${field('soilType', 'farms.soil', 'text', farm.soilType)}${field('waterSource', 'farms.waterSource', 'text', farm.waterSource)}${field('irrigationMethod', 'farms.irrigation', 'text', farm.irrigationMethod)}${field('availableWaterLitres', 'monitor.availableWater', 'number', farm.availableWaterLitres ?? 0)}<div class="form-field form-wide"><label>${t('auth.location')}<input name="location" value="${esc(farm.location || '')}" maxlength="160" required></label></div><div class="form-wide"><button class="btn" type="submit">${t('common.save')}</button></div></form>`;
}

function zoneForm(zone = {}) {
  const stages = ['Sowing','Vegetative','Flowering','Grain filling','Maturity','Harvested'];
  return `<form id="zone-form" class="form-grid"><div class="form-field"><label>${t('farms.zoneName')}<input name="name" value="${esc(zone.name || '')}" maxlength="80" required></label></div><div class="form-field"><label>${t('farms.area')}<input name="areaAcres" type="number" min="0.01" step="any" value="${esc(zone.areaAcres || '')}" required></label></div><div class="form-field"><label>${t('farms.soil')}<input name="soilType" value="${esc(zone.soilType || state.dashboard?.farm.soilType || '')}" maxlength="80" required></label></div><div class="form-field"><label>${t('farms.waterAvailability')}<input name="waterAvailability" value="${esc(zone.waterAvailability || '')}" maxlength="60" required></label></div><div class="form-field"><label>${t('farms.currentCrop')}<input name="currentCrop" value="${esc(zone.currentCrop || '')}" maxlength="80"></label></div><div class="form-field"><label>${t('forms.growthStage')}<select name="growthStage">${stages.map((stage) => `<option value="${esc(stage)}" ${stage === (zone.growthStage || 'Sowing') ? 'selected' : ''}>${dataLabel(stage)}</option>`).join('')}</select></label></div><div class="form-field form-wide"><label>${t('farms.sensorId')}<input name="sensorId" value="${esc(zone.sensorId || '')}" maxlength="64"></label></div><div class="form-wide"><button class="btn" type="submit">${t('common.save')}</button></div></form>`;
}

function seasonForm(record = {}) {
  const expenses = record.expenses || {};
  const expenseKeys = ['seeds','fertilizer','pesticide','labour','irrigation','machinery','transport','other'];
  return `<form id="season-form"><div class="form-grid"><div class="form-field"><label>${t('recommendations.crop')}<input name="crop" value="${esc(record.crop || '')}" maxlength="80" required></label></div><div class="form-field"><label>${t('history.variety')}<input name="variety" value="${esc(record.variety || '')}" maxlength="80"></label></div><div class="form-field"><label>${t('history.season')}<select name="season">${['Kharif','Rabi','Zaid','Summer','Annual'].map((season) => `<option ${record.season === season ? 'selected' : ''}>${season}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('history.year')}<input name="year" type="number" min="1990" max="2100" value="${esc(record.year || new Date().getFullYear())}" required></label></div><div class="form-field"><label>${t('farms.area')}<input name="areaAcres" type="number" min="0.01" step="any" value="${esc(record.areaAcres || state.dashboard?.farm.areaAcres || '')}" required></label></div><div class="form-field"><label>${t('memory.yield')} (q)<input name="yieldQuintal" type="number" min="0" step="any" value="${esc(record.yieldQuintal ?? '')}" required></label></div><div class="form-field"><label>${t('history.price')} / q<input name="sellingPricePerQuintal" type="number" min="0" step="any" value="${esc(record.sellingPricePerQuintal ?? '')}" required></label></div><div class="form-field"><label>${t('history.planted')}<input name="plantedDate" type="date" value="${esc(record.plantedDate || '')}"></label></div><div class="form-field"><label>${t('history.harvested')}<input name="harvestedDate" type="date" value="${esc(record.harvestedDate || '')}"></label></div></div><h3 class="section-gap">${t('profit.actualExpenses')}</h3><div class="form-grid">${expenseKeys.map((key) => `<div class="form-field"><label>${dataLabel(key)}<input name="expense-${key}" type="number" min="0" step="any" value="${esc(expenses[key] ?? 0)}"></label></div>`).join('')}</div><div class="notice form-notice">${t('history.recordNote')}</div><button class="btn" type="submit">${t('common.save')}</button></form>`;
}

function openForm(titleKey, endpoint, body, recordId = null) {
  const dialog = $('#action-dialog');
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(titleKey)}</h2>${body}`;
  dialog.showModal();
  $('#modal-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...raw,
      farmId: state.farmId,
      quantity: Number(raw.quantity || 0),
      value: Number(raw.value || 0),
      soilMoisturePct: Number(raw.soilMoisturePct || 0),
      temperatureC: Number(raw.temperatureC || 0),
      humidityPct: Number(raw.humidityPct || 0),
      waterLevelPct: raw.waterLevelPct === '' || raw.waterLevelPct == null ? null : Number(raw.waterLevelPct || 0),
      source: 'FARMER_ENTERED'
    };
    try {
      await api(recordId ? `${endpoint}/${encodeURIComponent(recordId)}` : endpoint, { method:recordId ? 'PUT' : 'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

function openFarmForm(farm = null) {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(farm ? 'farms.editFarm' : 'farms.addFarm')}</h2>${farmForm(farm || {})}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('#farm-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.areaAcres = Number(payload.areaAcres);
    payload.availableWaterLitres = Number(payload.availableWaterLitres);
    try {
      const saved = await api(farm ? `/api/farms/${encodeURIComponent(farm.id)}` : '/api/farms', { method:farm ? 'PUT' : 'POST', body:JSON.stringify(payload) });
      if (!farm) state.farmId = saved.id;
      dialog.close();
      await loadDashboard();
      location.hash = '#farms';
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

function openZoneForm(zone = null) {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(zone ? 'farms.editZone' : 'farms.addZone')}</h2>${zoneForm(zone || {})}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('#zone-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    payload.farmId = state.farmId;
    payload.areaAcres = Number(payload.areaAcres);
    if (!payload.currentCrop) delete payload.currentCrop;
    if (!payload.sensorId) delete payload.sensorId;
    try {
      await api(zone ? `/api/zones/${encodeURIComponent(zone.id)}` : '/api/zones', { method:zone ? 'PUT' : 'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      location.hash = '#farms';
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

function openSeasonForm(record = null) {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(record ? 'history.editSeason' : 'history.addSeason')}</h2>${seasonForm(record || {})}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('#season-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const expenses = Object.fromEntries(Object.entries(raw).filter(([key]) => key.startsWith('expense-')).map(([key, value]) => [key.slice(8), Number(value || 0)]));
    const payload = {
      farmId: state.farmId, crop: raw.crop, variety: raw.variety, season: raw.season, year: Number(raw.year),
      areaAcres: Number(raw.areaAcres), yieldQuintal: Number(raw.yieldQuintal),
      sellingPricePerQuintal: Number(raw.sellingPricePerQuintal), plantedDate: raw.plantedDate || null,
      harvestedDate: raw.harvestedDate || null, expenses
    };
    try {
      await api(record ? `/api/harvests/${encodeURIComponent(record.id)}` : '/api/harvests', { method:record ? 'PUT' : 'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

async function loadMarket() {
  try {
    const [market, schemes] = await Promise.all([api('/api/market'), api('/api/schemes')]);
    state.market = market;
    $('#market-table').innerHTML = market.listings.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('market.crop')}</th><th>${t('market.market')}</th><th>${t('market.price')}</th><th>${t('market.updated')}</th></tr></thead><tbody>${market.listings.map((item) => `<tr><td><b>${esc(item.crop)}</b></td><td>${esc(item.market)}</td><td>${money(item.pricePerQuintal)} / q</td><td>${date(item.updatedAt)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('market.noListings')}</div>`;
    $('#scheme-list').innerHTML = `${schemes.schemes.map((scheme) => `<div class="action-item"><div class="action-mark">↗</div><div><b>${esc(scheme.name)}</b><p>${esc(scheme.description)}</p><a class="admin-link" href="${esc(scheme.officialUrl)}" target="_blank" rel="noreferrer">${t('market.official')} ↗</a><div class="metric-sub">${sourceBadge(scheme.source)}</div></div></div>`).join('')}<div class="notice">${t('market.schemeNote')}</div>`;
  } catch (error) {
    toast(translateError(error));
  }
}

async function loadDashboard() {
  if (!state.token) {
    renderAuth();
    return;
  }
  try {
    const farms = await api('/api/farms');
    state.farms = farms;
    const savedFarm = localStorage.getItem('agcro-active-farm');
    if (state.farmId && !farms.some((farm) => farm.id === state.farmId)) state.farmId = null;
    if ((!state.farmId || !farms.some((farm) => farm.id === state.farmId)) && savedFarm && farms.some((farm) => farm.id === savedFarm)) state.farmId = savedFarm;
    if ((!state.farmId || !farms.some((farm) => farm.id === state.farmId)) && farms.length) state.farmId = farms[0].id;
    $('#farm-select').innerHTML = farms.map((farm) => `<option value="${esc(farm.id)}" ${farm.id === state.farmId ? 'selected' : ''}>${esc(farm.name)}</option>`).join('');
    if (!state.farmId) {
      state.dashboard = null;
      $('#farm-select').innerHTML = '';
      $('#farm-location').innerHTML = `<span aria-hidden="true">⌖</span><span>${t('history.unavailable')}</span>`;
      if (!location.hash || location.hash === '#dashboard') location.hash = '#farms';
      await renderRoute();
      return;
    }
    localStorage.setItem('agcro-active-farm', state.farmId);
    state.dashboard = await api(`/api/dashboard?farmId=${encodeURIComponent(state.farmId)}`);
    updateStaticCopy();
    updateNotificationDot();
    setUpdated();
    await renderRoute();
  } catch (error) {
    if (error.code === 'unauthorized') {
      renderAuth();
      return;
    }
    app.innerHTML = `<div class="card"><h2>${t('errors.load')}</h2><p class="card-description">${esc(translateError(error))}</p><button class="btn" id="retry-load">${t('common.retry')}</button></div>`;
    $('#retry-load')?.addEventListener('click', loadDashboard);
  }
}

function updateNotificationDot() {
  const count = state.dashboard?.alerts?.length || 0;
  $('#notification-dot').hidden = count === 0;
}

async function loadNotifications() {
  try {
    state.notifications = await api('/api/alerts?includeAcknowledged=true');
    if (state.route === 'notifications') {
      app.innerHTML = renderNotifications();
      wire();
    }
  } catch (error) {
    toast(translateError(error));
  }
}

function wire() {
  $('[data-action="add-farm"]')?.addEventListener('click', () => openFarmForm());
  $('[data-action="add-zone"]')?.addEventListener('click', () => openZoneForm());
  $('[data-action="add-season"]')?.addEventListener('click', () => openSeasonForm());
  $('[data-action="log-activity"]')?.addEventListener('click', () => openForm('forms.activityTitle', '/api/activities', activityForm()));
  $('[data-action="add-soil"]')?.addEventListener('click', () => openForm('forms.soilTitle', '/api/soil-tests', soilForm()));
  $('[data-action="add-reading"]')?.addEventListener('click', () => openForm('forms.readingTitle', '/api/sensor-readings', readingForm()));
  $('[data-action="refresh-notifications"]')?.addEventListener('click', loadNotifications);
  $('[data-action="ask-ai"]')?.addEventListener('click', () => { location.hash = '#assistant'; setTimeout(() => $('#chat-input')?.focus(), 100); });
  document.querySelectorAll('[data-select-farm]').forEach((button) => button.addEventListener('click', async () => {
    state.farmId = button.dataset.selectFarm;
    localStorage.setItem('agcro-active-farm', state.farmId);
    await loadDashboard();
    location.hash = '#farms';
  }));
  document.querySelectorAll('[data-edit-farm]').forEach((button) => button.addEventListener('click', () => {
    const farm = state.farms.find((item) => item.id === button.dataset.editFarm);
    if (farm) openFarmForm(farm);
  }));
  document.querySelectorAll('[data-delete-farm]').forEach((button) => button.addEventListener('click', async () => {
    const farm = state.farms.find((item) => item.id === button.dataset.deleteFarm);
    if (!farm || !window.confirm(t('farms.deleteConfirm', { name:farm.name }))) return;
    try {
      await api(`/api/farms/${encodeURIComponent(farm.id)}`, { method:'DELETE' });
      if (state.farmId === farm.id) state.farmId = null;
      await loadDashboard();
      location.hash = '#farms';
      toast(t('farms.deleted'));
    } catch (error) {
      toast(translateError(error));
    }
  }));
  document.querySelectorAll('[data-edit-zone]').forEach((button) => button.addEventListener('click', () => {
    const zone = state.dashboard?.zones.find((item) => item.id === button.dataset.editZone);
    if (zone) openZoneForm(zone);
  }));
  document.querySelectorAll('[data-delete-zone]').forEach((button) => button.addEventListener('click', async () => {
    const zone = state.dashboard?.zones.find((item) => item.id === button.dataset.deleteZone);
    if (!zone || !window.confirm(t('farms.deleteZoneConfirm', { name:zone.name }))) return;
    try {
      await api(`/api/zones/${encodeURIComponent(zone.id)}`, { method:'DELETE' });
      await loadDashboard();
      location.hash = '#farms';
      toast(t('farms.deleted'));
    } catch (error) {
      toast(translateError(error));
    }
  }));
  document.querySelectorAll('[data-edit-season]').forEach((button) => button.addEventListener('click', () => {
    const record = state.dashboard?.seasons.find((item) => item.id === button.dataset.editSeason);
    if (record) openSeasonForm(record);
  }));
  document.querySelectorAll('[data-edit-activity]').forEach((button) => button.addEventListener('click', () => {
    const record = state.dashboard?.activities.find((item) => item.id === button.dataset.editActivity);
    if (record) openForm('forms.activityTitle', '/api/activities', activityForm(record), record.id);
  }));
  document.querySelectorAll('[data-edit-soil]').forEach((button) => button.addEventListener('click', () => {
    const record = state.dashboard?.soilTests.find((item) => item.id === button.dataset.editSoil);
    if (record) openForm('forms.soilTitle', '/api/soil-tests', soilForm(record), record.id);
  }));
  $('#profile-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api('/api/auth/profile', { method:'PUT', body:JSON.stringify(payload) });
      state.user = { ...state.user, ...result.user };
      toast(t('profile.saved'));
      await renderRoute();
    } catch (error) {
      toast(translateError(error));
    }
  });
  $('#profile-logout-btn')?.addEventListener('click', async () => {
    let logoutError;
    try {
      await api('/api/auth/logout', { method:'POST' });
    } catch (error) {
      logoutError = error;
    }
    state.token = null;
    state.user = null;
    state.farmId = null;
    state.farms = [];
    state.dashboard = null;
    state.chat = [];
    state.notifications = [];
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem('agcro-active-farm');
    toast(logoutError ? translateError(logoutError) : t('auth.logout'));
    renderAuth();
  });
  $('[data-action="explain-today"]')?.addEventListener('click', async () => {
    location.hash = '#assistant';
    try {
      const answer = await api('/api/ai/explain', {
        method:'POST',
        body:JSON.stringify({
          farmId: state.farmId,
          question: state.lang === 'mr' ? 'आज माझ्या शेतासाठी काय करणे आवश्यक आहे?' : 'What should I do today?',
          language: state.lang
        })
      });
      state.chat.push({ role:'assistant', text:answer.answer });
      await renderRoute();
      toast(t('assistant.explainToday'));
    } catch (error) {
      toast(translateError(error));
    }
  });

  $('[data-action="export"]')?.addEventListener('click', async () => {
    try {
      const response = await fetch(`/api/export?farmId=${encodeURIComponent(state.farmId)}`, {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      if (!response.ok) throw new Error('Export request failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `agcro-${state.farmId}-report.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(translateError(err));
    }
  });

  $('[data-action="refresh"]')?.addEventListener('click', () => loadDashboard().then(() => toast(t('common.refresh'))));
  document.querySelectorAll('[data-route-action]').forEach((button) => button.addEventListener('click', () => {
    location.hash = `#${button.dataset.routeAction}`;
    $('#sidebar')?.classList.remove('open');
  }));
  document.querySelectorAll('[data-ack]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/alerts/${button.dataset.ack}/acknowledge`, { method:'POST' });
      await loadDashboard();
      toast(t('common.review'));
    } catch (error) {
      toast(translateError(error));
    }
  }));
  document.querySelectorAll('[data-rec-explain]').forEach((button) => button.addEventListener('click', async () => {
    try {
      const answer = await api('/api/ai/explain', {
        method:'POST',
        body:JSON.stringify({
          farmId: state.farmId,
          question: `Explain the ${button.dataset.recExplain} recommendation`,
          language: state.lang
        })
      });
      openForm('assistant.fallback', '/api/none', `<p>${esc(answer.answer)}</p><div class="notice form-notice">${esc(answer.label)}. ${esc(answer.guardrail)}</div>`);
    } catch (error) {
      toast(translateError(error));
    }
  }));
  document.querySelectorAll('[data-rec-decision]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await api(`/api/recommendations/${encodeURIComponent(button.dataset.recDecision)}/decision`, {
        method:'POST',
        body:JSON.stringify({ farmId:state.farmId, status:button.dataset.status })
      });
      toast(button.dataset.status === 'accepted' ? t('recommendations.accept') : t('recommendations.reject'));
      await loadDashboard();
    } catch (error) {
      toast(translateError(error));
    }
  }));
  $('#chat-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('#chat-input');
    const message = input.value.trim();
    if (!message) return;
    state.chat.push({ role:'user', text:message });
    input.value = '';
    await renderRoute();
    try {
      const answer = await api('/api/ai/chat', {
        method:'POST',
        body:JSON.stringify({ farmId:state.farmId, message, language:state.lang })
      });
      state.chat.push({ role:'assistant', text:answer.answer });
      await renderRoute();
    } catch (error) {
      toast(translateError(error));
    }
  });
  document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => {
    const input = $('#chat-input');
    if (input) {
      input.value = button.dataset.question;
      input.focus();
    }
  }));
}

$('#farm-select').addEventListener('change', async (event) => {
  state.farmId = event.target.value;
  localStorage.setItem('agcro-active-farm', state.farmId);
  await loadDashboard();
});
$('#menu-button').addEventListener('click', (event) => {
  const isOpen = $('#sidebar').classList.toggle('open');
  event.currentTarget.setAttribute('aria-expanded', String(isOpen));
});
$('#primary-nav').addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    $('#sidebar').classList.remove('open');
    $('#menu-button').setAttribute('aria-expanded', 'false');
  }
});
$('#notification-button').addEventListener('click', () => {
  location.hash = '#notifications';
});

$('#profile-button').addEventListener('click', () => {
  if (!state.token) {
    renderAuth();
    return;
  }
  location.hash = '#profile';
});

$('#dialog-close').addEventListener('click', () => $('#action-dialog').close());
$$('.language-button').forEach((button) => button.addEventListener('click', () => switchLanguage(button.dataset.language)));
window.addEventListener('hashchange', () => state.dashboard && renderRoute());

(async function init() {
  try {
    await loadLocale(initialLanguage());
    if (state.token) {
      try {
        const me = await api('/api/auth/me');
        state.user = me.user;
        updateStaticCopy();
      } catch {
        state.token = null;
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    if (!state.token) {
      renderAuth();
    } else {
      await loadDashboard();
    }
  } catch (error) {
    app.innerHTML = `<div class="card"><h2>${t('errors.load')}</h2><p>${esc(error.message)}</p></div>`;
  }
})();
