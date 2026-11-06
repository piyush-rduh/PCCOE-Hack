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
  memoryFilters: {},
  token: localStorage.getItem(TOKEN_KEY) || null,
  user: null
};
const LOCALE_KEY = 'agcro-language';
const localeTag = () => ({ mr:'mr-IN', hi:'hi-IN' }[state.lang] || 'en-IN');
const esc = (value) => String(value ?? '').replace(/[&<>"'/`]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '/': '&#x2F;', '`': '&#x60;' }[char]));
const numberOrNull = (value) => value == null || String(value).trim() === '' ? null : Number(value);
const number = (value) => value == null ? '—' : Number(value).toLocaleString(localeTag(), { maximumFractionDigits: 0 });
const measurement = (value) => value == null ? '—' : Number(value).toLocaleString(localeTag(), { maximumFractionDigits: 6 });
const money = (value) => value == null ? '—' : new Intl.NumberFormat(localeTag(), { style:'currency', currency:'INR', maximumFractionDigits:0 }).format(Number(value));
const litres = (value) => `${number(value)} ${state.lang === 'mr' ? 'लिटर' : 'L'}`;
const confidenceLabel = (value) => {
  const level = typeof value === 'string' ? value : value?.level;
  return dataLabel(level ? level[0].toUpperCase() + level.slice(1) : 'Low');
};
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
function localizedDataText(value) {
  const translated = getPath(state.locale || {}, `data.${value}`);
  return typeof translated === 'string' ? translated : value;
}
function engineMessage(message) {
  const template = getPath(state.locale || {}, `engineMessages.${message?.code}`);
  if (typeof template !== 'string') return t('engine.messageUnavailable');
  const params = message?.params || {};
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (value == null) return '';
    return ['parameter', 'source'].includes(name) ? esc(localizedDataText(value)) : esc(value);
  });
}
function engineMessageList(messages, fallback = []) {
  return Array.isArray(messages) && messages.length
    ? messages.map(engineMessage)
    : fallback.map((value) => esc(value));
}
function sourceBadge(source) {
  const map = { LIVE_SENSOR:['common.liveSensor','live'], EXTERNAL_API:['common.externalApi','external'], FARMER_ENTERED:['common.farmerEntered','farmer'], SIMULATED_SENSOR:['common.simulated','demo'], SIMULATED_WEATHER:['common.simulated','demo'], DEMO_MARKET_DATA:['common.simulated','demo'], SIMULATED_DEMO_DATA:['engine.demoSimulation','demo'], DECISION_ENGINE:['common.decisionEngine','engine'], FARMER_CONFIRMED:['common.farmerEntered','farmer'] };
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
function fieldLabel(label, input) {
  return `<label class="form-field"><span>${label}</span>${input}</label>`;
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
  const d = state.dashboard, farm = d.farm, crop = d.activeCrops[0], reading = d.latestReading, water = d.waterBudget, rec = d.recommendations.find((item) => item.available && item.crop), openAlerts = d.alerts || [], risk = d.risks?.find((item) => item.level === 'potential_concern') || d.risks?.[0];
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
  `${card(t('dashboard.important'), actions.length ? `<div class="action-list">${actions.join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('dashboard.actionsNote'), sourceBadge('DECISION_ENGINE'))}` +
  `<section class="service-section"><div class="section-title"><div><div class="eyebrow">${t('dashboard.quickAccess')}</div><h2>${t('dashboard.quickDescription')}</h2></div></div><div class="service-grid">${serviceCards}</div></section>` +
  `<div class="grid content-grid"><div class="section-stack">${card(t('recommendations.title'), rec ? `<div class="action-item"><div class="action-mark">✦</div><div class="action-copy"><b>${esc(rec.crop)}</b><p>${esc(rec.reasons[0] || t('recommendations.explanation'))}</p></div></div>` : `<div class="empty-state">${t('engine.recommendationsUnavailable')}</div>`, t('recommendations.notice'), sourceBadge('DECISION_ENGINE'))}</div><div class="section-stack">${card(t('dashboard.important'), openAlerts.length ? `<div class="alert-list">${openAlerts.slice(0,4).map(alertMarkup).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('dashboard.actionsNote'), sourceBadge('DECISION_ENGINE'))}${card(t('memory.seasonHistory'), crop ? `<div class="inline-between"><div><h3>${esc(crop.crop)}</h3><div class="metric-sub">${esc(crop.variety)} · ${dataLabel(crop.growthStage)} · ${dataLabel(crop.status)}</div></div>${sourceBadge(crop.source)}</div><div class="balance"><div class="balance-fill" style="width:${Math.min(100, Math.max(8, ['Sowing','Vegetative','Flowering','Grain filling','Maturity','Harvested'].indexOf(crop.growthStage) / 5 * 100))}%"></div></div><div class="balance-labels"><span>${date(crop.planted)}</span><span>${date(crop.expectedHarvest)}</span></div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('recommendations.explanation'))}</div></div>`;
}

function renderMemoryLegacy() {
  const d = state.dashboard, land = d.landPower;
  const records = d.profit.records;
  const seasonRows = records.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.seasons')}</th><th>${t('recommendations.crop')}</th><th>${t('history.planted')}</th><th>${t('history.harvested')}</th><th>${t('memory.yield')}</th><th>${t('memory.revenue')}</th><th>${t('memory.profit')}</th><th>${t('common.source')}</th><th></th></tr></thead><tbody>${records.map((record) => {
    const incomplete = [record.season, record.year, record.yieldQuintal, record.sellingPricePerQuintal].some((value) => value == null);
    return `<tr><td>${record.season ? dataLabel(record.season) : t('history.unknown')} · ${record.year ?? t('history.unknown')}${incomplete ? `<div class="metric-sub">${t('history.incomplete')}</div>` : ''}</td><td><b>${esc(record.crop)}</b><div class="metric-sub">${esc(record.variety || '—')}</div></td><td>${record.plantedDate ? date(record.plantedDate) : t('history.unavailable')}</td><td>${record.harvestedDate ? date(record.harvestedDate) : t('history.unavailable')}</td><td>${record.yieldQuintal == null ? t('history.unknown') : `${number(record.yieldQuintal)} q`}</td><td>${money(record.revenue)}</td><td class="${record.profit < 0 ? 'number-negative' : 'number-positive'}">${money(record.profit)}</td><td>${sourceBadge(record.source)}</td><td><button class="btn secondary small-button" data-edit-season="${esc(record.id)}">${t('common.edit')}</button></td></tr>`;
  }).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noSeasons')}</div>`;
  const activityItems = d.activities.length ? `<div class="action-list">${d.activities.slice().reverse().map((item) => `<div class="action-item"><div class="action-mark">•</div><div class="action-copy"><div class="inline-between"><b>${esc(item.type)} · ${date(item.date)}</b><button class="btn secondary small-button" data-edit-activity="${esc(item.id)}">${t('common.edit')}</button></div><p>${item.quantity == null ? t('history.unknown') : esc(item.quantity)} ${esc(item.unit)}${item.notes ? ` · ${esc(item.notes)}` : ''}</p>${sourceBadge(item.source)}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('memory.noActivities')}</div>`;
  const soilItems = d.soilTests.length ? `<div class="action-list">${d.soilTests.slice().reverse().map((item) => {
    const warnings = [];
    if (item.value == null) warnings.push(t('forms.measurementMissing'));
    if (item.parameter !== 'pH' && !item.unit) warnings.push(t('forms.unitMissing'));
    if (!item.method) warnings.push(t('forms.methodMissing'));
    if ((item.parameter === 'EC' && item.unit && item.unit !== 'dS/m')
      || (item.parameter === 'Organic carbon' && item.unit && item.unit !== '%')) warnings.push(t('forms.measurementUnsupported'));
    return `<div class="action-item"><div class="action-mark">${esc(item.parameter)}</div><div class="action-copy"><div class="inline-between"><b>${esc(item.parameter)}: ${item.value == null ? t('history.unknown') : `${measurement(item.value)} ${esc(item.unit || '')}`}</b><button class="btn secondary small-button" data-edit-soil="${esc(item.id)}">${t('common.edit')}</button></div><p>${t('forms.zone')}: ${esc(d.zones.find((zone) => zone.id === item.zoneId)?.name || t('history.unavailable'))} · ${date(item.date)} · ${t('forms.method')}: ${esc(item.method || t('history.unknown'))}</p>${warnings.length ? `<p class="notice form-notice">${warnings.join(' · ')}</p>` : ''}${sourceBadge(item.source)}</div></div>`;
  }).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`;
  const soilTrendRows = land.historicalChanges?.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.trendParameter')}</th><th>${t('forms.date')}</th><th>${t('forms.value')}</th><th>${t('common.source')}</th></tr></thead><tbody>${land.historicalChanges.flatMap((parameterSeries) => (parameterSeries.observations || []).map((observation) => `<tr><td>${esc(parameterSeries.parameter || t('history.unknown'))}</td><td>${date(observation.date)}</td><td>${observation.value == null ? t('history.unknown') : `${measurement(observation.value)} ${esc(observation.unit || '')}`}</td><td>${sourceBadge(observation.source || 'UNKNOWN')}</td></tr>`)).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noSoilTrend')}</div>`;
  const waterUseRows = d.waterUseEvents?.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.waterUse')}</th><th>${t('forms.date')}</th><th>${t('monitor.allocation')}</th><th>${t('forms.zone')}</th><th>${t('common.source')}</th></tr></thead><tbody>${d.waterUseEvents.slice().reverse().map((event) => `<tr><td>${esc(event.applicationMethod || event.type || t('memory.waterUse'))}</td><td>${dateTime(event.eventDateTime || event.date)}</td><td>${event.waterQuantity == null ? t('history.unknown') : `${number(event.waterQuantity)} ${esc(event.quantityUnit || 'L')}`}</td><td>${esc(d.zones.find((zone) => zone.id === event.zoneId)?.name || t('history.unavailable'))}</td><td>${sourceBadge(event.source || event.recordProvenance || 'FARMER_ENTERED')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noWaterUse')}</div>`;
  const decisions = d.decisions?.length ? `<div class="action-list">${d.decisions.map((item) => `<div class="action-item"><div class="action-mark">✓</div><div><b>${esc(item.crop || item.category)}</b><p>${dataLabel(item.status)} · ${dateTime(item.createdAt)}</p>${sourceBadge(item.source)}</div></div>`).join('')}</div>` : `<div class="empty-state">${t('recommendations.noDecisions')}</div>`;
  return pageHeading(t('memory.eyebrow'), t('memory.title'), t('memory.description'), `<button class="btn" data-action="add-season">${t('history.addSeason')}</button><button class="btn secondary" data-action="log-activity">${t('memory.addActivity')}</button><button class="btn secondary" data-action="add-soil">${t('memory.addSoil')}</button>`) +
  `<div class="grid metric-grid">${metric(t('memory.seasons'), d.seasons.length, d.seasons.length ? `${esc(d.seasons.at(-1).crop)} · ${d.seasons.at(-1).year}` : t('memory.noSeasons'))}${metric(t('memory.soilParameters'), new Set(d.soilTests.map((x) => x.parameter)).size, `${land.missing.length} ${t('memory.missing')}`)}${metric(t('memory.zones'), d.zones.length, `${number(d.zones.reduce((a,z)=>a+Number(z.areaAcres||0),0))} ac`)}${metric(t('memory.activities'), d.activities.length, t('common.farmerRecord'))}</div>` +
  `<div class="grid content-grid"><div class="section-stack">${card(t('memory.seasonHistory'), seasonRows, t('profit.formula'))}${card(t('memory.recent'), activityItems)}${card(t('history.soilHistory'), soilItems)}${card(t('memory.soilTrend'), soilTrendRows)}${card(t('memory.waterHistory'), waterUseRows)}${card(t('recommendations.decisionHistory'), decisions)}</div><div class="section-stack">${card(t('memory.landExplanation'), `<div class="inline-between"><div class="metric-value">${land.score}</div>${sourceBadge('DECISION_ENGINE')}</div><p class="card-description">${dataLabel(land.confidence)} ${t('common.confidence')}. ${t('memory.missingHint')}</p><div class="mini-bars">${(land.historicalChanges?.length ? land.historicalChanges.slice(0, 5) : [{parameter:'—', observations:[{date:null, value:land.score}]}]).map((point) => `<div class="mini-bar" style="height:${Math.max(8, Number((point.observations?.at(-1)?.value ?? land.score) || 0))}%"><span>${esc(point.parameter || '—')}</span></div>`).join('')}</div><div class="explanation-list"><h3>${t('memory.strengths')}</h3><ul class="card-description">${(land.strengths.length ? land.strengths : [t('memory.noStrengths')]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h3>${t('memory.limitations')}</h3><ul class="card-description">${(land.limitations.length ? land.limitations : [t('memory.noLimitations')]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`, t('common.notStandardized'))}${card(t('memory.missing'), land.missing.length ? `<div class="tag-row">${land.missing.map((item) => `<span class="provenance demo">${esc(item)} ${t('memory.parametersNeeded', { parameter:'' }).trim()}</span>`).join('')}</div>` : `<div class="empty-state">${t('common.noData')}</div>`, t('memory.missingHint'))}</div></div>`;
}

function renderMemory() {
  const d = state.dashboard;
  const plans = d.cropPlans || [];
  const zones = d.zones || [];
  const zoneName = (zoneId) => zones.find((zone) => zone.id === zoneId)?.name || t('history.unavailable');
  const filters = state.memoryFilters || {};
  const events = [
    ...(d.seasons || []).map((item) => ({
      type:'crop_history', date:item.harvestedDate || item.plantedDate || item.createdAt,
      zoneId:item.zoneId, title:item.crop, detail:`${item.season || t('history.unknown')} · ${item.year ?? t('history.unknown')} · ${item.yieldQuintal == null ? t('history.unknown') : `${number(item.yieldQuintal)} q`}`,
      source:item.source, id:item.id
    })),
    ...plans.map((item) => ({
      type:'crop_plan', date:item.sowingDate || item.createdAt, zoneId:item.zoneId,
      title:item.crop, detail:`${item.status} · ${item.currentGrowthStage || t('history.unknown')} · ${item.cultivatedArea == null ? t('history.unknown') : `${number(item.cultivatedArea)} ${item.areaUnit}`}`,
      source:item.recordSource || item.source, id:item.id
    })),
    ...(d.soilTests || []).map((item) => ({
      type:'soil_test', date:item.date, zoneId:item.zoneId, title:item.parameter,
      detail:`${item.value == null ? t('history.unknown') : `${measurement(item.value)} ${item.unit || ''}`} · ${item.method || t('history.unknown')}`,
      source:item.source, id:item.id
    })),
    ...(d.activities || []).map((item) => ({
      type:'activity', date:item.date, zoneId:item.zoneId, title:item.type,
      detail:[item.quantity == null ? t('history.unknown') : `${item.quantity} ${item.unit || ''}`, item.notes].filter(Boolean).join(' · '),
      source:item.source, id:item.id
    })),
    ...(d.waterUseEvents || []).map((item) => ({
      type:'water_use', date:item.eventDateTime, zoneId:item.zoneId, title:item.applicationMethod,
      detail:`${item.waterQuantity == null ? t('history.unknown') : `${number(item.waterQuantity)} ${item.quantityUnit}`} · ${item.sourceOfMeasurement}`,
      source:item.recordProvenance, id:item.id
    })),
    ...(d.effectiveRainfall || []).map((item) => ({
      type:'effective_rainfall', date:item.observationDate, zoneId:item.zoneId, title:t('memory.effectiveRainfall'),
      detail:`${number(item.amount)} mm · ${item.method}`, source:item.source, id:item.id
    })),
    ...(d.planningPeriods || []).map((item) => ({
      type:'planning_period', date:item.startDate, zoneId:item.zoneId, title:t('memory.planningPeriod'),
      detail:`${date(item.startDate)} – ${date(item.endDate)} · ${item.durationDays} ${t('memory.days')}`,
      source:t('common.farmerEntered'), id:item.id
    })),
    ...(d.financialScenarios || []).map((item) => ({
      type:'financial_scenario', date:item.createdAt, zoneId:item.zoneId, title:`${item.crop} · ${item.scenario}`,
      detail:`${item.expectedYieldQuintal == null ? t('history.unknown') : `${number(item.expectedYieldQuintal)} q`} · ${item.pricePerQuintal == null ? t('history.unknown') : money(item.pricePerQuintal)} / q`,
      source:item.source, id:item.id
    }))
  ].filter((item) => item.date)
    .filter((item) => !filters.type || item.type === filters.type)
    .filter((item) => !filters.zoneId || item.zoneId === filters.zoneId)
    .filter((item) => !filters.dateFrom || String(item.date).slice(0, 10) >= filters.dateFrom)
    .filter((item) => !filters.dateTo || String(item.date).slice(0, 10) <= filters.dateTo)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const eventTypeLabel = (type) => ({
    crop_history:t('memory.seasons'), crop_plan:t('memory.cropPlans'), soil_test:t('history.soilHistory'),
    activity:t('memory.activities'), water_use:t('memory.waterUse'), effective_rainfall:t('memory.effectiveRainfall'),
    planning_period:t('memory.planningPeriod'), financial_scenario:t('memory.financialScenarios')
  }[type] || type);
  const timeline = events.length
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('forms.date')}</th><th>${t('memory.eventType')}</th><th>${t('memory.event')}</th><th>${t('forms.zone')}</th><th>${t('common.source')}</th></tr></thead><tbody>${events.map((item) => `<tr><td>${dateTime(item.date)}</td><td>${esc(eventTypeLabel(item.type))}</td><td><b>${esc(item.title)}</b><div class="metric-sub">${esc(item.detail)}</div></td><td>${esc(zoneName(item.zoneId))}</td><td>${sourceBadge(item.source || 'UNKNOWN')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-state">${t('memory.noTimeline')}</div>`;
  const planRows = plans.length
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('recommendations.crop')}</th><th>${t('forms.zone')}</th><th>${t('history.season')}</th><th>${t('history.planted')}</th><th>${t('memory.expectedHarvest')}</th><th>${t('forms.growthStage')}</th><th>${t('memory.area')}</th><th>${t('common.status')}</th><th></th></tr></thead><tbody>${plans.map((item) => {
      const missing = [item.currentGrowthStage, item.season, item.agriculturalYear, item.sowingDate, item.expectedHarvestDate].filter((value) => value == null || value === '').length;
      return `<tr><td><b>${esc(item.crop)}</b><div class="metric-sub">${esc(item.variety || t('history.unknown'))}</div></td><td>${esc(zoneName(item.zoneId))}</td><td>${item.season ? dataLabel(item.season) : t('history.unknown')} · ${item.agriculturalYear ?? t('history.unknown')}</td><td>${date(item.sowingDate)}</td><td>${date(item.actualHarvestDate || item.expectedHarvestDate)}</td><td>${item.currentGrowthStage ? dataLabel(item.currentGrowthStage) : t('history.unknown')}</td><td>${number(item.cultivatedArea)} ${esc(item.areaUnit)}</td><td>${dataLabel(item.status)}${missing ? `<div class="metric-sub">${t('memory.missingFields', { count:missing })}</div>` : ''}</td><td><button class="btn secondary small-button" data-edit-crop-plan="${esc(item.id)}">${t('common.edit')}</button></td></tr>`;
    }).join('')}</tbody></table></div>`
    : `<div class="empty-state">${t('memory.noPlans')}</div>`;
  const soilRows = (d.soilTests || []).length
    ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.trendParameter')}</th><th>${t('forms.date')}</th><th>${t('forms.value')}</th><th>${t('forms.method')}</th><th>${t('common.source')}</th></tr></thead><tbody>${d.soilTests.slice().sort((a,b) => String(b.date).localeCompare(String(a.date))).map((item) => `<tr><td>${esc(item.parameter)}</td><td>${date(item.date)}</td><td>${item.value == null ? t('history.unknown') : `${measurement(item.value)} ${esc(item.unit || '')}`}</td><td>${esc(item.method || t('history.unknown'))}</td><td>${sourceBadge(item.source || 'UNKNOWN')}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty-state">${t('memory.noSoilTrend')}</div>`;
  const waterRows = (d.waterAvailability || []).map((item) => `<tr><td>${date(item.measurementDate)}</td><td>${dataLabel(item.waterType)}</td><td>${number(item.availableWaterLitres)} ${esc(item.unit)}</td><td>${esc(item.validityPeriod || t('history.unknown'))}</td><td>${sourceBadge(item.provenance || 'UNKNOWN')}</td></tr>`).join('');
  const useRows = (d.waterUseEvents || []).map((item) => `<tr><td>${dateTime(item.eventDateTime)}</td><td>${esc(zoneName(item.zoneId))}</td><td>${number(item.waterQuantity)} ${esc(item.quantityUnit)}</td><td>${esc(item.applicationMethod)}</td><td>${esc(item.sourceOfMeasurement)}</td><td>${sourceBadge(item.recordProvenance || 'UNKNOWN')}</td></tr>`).join('');
  const scenarios = (d.financialScenarios || []).map((item) => {
    const calculation = d.profit.future.scenarios.find((scenario) => scenario.recordId === item.id);
    return `<tr><td>${esc(item.crop)}</td><td>${dataLabel(item.scenario)}</td><td>${item.expectedYieldQuintal == null ? t('history.unknown') : `${number(item.expectedYieldQuintal)} q`}</td><td>${item.pricePerQuintal == null ? t('history.unknown') : `${money(item.pricePerQuintal)} / q`}</td><td>${item.expensesComplete && calculation ? money(calculation.profit) : t('memory.notCalculated')}</td><td>${sourceBadge(item.source)}</td><td><button class="btn secondary small-button" data-edit-financial-scenario="${esc(item.id)}">${t('common.edit')}</button></td></tr>`;
  }).join('');
  const records = d.profit.actual.dataType === 'recorded_history' ? (d.profit.records || []) : [];
  const financialRows = records.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('recommendations.crop')}</th><th>${t('history.season')}</th><th>${t('memory.yield')}</th><th>${t('memory.revenue')}</th><th>${t('memory.profit')}</th><th>${t('common.source')}</th></tr></thead><tbody>${records.map((record) => `<tr><td>${esc(record.crop)}</td><td>${record.season ? dataLabel(record.season) : t('history.unknown')} · ${record.year ?? t('history.unknown')}</td><td>${record.yieldQuintal == null ? t('history.unknown') : `${number(record.yieldQuintal)} q`}</td><td>${money(record.revenue)}</td><td>${money(record.profit)}</td><td>${sourceBadge(record.source || 'FARMER_ENTERED')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noActualFinances')}</div>`;
  const demoRecords = d.profit.demonstration?.records || [];
  const demoRows = demoRecords.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('recommendations.crop')}</th><th>${t('history.season')}</th><th>${t('memory.yield')}</th><th>${t('memory.revenue')}</th><th>${t('memory.profit')}</th><th>${t('common.source')}</th></tr></thead><tbody>${demoRecords.map((record) => `<tr><td>${esc(record.crop)}</td><td>${record.season || t('history.unknown')} · ${record.year ?? t('history.unknown')}</td><td>${record.yieldQuintal == null ? t('history.unknown') : `${number(record.yieldQuintal)} q`}</td><td>${money(record.revenue)}</td><td>${money(record.profit)}</td><td>${sourceBadge('SIMULATED_WEATHER')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noDemoFinances')}</div>`;
  const completeness = d.decisionEngine?.missingInputs || [];
  const actions = `<button class="btn" data-action="add-crop-plan">${t('memory.addCropPlan')}</button><button class="btn secondary" data-action="add-planning-period">${t('memory.addPlanningPeriod')}</button><button class="btn secondary" data-action="add-effective-rainfall">${t('memory.addEffectiveRainfall')}</button><button class="btn secondary" data-action="add-water-availability">${t('memory.addWaterAvailability')}</button><button class="btn secondary" data-action="add-season">${t('history.addSeason')}</button><button class="btn secondary" data-action="log-activity">${t('memory.addActivity')}</button><button class="btn secondary" data-action="add-soil">${t('memory.addSoil')}</button><button class="btn secondary" data-action="add-water-use">${t('memory.addWaterUse')}</button><button class="btn secondary" data-action="add-financial-scenario">${t('memory.addFinancialScenario')}</button>`;
  return pageHeading(t('memory.eyebrow'), t('memory.title'), t('memory.description'), actions)
    + `<div class="grid metric-grid">${metric(t('farms.title'), state.farms.length, t('memory.currentFarmerRecords'))}${metric(t('memory.zones'), zones.length, `${number(zones.reduce((sum, zone) => sum + Number(zone.areaAcres || 0), 0))} ac`)}${metric(t('memory.cropPlans'), plans.length, `${plans.filter((plan) => plan.status === 'completed').length} ${t('memory.completed')}`)}${metric(t('memory.soilParameters'), new Set((d.soilTests || []).map((item) => item.parameter)).size, `${(d.soilTests || []).length} ${t('memory.records')}`)}${metric(t('memory.waterUse'), (d.waterUseEvents || []).length, `${(d.waterAvailability || []).length} ${t('memory.waterAvailability')}`)}${metric(t('memory.financialRecords'), records.length + demoRecords.length, `${(d.financialScenarios || []).length} ${t('memory.financialScenarios')}`)}</div>`
    + card(t('memory.dataCompleteness'), completeness.length ? `<ul>${completeness.map((item) => `<li>${esc(dataLabel(item))}</li>`).join('')}</ul>` : `<p>${t('memory.complete')}</p>`)
    + `<form id="memory-filters" class="card admin-filter-bar">${fieldLabel(t('memory.eventType'), `<select name="type"><option value="">${t('common.all')}</option>${['crop_history','crop_plan','soil_test','activity','water_use','effective_rainfall','planning_period','financial_scenario'].map((type) => `<option value="${type}" ${filters.type === type ? 'selected' : ''}>${esc(eventTypeLabel(type))}</option>`).join('')}</select>`)}${fieldLabel(t('forms.zone'), `<select name="zoneId"><option value="">${t('common.all')}</option>${zones.map((zone) => `<option value="${esc(zone.id)}" ${filters.zoneId === zone.id ? 'selected' : ''}>${esc(zone.name)}</option>`).join('')}</select>`)}${fieldLabel(t('memory.from'), `<input type="date" name="dateFrom" value="${esc(filters.dateFrom || '')}">`)}${fieldLabel(t('memory.to'), `<input type="date" name="dateTo" value="${esc(filters.dateTo || '')}">`)}<button class="btn" type="submit">${t('common.filter')}</button><button class="btn secondary" type="button" data-action="clear-memory-filters">${t('common.clear')}</button></form>`
    + card(t('memory.timeline'), timeline)
    + card(t('memory.cropPlans'), planRows)
    + card(t('history.soilHistory'), soilRows, t('memory.soilComparableNote'))
    + card(t('memory.planningPeriod'), (d.planningPeriods || []).length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('memory.planningPeriod')}</th><th>${t('forms.zone')}</th><th>${t('memory.cropPlans')}</th><th>${t('common.status')}</th></tr></thead><tbody>${d.planningPeriods.map((item) => `<tr><td>${date(item.startDate)} – ${date(item.endDate)} · ${item.durationDays} ${t('memory.days')}</td><td>${esc(zoneName(item.zoneId))}</td><td>${esc(plans.find((plan) => plan.id === item.cropPlanId)?.crop || t('history.unknown'))}</td><td>${dataLabel(item.status)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noPlanningPeriods')}</div>`)
    + card(t('memory.effectiveRainfall'), (d.effectiveRainfall || []).length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('forms.date')}</th><th>${t('forms.zone')}</th><th>${t('memory.planningPeriod')}</th><th>${t('memory.rainAmount')}</th><th>${t('memory.method')}</th><th>${t('common.source')}</th></tr></thead><tbody>${d.effectiveRainfall.map((item) => `<tr><td>${date(item.observationDate)}</td><td>${esc(zoneName(item.zoneId))}</td><td>${esc(item.planningPeriodId)}</td><td>${number(item.amount)} mm</td><td>${esc(item.method)}</td><td>${sourceBadge(item.provenance || 'UNKNOWN')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('memory.noEffectiveRainfall')}</div>`)
    + card(t('memory.waterAvailability'), waterRows ? `<p class="card-description">${t('memory.waterInventoryNote')}</p><div class="table-scroll"><table class="data-table"><thead><tr><th>${t('forms.date')}</th><th>${t('common.status')}</th><th>${t('monitor.availableWater')}</th><th>${t('memory.validity')}</th><th>${t('common.source')}</th></tr></thead><tbody>${waterRows}</tbody></table></div>` : `<div class="empty-state">${t('common.noData')}</div>`)
    + card(t('memory.waterHistory'), useRows ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('forms.date')}</th><th>${t('forms.zone')}</th><th>${t('monitor.allocation')}</th><th>${t('memory.method')}</th><th>${t('memory.measurementSource')}</th><th>${t('common.source')}</th></tr></thead><tbody>${useRows}</tbody></table></div>` : `<div class="empty-state">${t('memory.noWaterUse')}</div>`)
    + card(t('memory.actualFinances'), financialRows, t('memory.actualFinanceNote'))
    + card(t('memory.demoFinances'), demoRows, t('memory.demoFinanceNote'))
    + card(t('memory.financialScenarios'), scenarios ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('recommendations.crop')}</th><th>${t('memory.scenario')}</th><th>${t('memory.expectedYield')}</th><th>${t('memory.expectedPrice')}</th><th>${t('memory.profit')}</th><th>${t('common.source')}</th><th></th></tr></thead><tbody>${scenarios}</tbody></table></div>` : `<div class="empty-state">${t('memory.noFinancialScenarios')}</div>`)
    + card(t('memory.landExplanation'), `<div class="inline-between"><div class="metric-value">${land.score}</div>${sourceBadge('DECISION_ENGINE')}</div><p class="card-description">${dataLabel(land.confidence)} ${t('common.confidence')}. ${t('memory.missingHint')}</p><ul>${(land.assumptions || []).map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`, t('common.notStandardized'));
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
  if (!item.available || !item.crop) {
    const categoryKey = { restoration:'restore', balanced:'balanced', profit:'profitLens' }[item.categoryKey];
    const unavailableMessage = item.messages?.[0] ? engineMessage(item.messages[0]) : t('engine.recommendationsUnavailable');
    return `<article class="recommendation"><div class="rec-top"><div class="rec-category">${t(`recommendations.${categoryKey || 'whyLenses'}`)}</div><span class="score-pill">—</span></div><h3>${t('engine.noCropRanked')}</h3><p class="card-description">${unavailableMessage}</p></article>`;
  }
  const reasonItems = engineMessageList(item.messages, item.reasons || []);
  const reasons = reasonItems.length ? reasonItems.map((reason) => `<li>${reason}</li>`).join('') : `<li>${t('history.unavailable')}</li>`;
  const risks = item.risks?.length ? `<div class="tag-row rec-risk"><span class="provenance demo">${t('recommendations.risk')}</span><span class="metric-sub">${item.risks.map(dataLabel).join(' · ')}</span></div>` : '';
  return `<article class="recommendation ${index === 1 ? 'featured' : ''}"><div class="rec-top"><div class="rec-category">${dataLabel(item.category)}</div><span class="score-pill">${item.suitabilityScore}/100</span></div><div class="crop-illustration" aria-hidden="true">${index === 0 ? '🌱' : index === 1 ? '🌾' : '🌿'}</div><h3>${esc(item.crop)}</h3><div class="variety">${esc(item.variety)} · ${dataLabel(item.season)} · ${item.waterRequirementMm} mm ${t('recommendations.waterReference')}</div><div class="rec-stats"><div class="rec-stat"><span>${t('recommendations.yieldRange')} · ${t('common.estimated')}</span><b>${item.expectedYieldRange[0]}–${item.expectedYieldRange[1]} q/ac</b></div><div class="rec-stat"><span>${t('recommendations.profitAcre')} · ${t('common.estimated')}</span><b>${money(item.estimatedProfitPerAcre)}</b></div><div class="rec-stat"><span>${t('recommendations.costAcre')} · ${t('common.estimated')}</span><b>${money(item.estimatedCostPerAcre)}</b></div><div class="rec-stat"><span>${t('common.confidence')}</span><b>${confidenceLabel(item.confidence)}</b></div></div><div class="rec-copy"><b>${t('recommendations.suitability')}</b><ul>${reasons}</ul></div>${risks}<div class="card-actions"><button class="btn" data-rec-explain="${esc(item.crop)}">${t('common.explain')}</button><button class="btn secondary" data-rec-decision="${esc(item.crop)}" data-status="accepted">${t('recommendations.accept')}</button><button class="btn secondary" data-rec-decision="${esc(item.crop)}" data-status="rejected">${t('recommendations.reject')}</button></div></article>`;
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
  `<div class="grid content-grid"><div class="section-stack">${card(t('monitor.waterBudget'), `<div class="grid split-two"><div><div class="metric-label">${t('monitor.availableWater')}</div><div class="metric-value">${litres(water.availableWaterLitres)}</div></div><div><div class="metric-label">${t('monitor.projectedNeed')}</div><div class="metric-value">${litres(water.irrigationRequirementLitres)}</div></div></div><div class="balance"><div class="balance-fill ${water.status === 'deficit' ? 'deficit' : ''}" style="width:${Math.min(100, Math.round((Math.min(water.availableWaterLitres, water.irrigationRequirementLitres) / max) * 100))}%"></div></div><div class="balance-labels"><span>${water.status === 'deficit' ? `${t('monitor.deficit')} ${litres(Math.abs(water.balanceLitres))}` : `${t('monitor.surplus')} ${litres(water.balanceLitres)}`}</span><span>${dataLabel(water.status)}</span></div><div class="grid split-two compact-grid"><div class="rec-stat"><span>${t('monitor.rainContribution')}</span><b>${litres(water.expectedRainfallContributionLitres)}</b></div><div class="rec-stat"><span>${t('monitor.zonesAllocated')}</span><b>${water.affectedZones.length}</b></div></div><details class="details-block"><summary class="metric-label">${t('common.assumptions')}</summary><ul class="card-description">${water.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`, t('monitor.formula'), sourceBadge('DECISION_ENGINE'))}${card(t('monitor.zoneAllocation'), water.affectedZones.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>${t('monitor.zoneAllocation')}</th><th>${t('monitor.area')}</th><th>${t('monitor.allocation')}</th></tr></thead><tbody>${water.affectedZones.map((zone) => `<tr><td><b>${esc(zone.zoneName)}</b></td><td>${zone.areaAcres} ac</td><td>${litres(zone.allocationLitres)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state">${t('common.noData')}</div>`)}</div><div class="section-stack">${card(t('monitor.weather'), forecast, t('monitor.weatherNote'))}${card(t('monitor.sensorStatus'), d.sensorDevices.length ? d.sensorDevices.map((device) => `<div class="action-item"><div class="action-mark">◌</div><div><div class="inline-between"><b>${esc(device.name)}</b>${sourceBadge(device.source)}</div><p>${dataLabel(device.status)} · ${t('header.lastReading')} ${dateTime(device.lastReadingAt)}</p></div></div>`).join('') : `<div class="empty-state">${t('monitor.noDevices')}</div>`, t('monitor.staleNote'))}${card(t('monitor.readings'), readings, t('monitor.readingsNote'))}${card(t('monitor.irrigationAdvice'), `<h3>${irrigation.recommendationMessage ? engineMessage(irrigation.recommendationMessage) : esc(irrigation.recommendation)}</h3><p class="card-description" style="margin-top:7px">${t('monitor.timing')}: ${dataLabel(irrigation.timing)} · ${t('monitor.suggested')}: ${litres(irrigation.quantityLitres)} · ${t('common.confidence')}: ${dataLabel(irrigation.confidence)}</p><ul class="card-description">${engineMessageList(irrigation.messages, irrigation.reasons).map((reason) => `<li>${reason}</li>`).join('')}</ul><div class="notice" style="margin-top:12px">${t('monitor.safety')}</div>`, t('monitor.safety'))}${card(t('monitor.riskIntelligence'), d.risks.map((risk) => `<div class="action-item"><div class="action-mark ${risk.level === 'High' ? 'risk-mark' : ''}">${risk.level === 'High' ? '!' : 'i'}</div><div><div class="inline-between"><b>${risk.type === 'drought' ? t('monitor.drought') : t('monitor.flood')}</b><span class="score-pill">${dataLabel(risk.level)}</span></div><p>${engineMessageList(risk.messages, risk.reasons)[0] || t('history.unavailable')}</p><div class="metric-sub">${t('common.confidence')}: ${dataLabel(risk.confidence)}</div></div></div>`).join(''), t('monitor.riskSignal'))}</div></div>`;
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
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.type')}<select name="type">${types.map((x, i) => `<option value="${esc(x)}" ${record.type === x ? 'selected' : ''}>${esc(typeLabels[i] || x)}</option>`).join('')}${record.type && !types.includes(record.type) ? `<option selected>${esc(record.type)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.date')}<input name="date" type="date" value="${esc(record.date || new Date().toISOString().slice(0,10))}" required></label></div><div class="form-field"><label>${t('forms.quantity')} (${t('history.optional')})<input name="quantity" type="number" min="0" step="any" value="${esc(record.quantity ?? '')}"></label></div><div class="form-field"><label>${t('forms.unit')}<select name="unit">${units.map((x, i) => `<option value="${esc(x)}" ${record.unit === x ? 'selected' : ''}>${esc(unitLabels[i] || x)}</option>`).join('')}${record.unit && !units.includes(record.unit) ? `<option selected>${esc(record.unit)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId"><option value="">—</option>${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}" ${record.zoneId === zone.id ? 'selected' : ''}>${esc(zone.name)}</option>`).join('')}</select></label></div></div><div class="form-field form-wide"><label>${t('forms.notes')}<textarea name="notes" maxlength="1000">${esc(record.notes || '')}</textarea></label></div><button class="btn" type="submit">${t('forms.saveActivity')}</button></form>`;
}

function soilForm(record = {}) {
  const parameters = ['pH','EC','Organic carbon','N','P','K','Moisture'], labels = t('forms.parameters');
  const units = {
    pH: [''], EC: ['', 'dS/m', 'mS/cm'], 'Organic carbon': ['', '%', 'g/kg'],
    N: ['', 'mg/kg', 'kg/ha', 'ppm'], P: ['', 'mg/kg', 'kg/ha', 'ppm'],
    K: ['', 'mg/kg', 'kg/ha', 'ppm'], Moisture: ['', '%']
  };
  const options = [...(units[record.parameter] || [record.unit || ''])];
  if (record.unit && !options.includes(record.unit)) options.push(record.unit);
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.parameter')}<select name="parameter">${parameters.map((x, i) => `<option value="${esc(x)}" ${record.parameter === x ? 'selected' : ''}>${esc(labels[i] || x)}</option>`).join('')}${record.parameter && !parameters.includes(record.parameter) ? `<option selected>${esc(record.parameter)}</option>` : ''}</select></label></div><div class="form-field"><label>${t('forms.value')} (${t('history.optional')})<input name="value" type="number" min="0" step="any" value="${esc(record.value ?? '')}"></label></div><div class="form-field"><label>${t('forms.date')}<input name="date" type="date" value="${esc(record.date || new Date().toISOString().slice(0,10))}" required></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId"><option value="">—</option>${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}" ${record.zoneId === zone.id ? 'selected' : ''}>${esc(zone.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.unit')}<select name="unit">${options.map((unit) => `<option value="${esc(unit)}" ${unit === (record.unit || '') ? 'selected' : ''}>${unit ? esc(unit) : t(record.parameter === 'pH' ? 'forms.unitless' : 'history.unknown')}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.method')} (${t('history.optional')})<input name="method" value="${esc(record.method || '')}" maxlength="100"></label></div></div><div class="notice form-notice">${t('forms.soilMethodNote')}</div><button class="btn" type="submit">${t('forms.saveSoil')}</button></form>`;
}

function readingForm() {
  return `<form id="modal-form"><div class="form-grid"><div class="form-field"><label>${t('forms.device')}<select name="deviceId">${state.dashboard.sensorDevices.map((device) => `<option value="${esc(device.id)}">${esc(device.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.zone')}<select name="zoneId">${state.dashboard.zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('forms.soilMoisture')}<input name="soilMoisturePct" type="number" min="0" max="100" step="any" required></label></div><div class="form-field"><label>${t('forms.temperature')}<input name="temperatureC" type="number" min="-20" max="70" step="any" required></label></div><div class="form-field"><label>${t('forms.humidity')}<input name="humidityPct" type="number" min="0" max="100" step="any" required></label></div><div class="form-field"><label>${t('forms.waterLevel')}<input name="waterLevelPct" type="number" min="0" max="100" step="any"></label></div></div><div class="notice form-notice">${t('forms.readingNotice')}</div><button class="btn" type="submit">${t('forms.saveReading')}</button></form>`;
}

function farmForm(farm = {}) {
  const field = (name, key, type = 'text', value = '') => `<div class="form-field"><label>${t(key)}<input name="${name}" type="${type}" value="${esc(value)}" ${name === 'areaAcres' ? 'min="0.01" step="any"' : name === 'availableWaterLitres' ? 'min="0" step="any"' : name === 'irrigationEfficiency' ? 'min="0.01" max="1" step="any"' : 'maxlength="160"'} ${['name', 'areaAcres'].includes(name) ? 'required' : ''}></label></div>`;
  return `<form id="farm-form" class="form-grid">${field('name', 'farms.name', 'text', farm.name)}${field('areaAcres', 'farms.area', 'number', farm.areaAcres)}${field('soilType', 'farms.soil', 'text', farm.soilType)}${field('waterSource', 'farms.waterSource', 'text', farm.waterSource)}${field('irrigationMethod', 'farms.irrigation', 'text', farm.irrigationMethod)}${field('irrigationEfficiency', 'farms.irrigationEfficiency', 'number', farm.irrigationEfficiency ?? '')}${field('availableWaterLitres', 'monitor.availableWater', 'number', farm.availableWaterLitres ?? '')}<div class="form-field form-wide"><label>${t('auth.location')}<input name="location" value="${esc(farm.location || '')}" maxlength="160"></label></div><div class="form-wide"><button class="btn" type="submit">${t('common.save')}</button></div></form>`;
}

function zoneForm(zone = {}) {
  const stages = ['Sowing','Vegetative','Flowering','Grain filling','Maturity','Harvested'];
  return `<form id="zone-form" class="form-grid"><div class="form-field"><label>${t('farms.zoneName')}<input name="name" value="${esc(zone.name || '')}" maxlength="80" required></label></div><div class="form-field"><label>${t('farms.area')}<input name="areaAcres" type="number" min="0.01" step="any" value="${esc(zone.areaAcres || '')}" required></label></div><div class="form-field"><label>${t('farms.soil')}<input name="soilType" value="${esc(zone.soilType || state.dashboard?.farm.soilType || '')}" maxlength="80"></label></div><div class="form-field"><label>${t('farms.waterAvailability')}<input name="waterAvailability" value="${esc(zone.waterAvailability || '')}" maxlength="60"></label></div><div class="form-field"><label>${t('farms.currentCrop')}<input name="currentCrop" value="${esc(zone.currentCrop || '')}" maxlength="80"></label></div><div class="form-field"><label>${t('forms.growthStage')}<select name="growthStage"><option value="">${t('engine.notRecorded')}</option>${stages.map((stage) => `<option value="${esc(stage)}" ${stage === zone.growthStage ? 'selected' : ''}>${dataLabel(stage)}</option>`).join('')}</select></label></div><div class="form-field form-wide"><label>${t('farms.sensorId')}<input name="sensorId" value="${esc(zone.sensorId || '')}" maxlength="64"></label></div><div class="form-wide"><button class="btn" type="submit">${t('common.save')}</button></div></form>`;
}

function seasonForm(record = {}) {
  const expenses = record.expenses || {};
  const expenseKeys = ['seeds','fertilizer','pesticide','labour','irrigation','machinery','transport','other'];
  return `<form id="season-form"><div class="form-grid"><div class="form-field"><label>${t('recommendations.crop')}<input name="crop" value="${esc(record.crop || '')}" maxlength="80" required></label></div><div class="form-field"><label>${t('history.variety')} (${t('history.optional')})<input name="variety" value="${esc(record.variety || '')}" maxlength="80"></label></div><div class="form-field"><label>${t('history.season')} (${t('history.optional')})<select name="season"><option value="" ${record.season ? '' : 'selected'}>${t('history.unknown')}</option>${['Kharif','Rabi','Zaid','Summer','Annual'].map((season) => `<option value="${season}" ${record.season === season ? 'selected' : ''}>${dataLabel(season)}</option>`).join('')}</select></label></div><div class="form-field"><label>${t('history.year')} (${t('history.optional')})<input name="year" type="number" min="1990" max="2100" step="1" value="${esc(record.year ?? '')}"></label></div><div class="form-field"><label>${t('farms.area')} (ac)<input name="areaAcres" type="number" min="0.01" step="any" value="${esc(record.areaAcres ?? state.dashboard?.farm.areaAcres ?? '')}" required></label></div><div class="form-field"><label>${t('memory.yield')} (q, ${t('history.optional')})<input name="yieldQuintal" type="number" min="0" step="any" value="${esc(record.yieldQuintal ?? '')}"></label></div><div class="form-field"><label>${t('history.price')} (₹ / q, ${t('history.optional')})<input name="sellingPricePerQuintal" type="number" min="0" step="any" value="${esc(record.sellingPricePerQuintal ?? '')}"></label></div><input name="currency" type="hidden" value="INR"><div class="form-field"><label>${t('history.planted')} (${t('history.optional')})<input name="plantedDate" type="date" value="${esc(record.plantedDate || '')}"></label></div><div class="form-field"><label>${t('history.harvested')} (${t('history.optional')})<input name="harvestedDate" type="date" value="${esc(record.harvestedDate || '')}"></label></div></div><h3 class="section-gap">${t('profit.actualExpenses')}</h3><div class="form-grid">${expenseKeys.map((key) => `<div class="form-field"><label>${dataLabel(key)} (₹, ${t('history.optional')})<input name="expense-${key}" type="number" min="0" step="any" value="${esc(expenses[key] ?? '')}"></label></div>`).join('')}</div><label class="checkbox-row"><input name="expensesComplete" type="checkbox" ${record.expensesComplete ? 'checked' : ''}>${t('profit.expensesComplete')}</label><div class="notice form-notice">${t('profit.expenseCompletenessNote')}</div><div class="notice form-notice">${t('history.recordNote')}</div><button class="btn" type="submit">${t('common.save')}</button></form>`;
}
function cropPlanForm(record = {}) {
  const zones = state.dashboard?.zones || [];
  const selected = (value, current) => value === current ? 'selected' : '';
  return `<form id="crop-plan-form" class="form-grid">
    ${fieldLabel(t('recommendations.crop'), `<input name="crop" maxlength="80" required value="${esc(record.crop || '')}">`)}
    ${fieldLabel(t('forms.variety'), `<input name="variety" maxlength="80" value="${esc(record.variety || '')}">`)}
    ${fieldLabel(t('forms.zone'), `<select name="zoneId" required>${zones.map((zone) => `<option value="${esc(zone.id)}" ${selected(zone.id, record.zoneId)}>${esc(zone.name)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('history.season'), `<select name="season"><option value="">${t('history.unknown')}</option>${['Kharif','Rabi','Zaid','Summer','Annual'].map((value) => `<option ${selected(value, record.season)}>${value}</option>`).join('')}</select>`)}
    ${fieldLabel(t('history.year'), `<input name="agriculturalYear" type="number" min="1900" max="2100" step="1" value="${esc(record.agriculturalYear ?? '')}">`)}
    ${fieldLabel(t('memory.sowingDate'), `<input name="sowingDate" type="date" value="${esc(record.sowingDate || '')}">`)}
    ${fieldLabel(t('memory.expectedHarvest'), `<input name="expectedHarvestDate" type="date" value="${esc(record.expectedHarvestDate || '')}">`)}
    ${fieldLabel(t('memory.actualHarvest'), `<input name="actualHarvestDate" type="date" value="${esc(record.actualHarvestDate || '')}">`)}
    ${fieldLabel(t('forms.growthStage'), `<input name="currentGrowthStage" maxlength="60" value="${esc(record.currentGrowthStage || '')}">`)}
    ${fieldLabel(t('memory.area'), `<input name="cultivatedArea" type="number" min="0.000001" step="any" required value="${esc(record.cultivatedArea ?? '')}">`)}
    ${fieldLabel(t('memory.areaUnit'), `<select name="areaUnit">${['acre','hectare','sqm'].map((value) => `<option value="${value}" ${selected(value, record.areaUnit || 'acre')}>${value}</option>`).join('')}</select>`)}
    ${fieldLabel(t('common.status'), `<select name="status">${['planned','active','completed','cancelled'].map((value) => `<option value="${value}" ${selected(value, record.status || 'planned')}>${dataLabel(value)}</option>`).join('')}</select>`)}
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
}
function waterUseForm() {
  const zones = state.dashboard?.zones || [];
  return `<form id="water-use-form" class="form-grid">
    ${fieldLabel(t('forms.zone'), `<select name="zoneId" required>${zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('forms.date'), '<input name="eventDateTime" type="datetime-local" required>')}
    ${fieldLabel(t('monitor.allocation'), '<input name="waterQuantity" type="number" min="0" step="any" required>')}
    ${fieldLabel(t('common.unit'), '<select name="quantityUnit" required><option value="litres">litres</option><option value="mm">mm</option></select>')}
    ${fieldLabel(t('memory.method'), '<input name="applicationMethod" maxlength="80" required>')}
    ${fieldLabel(t('memory.measurementSource'), '<input name="sourceOfMeasurement" maxlength="80" required>')}
    ${fieldLabel(t('common.source'), `<select name="recordProvenance" required><option value="FARMER_ENTERED">${t('common.farmerEntered')}</option><option value="SENSOR_OBSERVED">${t('memory.sensorObserved')}</option><option value="DEMONSTRATION_DATA">${t('common.simulated')}</option></select>`)}
    ${fieldLabel(t('memory.notes'), '<textarea name="notes" maxlength="1000"></textarea>')}
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
}
function financialScenarioForm(record = {}) {
  const plans = (state.dashboard?.cropPlans || []).filter((plan) => ['planned','active'].includes(plan.status));
  const selected = (value, current) => value === current ? 'selected' : '';
  return `<form id="financial-scenario-form" class="form-grid">
    ${fieldLabel(t('recommendations.crop'), `<input name="crop" maxlength="80" required value="${esc(record.crop || '')}">`)}
    ${fieldLabel(t('memory.cropPlanOptional'), `<select name="cropPlanId"><option value="">${t('history.unknown')}</option>${plans.map((plan) => `<option value="${esc(plan.id)}" ${selected(plan.id, record.cropPlanId)}>${esc(plan.crop)} · ${esc((state.dashboard.zones || []).find((zone) => zone.id === plan.zoneId)?.name || '')}</option>`).join('')}</select>`)}
    ${fieldLabel(t('memory.scenario'), `<select name="scenario" required>${['low','medium','high'].map((value) => `<option value="${value}" ${selected(value, record.scenario || 'medium')}>${dataLabel(value)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('memory.expectedYield'), `<input name="expectedYieldQuintal" type="number" min="0" step="any" value="${esc(record.expectedYieldQuintal ?? '')}">`)}
    ${fieldLabel(t('memory.expectedPrice'), `<input name="pricePerQuintal" type="number" min="0" step="any" value="${esc(record.pricePerQuintal ?? '')}">`)}
    ${fieldLabel(t('memory.seedCosts'), `<input name="seed" type="number" min="0" step="any" value="${esc(record.expenses?.seed ?? '')}">`)}
    ${fieldLabel(t('memory.laborCosts'), `<input name="labour" type="number" min="0" step="any" value="${esc(record.expenses?.labour ?? '')}">`)}
    ${fieldLabel(t('memory.otherCosts'), `<input name="other" type="number" min="0" step="any" value="${esc(record.expenses?.other ?? '')}">`)}
    ${fieldLabel(t('common.source'), `<select name="source" required><option value="FARMER_ENTERED">${t('common.farmerEntered')}</option><option value="DEMONSTRATION_DATA">${t('common.simulated')}</option></select>`)}
    ${fieldLabel(t('memory.assumptions'), `<textarea name="assumptions" maxlength="3000">${esc((record.assumptions || []).join('\\n'))}</textarea>`)}
    <label class="form-field checkbox-field"><input name="expensesComplete" type="checkbox" ${record.expensesComplete ? 'checked' : ''}><span>${t('memory.expensesComplete')}</span></label>
    <input type="hidden" name="yieldUnit" value="quintal_total"><input type="hidden" name="currency" value="INR"><input type="hidden" name="costUnit" value="INR_total">
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
}
function openForm(titleKey, endpoint, body, recordId = null) {
  const dialog = $('#action-dialog');
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(titleKey)}</h2>${body}`;
  dialog.showModal();
  if (endpoint === '/api/soil-tests') {
    const form = $('#modal-form');
    const parameter = form.elements.parameter;
    const unit = form.elements.unit;
    const value = form.elements.value;
    const units = {
      pH: [''], EC: ['', 'dS/m', 'mS/cm'], 'Organic carbon': ['', '%', 'g/kg'],
      N: ['', 'mg/kg', 'kg/ha', 'ppm'], P: ['', 'mg/kg', 'kg/ha', 'ppm'],
      K: ['', 'mg/kg', 'kg/ha', 'ppm'], Moisture: ['', '%']
    };
    const refreshUnits = () => {
      const options = [...(units[parameter.value] || [''])];
      if (unit.value && !options.includes(unit.value)) options.push(unit.value);
      unit.innerHTML = options.map((item) => `<option value="${esc(item)}">${item ? esc(item) : t(parameter.value === 'pH' ? 'forms.unitless' : 'history.unknown')}</option>`).join('');
      if (parameter.value === 'pH') unit.value = '';
      value.max = parameter.value === 'pH' ? '14' : parameter.value === 'Moisture' ? '100' : '';
    };
    parameter.addEventListener('change', refreshUnits);
    refreshUnits();
  }
  $('#modal-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...raw,
      farmId: state.farmId,
      quantity: numberOrNull(raw.quantity),
      value: numberOrNull(raw.value),
      soilMoisturePct: numberOrNull(raw.soilMoisturePct),
      temperatureC: numberOrNull(raw.temperatureC),
      humidityPct: numberOrNull(raw.humidityPct),
      waterLevelPct: numberOrNull(raw.waterLevelPct),
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
    payload.irrigationEfficiency = payload.irrigationEfficiency === '' ? null : Number(payload.irrigationEfficiency);
    payload.availableWaterLitres = payload.availableWaterLitres === '' ? null : Number(payload.availableWaterLitres);
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
    const expenses = Object.fromEntries(Object.entries(raw).filter(([key, value]) => key.startsWith('expense-') && value !== '').map(([key, value]) => [key.slice(8), Number(value)]));
    const payload = {
      farmId: state.farmId, crop: raw.crop, variety: raw.variety,
      season: raw.season || null, year: numberOrNull(raw.year),
      areaAcres: numberOrNull(raw.areaAcres), yieldQuintal: numberOrNull(raw.yieldQuintal),
      sellingPricePerQuintal: numberOrNull(raw.sellingPricePerQuintal), currency: raw.currency,
      plantedDate: raw.plantedDate || null,
      harvestedDate: raw.harvestedDate || null, expenses, expensesComplete: raw.expensesComplete === 'on'
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

function openCropPlanForm(record = null) {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(record ? 'memory.editCropPlan' : 'memory.addCropPlan')}</h2>${cropPlanForm(record || {})}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#crop-plan-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...raw,
      farmId:state.farmId,
      variety:raw.variety || null,
      season:raw.season || null,
      agriculturalYear:numberOrNull(raw.agriculturalYear),
      sowingDate:raw.sowingDate || null,
      expectedHarvestDate:raw.expectedHarvestDate || null,
      actualHarvestDate:raw.actualHarvestDate || null,
      currentGrowthStage:raw.currentGrowthStage || null,
      cultivatedArea:numberOrNull(raw.cultivatedArea),
      recordSource:record?.recordSource || 'FARMER_ENTERED'
    };
    try {
      await api(record
        ? `/api/farms/${encodeURIComponent(state.farmId)}/crop-plans/${encodeURIComponent(record.id)}`
        : `/api/farms/${encodeURIComponent(state.farmId)}/crop-plans`,
      { method:record ? 'PUT' : 'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

function openWaterUseForm() {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t('memory.addWaterUse')}</h2>${waterUseForm()}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#water-use-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = {
      ...raw,
      zoneId:raw.zoneId || null,
      eventDateTime:new Date(raw.eventDateTime).toISOString(),
      waterQuantity:numberOrNull(raw.waterQuantity),
      recordProvenance:raw.recordProvenance,
      farmId:state.farmId
    };
    try {
      await api(`/api/farms/${encodeURIComponent(state.farmId)}/water-use-events`, { method:'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) {
      toast(translateError(error));
    }
  });
}

function openPlanningPeriodForm() {
  const plans = state.dashboard?.cropPlans || [];
  const zones = state.dashboard?.zones || [];
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t('memory.addPlanningPeriod')}</h2><form id="planning-period-form" class="form-grid">
    ${fieldLabel(t('forms.zone'), `<select name="zoneId"><option value="">${t('history.unknown')}</option>${zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('memory.cropPlans'), `<select name="cropPlanId"><option value="">${t('history.unknown')}</option>${plans.map((plan) => `<option value="${esc(plan.id)}">${esc(plan.crop)} · ${esc(zoneNameForForm(plan.zoneId))}</option>`).join('')}</select>`)}
    ${fieldLabel(t('memory.from'), '<input type="date" name="startDate" required>')}
    ${fieldLabel(t('memory.to'), '<input type="date" name="endDate" required>')}
    ${fieldLabel(t('common.status'), '<select name="status"><option value="draft">Draft</option><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select>')}
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#planning-period-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...raw, farmId:state.farmId, zoneId:raw.zoneId || null, cropPlanId:raw.cropPlanId || null };
    try {
      await api(`/api/farms/${encodeURIComponent(state.farmId)}/planning-periods`, { method:'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) { toast(translateError(error)); }
  });
}

function zoneNameForForm(zoneId) {
  return state.dashboard?.zones?.find((zone) => zone.id === zoneId)?.name || '';
}

function openEffectiveRainfallForm() {
  const periods = state.dashboard?.planningPeriods || [];
  const zones = state.dashboard?.zones || [];
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t('memory.addEffectiveRainfall')}</h2><form id="effective-rainfall-form" class="form-grid">
    ${fieldLabel(t('memory.planningPeriod'), `<select name="planningPeriodId" required>${periods.map((period) => `<option value="${esc(period.id)}">${date(period.startDate)} – ${date(period.endDate)} · ${esc(zoneNameForForm(period.zoneId))}</option>`).join('')}</select>`)}
    ${fieldLabel(t('forms.zone'), `<select name="zoneId"><option value="">${t('history.unknown')}</option>${zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('forms.date'), '<input type="date" name="observationDate" required>')}
    ${fieldLabel(t('memory.rainAmount'), '<input type="number" name="amount" min="0" step="any" required>')}
    ${fieldLabel(t('memory.method'), '<input name="method" maxlength="120" required>')}
    ${fieldLabel(t('memory.measurementSource'), '<input name="source" maxlength="80" required>')}
    <div class="notice form-notice">${t('memory.effectiveRainfallNotice')}</div>
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#effective-rainfall-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...raw, farmId:state.farmId, zoneId:raw.zoneId || null, amount:numberOrNull(raw.amount), unit:'mm', provenance:'FARMER_ENTERED' };
    try {
      await api(`/api/farms/${encodeURIComponent(state.farmId)}/effective-rainfall`, { method:'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) { toast(translateError(error)); }
  });
}

function openWaterAvailabilityForm() {
  const zones = state.dashboard?.zones || [];
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t('memory.addWaterAvailability')}</h2><form id="water-availability-form" class="form-grid">
    ${fieldLabel(t('forms.zone'), `<select name="zoneId"><option value="">${t('history.unknown')}</option>${zones.map((zone) => `<option value="${esc(zone.id)}">${esc(zone.name)}</option>`).join('')}</select>`)}
    ${fieldLabel(t('memory.waterType'), '<select name="waterType" required><option value="">—</option><option value="stored">Stored</option><option value="reliable_incoming">Reliable incoming</option><option value="aggregate_available">Aggregate available</option><option value="unknown">Unknown type</option></select>')}
    ${fieldLabel(t('forms.date'), '<input type="date" name="measurementDate" required>')}
    ${fieldLabel(t('monitor.availableWater'), '<input type="number" name="availableWaterLitres" min="0" step="any" required>')}
    ${fieldLabel(t('memory.validity'), '<input name="validityPeriod" maxlength="120">')}
    ${fieldLabel(t('memory.notes'), '<textarea name="notes" maxlength="1000"></textarea>')}
    <input type="hidden" name="unit" value="litres">
    <div class="notice form-notice">${t('memory.waterInventoryNote')}</div>
    <div class="form-actions"><button class="btn" type="submit">${t('common.save')}</button><button class="btn secondary" type="button" data-close-dialog>${t('common.cancel')}</button></div>
  </form>`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#water-availability-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const payload = { ...raw, farmId:state.farmId, zoneId:raw.zoneId || null, availableWaterLitres:numberOrNull(raw.availableWaterLitres), provenance:'FARMER_ENTERED' };
    try {
      await api(`/api/farms/${encodeURIComponent(state.farmId)}/water-availability`, { method:'POST', body:JSON.stringify(payload) });
      dialog.close();
      await loadDashboard();
      toast(t('forms.saved'));
    } catch (error) { toast(translateError(error)); }
  });
}

function openFinancialScenarioForm(record = null) {
  $('#dialog-content').innerHTML = `<h2 class="modal-title">${t(record ? 'memory.editFinancialScenario' : 'memory.addFinancialScenario')}</h2>${financialScenarioForm(record || {})}`;
  const dialog = $('#action-dialog');
  dialog.showModal();
  $('[data-close-dialog]')?.addEventListener('click', () => dialog.close());
  $('#financial-scenario-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const expenses = Object.fromEntries(['seed','labour','other'].map((key) => [key, numberOrNull(raw[key])]));
    if (raw.expensesComplete === 'on' && Object.values(expenses).some((value) => value == null)) {
      toast(t('memory.costsNeedComplete'));
      return;
    }
    const payload = {
      ...raw,
      farmId:state.farmId,
      cropPlanId:raw.cropPlanId || null,
      zoneId:record?.zoneId || null,
      expectedYieldQuintal:numberOrNull(raw.expectedYieldQuintal),
      pricePerQuintal:numberOrNull(raw.pricePerQuintal),
      expenses,
      expensesComplete:raw.expensesComplete === 'on',
      assumptions:raw.assumptions.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    };
    try {
      await api(record
        ? `/api/farms/${encodeURIComponent(state.farmId)}/financial-scenarios/${encodeURIComponent(record.id)}`
        : `/api/farms/${encodeURIComponent(state.farmId)}/financial-scenarios`,
      { method:record ? 'PUT' : 'POST', body:JSON.stringify(payload) });
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
    const decisions = state.dashboard;
    decisions.waterBudget.status = decisions.waterBudget.decisionStatus;
    for (const module of [decisions.landPower, decisions.waterBudget, decisions.irrigation, decisions.profit, decisions.farmMemory]) {
      if (module?.confidence && typeof module.confidence === 'object') {
        const level = module.confidence.level;
        module.confidence = level ? level[0].toUpperCase() + level.slice(1) : 'Low';
      }
    }
    decisions.recommendations.forEach((item) => {
      if (item.confidence && typeof item.confidence === 'object') {
        const level = item.confidence.level;
        item.confidence = level ? level[0].toUpperCase() + level.slice(1) : 'Low';
      }
    });
    decisions.risks.forEach((item) => {
      if (item.confidence && typeof item.confidence === 'object') {
        const level = item.confidence.level;
        item.confidence = level ? level[0].toUpperCase() + level.slice(1) : 'Low';
      }
    });
    if (decisions.irrigation.quantityLitres == null) decisions.irrigation.recommendation = t('engine.irrigationUnavailable');
    decisions.irrigation.safety = t('monitor.safety');
    decisions.waterBudget.assumptions = [t('engine.waterAssumptions')];
    if (!decisions.profit.future.available) decisions.profit.future.assumptions = [t('engine.futureUnavailable')];
    for (const key of ['strengths', 'limitations', 'missing']) {
      decisions.landPower[key] = decisions.landPower[key].map(localizedDataText);
    }
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
  $('[data-action="add-crop-plan"]')?.addEventListener('click', () => openCropPlanForm());
  $('[data-action="add-planning-period"]')?.addEventListener('click', openPlanningPeriodForm);
  $('[data-action="add-effective-rainfall"]')?.addEventListener('click', openEffectiveRainfallForm);
  $('[data-action="add-water-availability"]')?.addEventListener('click', openWaterAvailabilityForm);
  $('[data-action="add-water-use"]')?.addEventListener('click', openWaterUseForm);
  $('[data-action="add-financial-scenario"]')?.addEventListener('click', () => openFinancialScenarioForm());
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
  document.querySelectorAll('[data-edit-crop-plan]').forEach((button) => button.addEventListener('click', () => {
    const record = state.dashboard?.cropPlans.find((item) => item.id === button.dataset.editCropPlan);
    if (record) openCropPlanForm(record);
  }));
  document.querySelectorAll('[data-edit-financial-scenario]').forEach((button) => button.addEventListener('click', () => {
    const record = state.dashboard?.financialScenarios.find((item) => item.id === button.dataset.editFinancialScenario);
    if (record) openFinancialScenarioForm(record);
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
  $('#memory-filters')?.addEventListener('submit', (event) => {
    event.preventDefault();
    state.memoryFilters = Object.fromEntries(new FormData(event.currentTarget).entries());
    renderRoute();
  });
  $('[data-action="clear-memory-filters"]')?.addEventListener('click', () => {
    state.memoryFilters = {};
    renderRoute();
  });
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
