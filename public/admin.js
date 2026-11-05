(() => {
  const { useEffect, useState } = React;
  const createElement = React.createElement;
  const localizeChild = (child) => typeof child === 'string'
    ? locale?.adminUi?.[child] || locale?.adminUi?.statuses?.[child] || getPath(locale || {}, `data.${child}`) || child
    : Array.isArray(child) ? child.map(localizeChild) : child;
  const h = (type, props, ...children) => {
    const localizedProps = props ? { ...props } : props;
    if (localizedProps) {
      for (const key of ['aria-label', 'placeholder', 'title']) {
        if (typeof localizedProps[key] === 'string') localizedProps[key] = localizeChild(localizedProps[key]);
      }
    }
    return createElement(type, localizedProps, ...children.map(localizeChild));
  };
  const LOCALE_KEY = 'agcro-admin-language';
  const ADMIN_TOKEN_KEY = 'agcro-admin-token';
  let locale = null;
  let currentLang = 'mr';

  const getPath = (object, path) => path.split('.').reduce((value, part) => value == null ? undefined : value[part], object);
  const t = (key, vars = {}) => {
    const value = getPath(locale || {}, key);
    if (typeof value !== 'string') return value === undefined ? key : value;
    return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  };
  const tx = (english, vars = {}) => {
    const value = locale?.adminUi?.[english] || english;
    return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  };
  const formatNumber = (value) => value == null ? '—' : Number(value).toLocaleString(localeTag());
  const localeTag = () => ({ mr:'mr-IN', hi:'hi-IN' }[currentLang] || 'en-IN');
  const localizedStatus = (value) => {
    const key = String(value ?? '');
    for (const candidate of [key, key.toLowerCase(), key[0]?.toUpperCase() + key.slice(1).toLowerCase()]) {
      const adminValue = locale?.adminUi?.[candidate];
      if (typeof adminValue === 'string') return adminValue;
      const status = locale?.adminUi?.statuses?.[candidate];
      if (status) return status;
    }
    const data = locale?.data || {};
    for (const candidate of [key, key.toLowerCase(), key[0]?.toUpperCase() + key.slice(1).toLowerCase()]) {
      if (typeof data[candidate] === 'string') return data[candidate];
    }
    return key || '—';
  };
  const formatDate = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? showText(value)
      : parsed.toLocaleDateString(localeTag(), { day:'numeric', month:'short', year:'numeric' });
  };
  const localizedError = (error) => {
    const keys = {
      unauthorized:'errors.unauthorized', token_expired:'errors.unauthorized',
      forbidden:'errors.forbidden', not_found:'errors.notFound',
      validation_error:'errors.validation', invalid_credentials:'auth.invalidCredentials',
      rate_limited:'errors.rateLimited', auth_rate_limited:'errors.rateLimited',
      internal_error:'errors.request', request_failed:'adminUi.requestFailed',
      report_export_failed:'adminUi.reportFailed', authentication_failed:'adminUi.authFailed',
      admin_authorization_failed:'adminUi.authFailed'
    };
    if (error?.code && keys[error.code]) return t(keys[error.code]);
    if (error?.authFailure || error?.status === 401 || error?.status === 403) return tx('Administrator authorization failed.');
    return tx('Something went wrong. Please try again.');
  };
  const dateTime = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString(localeTag(), { dateStyle:'medium', timeStyle:'short' });
  };
  const sourceTone = (source) => ({ LIVE_SENSOR:'live', EXTERNAL_API:'external', FARMER_ENTERED:'farmer', SIMULATED_SENSOR:'demo', SIMULATED_WEATHER:'demo', DECISION_ENGINE:'engine' }[source] || 'muted');
  const sourceLabel = (source) => ({
    LIVE_SENSOR:'common.liveSensor', EXTERNAL_API:'common.externalApi', FARMER_ENTERED:'common.farmerEntered',
    SIMULATED_SENSOR:'common.simulated', SIMULATED_WEATHER:'common.simulated', DECISION_ENGINE:'common.decisionEngine'
  }[source] ? t({
    LIVE_SENSOR:'common.liveSensor', EXTERNAL_API:'common.externalApi', FARMER_ENTERED:'common.farmerEntered',
    SIMULATED_SENSOR:'common.simulated', SIMULATED_WEATHER:'common.simulated', DECISION_ENGINE:'common.decisionEngine'
  }[source]) : source || 'Unknown source');
  const showText = (value) => value == null || value === '' ? '—' : String(value);
  const displayValue = (value) => typeof value === 'number' ? formatNumber(value) : showText(value);

  function Badge({ children, tone = 'engine' }) {
    return h('span', { className:`provenance ${tone}` }, children);
  }

  function LanguageSwitch({ lang, onChange }) {
    return h('div', { className:'language-switcher', role:'group', 'aria-label':tx('Language') },
      ['en','mr','hi'].map((code) => h('button', {
        key:code, type:'button', className:`language-button ${lang === code ? 'selected' : ''}`, onClick:() => onChange(code)
      }, t(`language.${{ mr:'marathi', en:'english', hi:'hindi' }[code]}`)))
    );
  }

  function AdminLogin({ onLoginSuccess, lang, onChange }) {
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('admin123');
    const [loginError, setLoginError] = useState('');
    const [loading, setLoading] = useState(false);

    const submitLogin = async (event, demo = false) => {
      event?.preventDefault();
      setLoginError('');
      setLoading(true);
      try {
        const response = await fetch('/api/auth/login', {
          method:'POST',
          headers:{ 'Content-Type':'application/json' },
          body:JSON.stringify(demo ? { username:'admin', password:'admin123' } : { username, password })
        });
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload.message || 'Authentication failed');
          error.code = payload.error;
          error.status = response.status;
          throw error;
        }
        if (payload.data?.user?.role !== 'ADMIN' || !payload.data?.token) {
          const error = new Error('Access denied: account does not have administrator privileges.');
          error.code = 'forbidden';
          throw error;
        }
        onLoginSuccess(payload.data.token);
      } catch (error) {
        setLoginError(localizedError(error));
      } finally {
        setLoading(false);
      }
    };

    return h('div', { className:'app-shell' },
      h('main', { className:'main-content', style:{ marginLeft:0, width:'100%' } },
        h('div', { className:'page-wrap', style:{ maxWidth:640, margin:'0 auto' } },
          h('div', { className:'admin-login-top' },
            h('div', { className:'brand-lockup' }, h('div', { className:'brand-mark' }, 'A'),
              h('div', null, h('div', { className:'brand-name' }, 'AGCRO'), h('div', { className:'brand-sub' }, t('brand.sub')))),
            h(LanguageSwitch, { lang, onChange })
          ),
          h('section', { className:'hero-card' },
            h('div', { className:'eyebrow' }, t('admin.roleBoundary')),
            h('h2', null, t('admin.reviewNetwork')),
            h('p', null, tx('Sign in with an administrator account to review cross-farm records and device controls.')),
            loginError ? h('div', { className:'alert-item critical', role:'alert', style:{ margin:'12px 0' } }, loginError) : null,
            h('form', { onSubmit:(event) => submitLogin(event), style:{ marginTop:16 } },
              h('div', { className:'form-field', style:{ marginBottom:12 } }, h('label', null, t('auth.username'),
                h('input', { type:'text', value:username, autoComplete:'username', required:true, onChange:(event) => setUsername(event.target.value), style:{ width:'100%', padding:10, marginTop:4 } }))),
              h('div', { className:'form-field', style:{ marginBottom:16 } }, h('label', null, t('auth.password'),
                h('input', { type:'password', value:password, autoComplete:'current-password', required:true, onChange:(event) => setPassword(event.target.value), style:{ width:'100%', padding:10, marginTop:4 } }))),
              h('div', { className:'hero-action', style:{ display:'flex', gap:10, flexWrap:'wrap' } },
                h('button', { className:'btn', type:'submit', disabled:loading }, loading ? tx('Authenticating…') : t('auth.signIn')),
                h('button', { type:'button', className:'btn secondary', disabled:loading, onClick:(event) => submitLogin(event, true) }, t('auth.demoAdmin')),
                h('a', { className:'btn secondary', href:'/' }, t('admin.farmerApp'))
              )
            )
          ),
          h('div', { className:'notice', style:{ marginTop:14 } }, tx('Admin access is verified by the API. Client role headers are not trusted.'))
        )
      )
    );
  }

  async function adminRequest(path, token, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers:{
        ...(options.body ? { 'Content-Type':'application/json' } : {}),
        'Authorization':`Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
      const error = new Error(payload.message || 'Administrator authorization failed.');
      error.code = payload.error;
      error.status = response.status;
      error.authFailure = true;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed (${response.status})`);
      error.code = payload.error || 'request_failed';
      error.status = response.status;
      throw error;
    }
    return payload.data;
  }

  const table = (headers, rows, message) => rows.length
    ? h('div', { className:'table-scroll' }, h('table', { className:'data-table' },
      h('thead', null, h('tr', null, headers.map((header) => h('th', { key:header }, header)))),
      h('tbody', null, rows)))
    : h('div', { className:'empty-state' }, message);
  const provenance = (source) => h(Badge, { tone:sourceTone(source) }, sourceLabel(source));
  const fieldLabel = (label, control) => h('label', { className:'admin-filter-field' }, h('span', null, label), control);

  function Metric({ label, value, sub }) {
    return h('div', { className:'metric-card' },
      h('div', { className:'metric-label' }, label),
    h('div', { className:'metric-value' }, displayValue(value)),
      h('div', { className:'metric-sub' }, sub)
    );
  }

  function AdminDashboard({ token, onLogout, lang, onChange }) {
    const [page, setPage] = useState('overview');
    const [pageData, setPageData] = useState(null);
    const [farmOptions, setFarmOptions] = useState([]);
    const [farmerOptions, setFarmerOptions] = useState([]);
    const [filters, setFilters] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [detail, setDetail] = useState(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const modules = [
      ['overview','Overview','⌂'], ['farmers','Farmers','♙'], ['farms','Farms & zones','▦'],
      ['devices','IoT devices','◉'], ['readings','Sensor monitoring','◌'], ['alerts','Alert centre','!'],
      ['decisions','Decision review','✓'], ['weather','Weather & risk','☼'], ['reports','Reports','⇩'], ['health','System health','⚙']
    ];

    const loadPage = async (nextPage, nextFilters = {}) => {
      setLoading(true);
      setError('');
      setNotice('');
      try {
        const params = new URLSearchParams({ pageSize:'100', ...Object.fromEntries(Object.entries(nextFilters).filter(([, value]) => value)) });
        if (nextPage === 'overview') {
          const [overview, health, farms, farmers] = await Promise.all([
            adminRequest('/api/admin/overview', token),
            adminRequest('/api/admin/health', token),
            adminRequest('/api/admin/farms?pageSize=100', token),
            adminRequest('/api/admin/farmers?pageSize=100', token)
          ]);
          setPageData({ overview, health });
          setFarmOptions(farms.items || []);
          setFarmerOptions(farmers.items || []);
        } else if (nextPage === 'reports') {
          setPageData({});
        } else {
          const result = await adminRequest(`/api/admin/${nextPage}?${params.toString()}`, token);
          setPageData(result);
          if (nextPage === 'farms') setFarmOptions(result.items || []);
          if (nextPage === 'farmers') setFarmerOptions(result.items || []);
        }
        setPage(nextPage);
        setFilters(nextFilters);
      } catch (requestError) {
        setError(localizedError(requestError));
        if (requestError.authFailure) onLogout(false);
      } finally {
        setLoading(false);
      }
    };

    useEffect(() => { loadPage('overview'); }, []);

    const openPage = (nextPage) => {
      setMenuOpen(false);
      loadPage(nextPage);
    };
    const refresh = () => loadPage(page, filters);
    const submitFilters = (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      loadPage(page, Object.fromEntries(Object.entries(values).filter(([, value]) => value)));
    };
    const setPageNumber = (nextPageNumber) => loadPage(page, { ...filters, page:String(nextPageNumber) });
    const downloadReport = async (event) => {
      event.preventDefault();
      setError('');
      setNotice('');
      const values = Object.fromEntries(new FormData(event.currentTarget).entries());
      const type = values.reportType;
      const params = new URLSearchParams(Object.fromEntries(Object.entries(values).filter(([key, value]) => key !== 'reportType' && value)));
      try {
        const response = await fetch(`/api/admin/reports/${encodeURIComponent(type)}.csv?${params}`, { headers:{ 'Authorization':`Bearer ${token}` } });
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          if (response.status === 401 || response.status === 403) {
            const authError = new Error(payload.message || 'Administrator authorization failed.');
            authError.code = payload.error;
            authError.status = response.status;
            authError.authFailure = true;
            throw authError;
          }
          const error = new Error(payload.message || `Report export failed (${response.status})`);
          error.code = payload.error || 'report_export_failed';
          error.status = response.status;
          throw error;
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = `agcro-${type}-report.csv`;
        link.click();
        URL.revokeObjectURL(url);
        setNotice(tx('{type} report downloaded. Files with no matching records contain column headers only.', { type:tx(type) }));
      } catch (requestError) {
        setError(localizedError(requestError));
        if (requestError.authFailure) onLogout(false);
      }
    };
    const acknowledge = async (alertId) => {
      if (!confirm(tx('Acknowledge this alert?'))) return;
      try {
        await adminRequest(`/api/alerts/${encodeURIComponent(alertId)}/acknowledge`, token, { method:'POST' });
        setNotice(tx('Alert acknowledged.'));
        refresh();
      } catch (requestError) {
        setError(localizedError(requestError));
        if (requestError.authFailure) onLogout(false);
      }
    };
    const revokeDevice = async (device) => {
      if (!confirm(tx('Revoke sensor device {id}? This blocks future readings using its credential.', { id:device.id }))) return;
      try {
        await adminRequest(`/api/admin/devices/${encodeURIComponent(device.id)}/revoke`, token, { method:'POST' });
        setNotice(tx('Device {id} revoked.', { id:device.id }));
        refresh();
      } catch (requestError) {
        setError(localizedError(requestError));
        if (requestError.authFailure) onLogout(false);
      }
    };
    const showFarmer = async (id) => {
      setError('');
      try {
        setDetail({ type:'loading' });
        setDetail({ type:'farmer', data:await adminRequest(`/api/admin/farmers/${encodeURIComponent(id)}`, token) });
      } catch (requestError) {
        setDetail(null);
        setError(localizedError(requestError));
      }
    };
    const showFarm = async (farmId) => {
      setError('');
      try {
        setDetail({ type:'loading' });
        setDetail({ type:'farm', data:await adminRequest(`/api/admin/farms/${encodeURIComponent(farmId)}`, token) });
      } catch (requestError) {
        setDetail(null);
        setError(localizedError(requestError));
      }
    };
    const showDevice = async (device) => {
      setError('');
      try {
        setDetail({ type:'loading' });
        const readings = await adminRequest(`/api/admin/readings?deviceId=${encodeURIComponent(device.id)}&pageSize=100`, token);
        setDetail({ type:'device', data:device, readings:readings.items || [] });
      } catch (requestError) {
        setDetail(null);
        setError(localizedError(requestError));
      }
    };

    const currentLabel = modules.find(([key]) => key === page)?.[1] || 'Overview';
    const farmSelect = (name = 'farmId') => fieldLabel('Farm', h('select', { name, defaultValue:filters[name] || '' },
      h('option', { value:'' }, 'All farms'),
      farmOptions.map((farm) => h('option', { key:farm.id, value:farm.id }, farm.name))
    ));
    const farmerSelect = () => fieldLabel('Farmer', h('select', { name:'farmerId', defaultValue:filters.farmerId || '' },
      h('option', { value:'' }, 'All farmers'),
      farmerOptions.map((farmer) => h('option', { key:farmer.id, value:farmer.id }, `${farmer.name} (${farmer.id})`))
    ));
    const dateFilters = () => [
      fieldLabel('From', h('input', { type:'date', name:'dateFrom', defaultValue:filters.dateFrom || '' })),
      fieldLabel('To', h('input', { type:'date', name:'dateTo', defaultValue:filters.dateTo || '' }))
    ];
    const filtersBar = (children) => h('form', { className:'card admin-filter-bar', onSubmit:submitFilters },
      children,
      h('div', { className:'admin-filter-actions' },
        h('button', { className:'btn', type:'submit', disabled:loading }, 'Apply filters'),
        h('button', { className:'btn secondary', type:'button', onClick:() => loadPage(page) }, 'Clear')
      )
    );
    const pageHeading = (title, description) => h('div', { className:'page-heading' },
      h('div', null, h('div', { className:'eyebrow' }, 'AGCRO · ADMIN'), h('h1', null, title), h('p', null, description))
    );

    let content = null;
    if (page === 'overview' && pageData?.overview) {
      const overview = pageData.overview;
      const metrics = overview.metrics;
      const readings = overview.recentReadings || [];
      const activities = overview.recentActivities || [];
      content = h('div', null,
        pageHeading('Farm network overview', 'Backend records only. Seeded and simulated data remain labeled; device presence requires a recent authenticated live reading.'),
        h('div', { className:'notice admin-demo-label' }, overview.demoData ? 'DEMO DATA · values reflect the development/demo store' : tx('Data mode: {mode}', { mode:localizedStatus(overview.dataMode) })),
        h('div', { className:'grid metric-grid admin-metrics' },
          [
            ['Registered farmers', metrics.farmers, 'Farmer records'], ['Registered farms', metrics.farms, 'Farm inventory'],
            ['Field zones', metrics.zones, 'Mapped zones'], ['Sensor devices', metrics.devices, 'Registered inventory'],
            ['Online devices', metrics.onlineDevices, 'Verified live reading within 15 minutes'],
            ['Offline / unverified', tx('{offline} / {unverified}', { offline:formatNumber(metrics.offlineDevices), unverified:formatNumber(metrics.unverifiedDevices) }), 'Stale / no authenticated live reading'],
            ['Revoked devices', metrics.revokedDevices, 'Credential disabled'], ['Active alerts', metrics.activeAlerts, 'Not acknowledged'],
            ['Activities / readings', tx('{activities} / {readings}', { activities:formatNumber(metrics.activities), readings:formatNumber(metrics.readings) }), 'Stored records']
          ].map(([label, value, sub]) => h(Metric, { key:label, label, value, sub }))
        ),
        h('div', { className:'grid content-grid admin-dashboard-grid' },
          h('section', { className:'card' }, h('h2', null, 'Recent farming activities'),
            table(['Date','Farmer','Farm','Zone','Activity','Source'], activities.map((item) => h('tr', { key:item.id },
              h('td', null, formatDate(item.date)), h('td', null, showText(item.farmer?.name)),
              h('td', null, showText(item.farmName)), h('td', null, showText(item.zoneName)),
              h('td', null, localizedStatus(item.type)), h('td', null, provenance(item.source))
            )), 'No farming activities recorded.')),
          h('section', { className:'card' }, h('h2', null, 'Recent sensor readings'),
            table(['Recorded','Farm / zone','Moisture','Temperature','Source'], readings.map((item) => h('tr', { key:item.id },
              h('td', null, dateTime(item.recordedAt)), h('td', null, `${showText(item.farmName)} / ${showText(item.zoneName)}`),
              h('td', null, item.soilMoisturePct == null ? '—' : `${formatNumber(item.soilMoisturePct)}%`),
              h('td', null, item.temperatureC == null ? '—' : `${formatNumber(item.temperatureC)} °C`), h('td', null, provenance(item.source))
            )), 'No sensor readings recorded.')),
          h('section', { className:'card' }, h('h2', null, 'Recent alerts'),
            overview.alerts.length ? overview.alerts.slice(0, 5).map((alert) => h('div', { className:`alert-item ${alert.severity === 'critical' ? 'critical' : ''}`, key:alert.id },
              h('div', { className:'alert-title-row' }, h('b', null, localizedStatus(alert.title)), h('span', { className:`severity ${alert.severity}` }, localizedStatus(alert.severity))),
              h('p', null, localizedStatus(alert.description)), h('div', { className:'metric-sub' }, `${showText(alert.farmName)} · ${dateTime(alert.createdAt)}`)
            )) : h('div', { className:'empty-state' }, 'No alerts are available.')
          ),
          h('section', { className:'card' }, h('h2', null, 'Recent administrative events'),
            overview.administrativeEvents?.available
              ? table(['Time','Action'], overview.administrativeEvents.items.map((event) => h('tr',{key:event.id},h('td',null,dateTime(event.createdAt)),h('td',null,localizedStatus(event.action)))), 'No admin events recorded.')
              : h('div', { className:'empty-state' }, 'Administrative actions are not audit-logged by the current demo store.')
          )
        )
      );
    } else if (page === 'farmers' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('Farmer management', 'Read-only farmer accounts and associated farm records. Password hashes and tokens are never returned.'),
        filtersBar([fieldLabel('Search name, username or phone', h('input', { name:'search', defaultValue:filters.search || '', placeholder:'Search farmers' })),
          fieldLabel('Sort by', h('select', { name:'sortBy', defaultValue:filters.sortBy || 'name' },
            ...[['name','Name'],['username','Username'],['createdAt','Registration date'],['farmCount','Farm count']].map(([value,label]) => h('option',{key:value,value},label)))),
          fieldLabel('Order', h('select', { name:'sortOrder', defaultValue:filters.sortOrder || 'asc' }, h('option',{value:'asc'},'Ascending'),h('option',{value:'desc'},'Descending'))), ...dateFilters()]),
        table(['Farmer','Username','Phone','Location','Farms','Registered',''], items.map((farmer) => h('tr', { key:farmer.id },
          h('td', null, h('b', null, showText(farmer.name)), h('div', { className:'metric-sub' }, showText(farmer.id))),
          h('td', null, showText(farmer.username)), h('td', null, showText(farmer.phone)), h('td', null, showText(farmer.location)),
          h('td', null, displayValue(farmer.farmCount)), h('td', null, dateTime(farmer.createdAt)),
          h('td', null, h('button', { className:'btn secondary', type:'button', onClick:() => showFarmer(farmer.id) }, 'View profile'))
        )), 'No farmer accounts match the filters.'),
        h('div', { className:'admin-pagination' }, tx('Page {page} · {total} farmers', { page:formatNumber(pageData.page), total:formatNumber(pageData.total) }),
          h('button', { className:'btn secondary', disabled:pageData.page <= 1, onClick:() => setPageNumber(pageData.page - 1) }, 'Previous'),
          h('button', { className:'btn secondary', disabled:pageData.page * pageData.pageSize >= pageData.total, onClick:() => setPageNumber(pageData.page + 1) }, 'Next'))
      );
    } else if (page === 'farms' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('Farm and zone inventory', 'Centralized, read-only view of farm configuration, crop history, soil records and field activity.'),
        filtersBar([fieldLabel('Search farm or location', h('input', { name:'search', defaultValue:filters.search || '', placeholder:'Search farms' })),
          farmerSelect(),
          fieldLabel('Sort by', h('select', { name:'sortBy', defaultValue:filters.sortBy || 'name' },
            ...[['name','Farm name'],['location','Location'],['areaAcres','Area'],['createdAt','Created date']].map(([value,label]) => h('option',{key:value,value},label)))),
          fieldLabel('Order', h('select', { name:'sortOrder', defaultValue:filters.sortOrder || 'asc' }, h('option',{value:'asc'},'Ascending'),h('option',{value:'desc'},'Descending'))), ...dateFilters()]),
        table(['Farm','Farmer','Area','Soil','Irrigation','Water available','Zones','Location',''], items.map((farm) => h('tr', { key:farm.id },
          h('td', null, h('b', null, showText(farm.name)), h('div', { className:'metric-sub' }, showText(farm.id))),
          h('td', null, showText(farm.farmer?.name)),           h('td', null, tx('{value} ac', { value:formatNumber(farm.areaAcres) })),
          h('td', null, showText(farm.soilType)), h('td', null, localizedStatus(farm.irrigationMethod)),
          h('td', null, `${formatNumber(farm.availableWaterLitres)} L`), h('td', null, displayValue(farm.zoneCount)),
          h('td', null, showText(farm.location)), h('td', null, h('button', { className:'btn secondary', type:'button', onClick:() => showFarm(farm.id) }, 'View records'))
        )), 'No farms match the filters.'),
        h('div', { className:'admin-pagination' }, tx('Page {page} · {total} farms', { page:formatNumber(pageData.page), total:formatNumber(pageData.total) }),
          h('button', { className:'btn secondary', disabled:pageData.page <= 1, onClick:() => setPageNumber(pageData.page - 1) }, 'Previous'),
          h('button', { className:'btn secondary', disabled:pageData.page * pageData.pageSize >= pageData.total, onClick:() => setPageNumber(pageData.page + 1) }, 'Next'))
      );
    } else if (page === 'devices' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('IoT device inventory', 'Presence is based on authenticated LIVE_SENSOR readings within the last 15 minutes. Demo and farmer-entered readings do not establish online status.'),
        filtersBar([farmSelect(), fieldLabel('Presence', h('select', { name:'status', defaultValue:filters.status || '' },
          h('option', { value:'' }, 'All statuses'), ...['online','offline','unverified','revoked'].map((value) => h('option', { key:value, value }, value))
        ))]),
        table(['Device ID','Farmer / farm','Zone','Status','Last authenticated','Credential status','Latest sensor reading','Action'], items.map((device) => h('tr', { key:device.id },
          h('td', null, h('b', null, showText(device.name)), h('div', { className:'metric-sub' }, showText(device.id))),
          h('td', null, `${showText(device.farmer?.name)} / ${showText(device.farmName)}`),
          h('td', null, `${showText(device.zoneName)} (${showText(device.zoneId)})`),
          h('td', null, h(Badge, { tone:device.status === 'online' ? 'live' : device.status === 'revoked' ? 'demo' : 'muted' }, localizedStatus(device.status))),
          h('td', null, device.lastAuthenticatedAt ? dateTime(device.lastAuthenticatedAt) : 'No authenticated live reading'),
          h('td', null, localizedStatus(device.credentialStatus)),
          h('td', null, device.latestReading ? `${formatNumber(device.latestReading.soilMoisturePct)}% · ${dateTime(device.latestReading.recordedAt)} · ${sourceLabel(device.latestReading.source)}` : 'No reading recorded'),
          h('td', null, h('button', { className:'btn secondary', onClick:() => showDevice(device) }, 'Details'),
            ' ', device.status === 'revoked' ? localizedStatus('revoked') : h('button', { className:'btn danger', onClick:() => revokeDevice(device) }, 'Revoke'))
        )), 'No sensor devices match the filters.')
      );
    } else if (page === 'readings' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('Sensor monitoring', 'Readings preserve source provenance; only LIVE_SENSOR indicates an authenticated device submission.'),
        filtersBar([fieldLabel('Device ID', h('input', { name:'deviceId', defaultValue:filters.deviceId || '' })), farmSelect(),
          fieldLabel('Zone ID', h('input', { name:'zoneId', defaultValue:filters.zoneId || '' })),
          fieldLabel('Source', h('select', { name:'source', defaultValue:filters.source || '' }, h('option', { value:'' }, 'All sources'), ...['LIVE_SENSOR','FARMER_ENTERED','SIMULATED_SENSOR'].map((value) => h('option', { key:value, value }, value)))),
          ...dateFilters()]),
        table(['Time','Device','Farm / zone','Moisture','Temperature','Humidity','Validity','Source'], items.map((reading) => h('tr', { key:reading.id },
          h('td', null, dateTime(reading.recordedAt)), h('td', null, showText(reading.deviceId)),
          h('td', null, `${showText(reading.farmName)} / ${showText(reading.zoneName)}`),
          h('td', null, reading.soilMoisturePct == null ? '—' : `${formatNumber(reading.soilMoisturePct)}%`),
          h('td', null, reading.temperatureC == null ? '—' : `${formatNumber(reading.temperatureC)} °C`),
          h('td', null, reading.humidityPct == null ? '—' : `${formatNumber(reading.humidityPct)}%`),
          h('td', null, localizedStatus(reading.validity)), h('td', null, provenance(reading.source))
        )), 'No sensor readings match the filters.'),
        h('div', { className:'admin-pagination' }, tx('Page {page} · {total} readings', { page:formatNumber(pageData.page), total:formatNumber(pageData.total) }),
          h('button', { className:'btn secondary', disabled:pageData.page <= 1, onClick:() => setPageNumber(pageData.page - 1) }, 'Previous'),
          h('button', { className:'btn secondary', disabled:pageData.page * pageData.pageSize >= pageData.total, onClick:() => setPageNumber(pageData.page + 1) }, 'Next'))
      );
    } else if (page === 'alerts' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('Alert management centre', 'Review stored alerts and acknowledge them through the existing authenticated alert API. This module does not generate alerts.'),
        filtersBar([fieldLabel('Search', h('input', { name:'search', defaultValue:filters.search || '', placeholder:'Title, description, farm or farmer' })),
          farmSelect(), fieldLabel('Severity', h('select', { name:'severity', defaultValue:filters.severity || '' },
            h('option', { value:'' }, 'All severities'), ...['info','warning','critical'].map((value) => h('option', { key:value, value }, value))),
          ), fieldLabel('Status', h('select', { name:'status', defaultValue:filters.status || '' },
            h('option', { value:'' }, 'All statuses'), h('option', { value:'active' }, 'Active'), h('option', { value:'acknowledged' }, 'Acknowledged'))), ...dateFilters()]),
        table(['Alert','Severity','Farmer / farm / zone','Created','Status','Source','Action'], items.map((alert) => h('tr', { key:alert.id },
          h('td', null, h('b', null, localizedStatus(alert.title)), h('div', { className:'metric-sub' }, localizedStatus(alert.description))),
          h('td', null, h('span', { className:`severity ${alert.severity}` }, localizedStatus(alert.severity))),
          h('td', null, `${showText(alert.farmer?.name)} / ${showText(alert.farmName)} / ${showText(alert.zoneName)}`),
          h('td', null, dateTime(alert.createdAt)),
          h('td', null, alert.acknowledged ? tx('Acknowledged · {date}', { date:dateTime(alert.acknowledgedAt) }) : localizedStatus('active')),
          h('td', null, provenance(alert.source)),
          h('td', null, alert.acknowledged ? '—' : h('button', { className:'btn secondary', onClick:() => acknowledge(alert.id) }, 'Acknowledge'))
        )), 'No stored alerts match the filters.')
      );
    } else if (page === 'decisions' && pageData) {
      const items = pageData.items || [];
      content = h('div', null, pageHeading('Agriculture decision review', 'Recommendation and profit figures are model estimates, not actual harvest outcomes. Existing decision records are read-only.'),
        filtersBar([farmSelect(), ...dateFilters()]),
        h('section', { className:'card' }, h('h2', null, 'Recorded decisions'),
          table(['Date','Farmer / farm','Category','Crop','Status','Summary','Source'], items.map((decision) => h('tr', { key:decision.id },
            h('td', null, dateTime(decision.createdAt)), h('td', null, `${showText(decision.farmer?.name)} / ${showText(decision.farmName)}`),
            h('td', null, localizedStatus(decision.category)), h('td', null, showText(decision.crop)),
            h('td', null, localizedStatus(decision.status)), h('td', null, showText(decision.summary || decision.question)),
            h('td', null, provenance(decision.source))
          )), 'No decision records match the filters.')),
        (pageData.scenarios || []).map((scenario) => h('section', { className:'card admin-scenario', key:scenario.farmId },
          h('h2', null, tx('Estimates · {farm} · {farmer}', { farm:scenario.farmName, farmer:showText(scenario.farmer?.name) })),
          h('p', { className:'card-description' }, tx('Recorded historical profit: {profit} · {seasons} actual seasons. Future figures are estimates only.', {
            profit:scenario.profit.actual.profit == null ? tx('Unavailable') : formatNumber(scenario.profit.actual.profit),
            seasons:formatNumber(scenario.profit.actual.seasons)
          })),
          h('p', { className:'metric-sub' }, tx('Engine {version} · {count} missing inputs · {generated}', {
            version:showText(scenario.dataQuality?.calculationVersion),
            count:formatNumber(scenario.dataQuality?.missingInputs?.length || 0),
            generated:dateTime(scenario.dataQuality?.generatedAt)
          })),
          h('p', { className:'metric-sub' }, tx('Current context available (not persisted as original decision inputs): {zones} zones · {soils} soil tests · {seasons} historical seasons · {activities} activities · Weather: {weather} · Sensor: {sensor}', {
            zones:formatNumber(scenario.supportingInputs.zones), soils:formatNumber(scenario.supportingInputs.soilTests),
            seasons:formatNumber(scenario.supportingInputs.historicalSeasons), activities:formatNumber(scenario.supportingInputs.recentActivities),
            weather:localizedStatus(scenario.supportingInputs.weatherSource), sensor:localizedStatus(scenario.supportingInputs.latestReadingSource)
          })),
          h('div', { className:'grid admin-scenario-grid' }, scenario.recommendations.map((recommendation) => h('article', { className:'metric-card', key:recommendation.category },
            h('div', { className:'metric-label' }, `${localizedStatus(recommendation.category)} · ${recommendation.crop || tx('No crop ranked')}`),
            h('div', { className:'metric-value' }, recommendation.available ? 'Reference-backed estimate' : 'Unavailable'),
            h('div', { className:'metric-sub' }, tx('Confidence: {level} · No unverified values shown', { level:localizedStatus(recommendation.confidence?.level || 'low') })),
            h('p', null, (recommendation.missingInputs || []).map(localizedStatus).join(' · '))
          ))),
          h('p', { className:'notice' }, tx('Profit assumptions: {assumptions}', {
            assumptions:(scenario.profit.future.assumptions || []).map(localizedStatus).join(' ')
          }))
        ))
      );
    } else if (page === 'weather' && pageData) {
      const items = pageData.items || [];
      const riskItems = pageData.risks || [];
      content = h('div', null, pageHeading('Weather and climate risk', `${localizedStatus(pageData.integrationMode)} · ${localizedStatus(pageData.note)}`),
        filtersBar([farmSelect(), ...dateFilters()]),
        table(['Observation date','Farm / zone association','Temperature','Rain','Humidity','Source','Last updated'], items.map((item, index) => h('tr', { key:`${item.id || item.date}-${index}` },
          h('td', null, formatDate(item.date)),
          h('td', null, item.farmId ? `${showText(item.farmName)} / ${showText(item.zoneName || 'All zones')} · ${showText(item.farmer?.name)}` : 'Not farm-specific'),
          h('td', null, item.temperatureC == null ? '—' : `${formatNumber(item.temperatureC)} °C`),
          h('td', null, item.rainfallMm == null ? '—' : `${formatNumber(item.rainfallMm)} mm`),
          h('td', null, item.humidityPct == null ? '—' : `${formatNumber(item.humidityPct)}%`),
          h('td', null, provenance(item.source)),
          h('td', null, item.updatedAt || item.recordedAt ? dateTime(item.updatedAt || item.recordedAt) : '—')
        )), 'No weather observations match the selected farm/date range.'),
        h('h2', { className:'admin-section-title' }, 'Current farm-level climate risk'),
        h('p', { className:'card-description' }, 'Rule-based assessments use each farm’s current weather, sensor and water context; observation date filters do not change these assessments. Review the reasons and affected zones before acting.'),
        table(['Farm / farmer','Zones','Drought','Flood / waterlogging','Confidence'], riskItems.flatMap((item) => {
          const drought = item.assessments?.find((risk) => risk.type === 'drought');
          const flood = item.assessments?.find((risk) => risk.type === 'flood_waterlogging');
          return [h('tr', { key:item.farmId },
            h('td', null, `${showText(item.farmName)} / ${showText(item.farmer?.name)}`),
            h('td', null, (item.zones || []).map((zone) => zone.name).join(', ') || tx('No zones')),
            h('td', null, `${localizedStatus(drought?.level)} (${showText(drought?.score)}) · ${tx('Affected: {zones}', { zones:(drought?.affectedZones || []).join(', ') || tx('None') })}`),
            h('td', null, `${localizedStatus(flood?.level)} (${showText(flood?.score)}) · ${tx('Affected: {zones}', { zones:(flood?.affectedZones || []).join(', ') || tx('None') })}`),
            h('td', null, `${localizedStatus(drought?.confidence?.level)} / ${localizedStatus(flood?.confidence?.level)}`)
          )];
        }), 'No farm risk assessments are available.')
      );
    } else if (page === 'reports') {
      content = h('div', null, pageHeading('Administrative reports', 'Export filtered records as CSV. Secrets, password hashes, bearer tokens and token hashes are excluded. Formula-leading strings are escaped.'),
        h('form', { className:'card admin-filter-bar', onSubmit:downloadReport },
          fieldLabel('Report', h('select', { name:'reportType' }, ...['farmers','farms','devices','readings','alerts','activities'].map((type) => h('option', { key:type, value:type }, type)))),
          farmSelect(), farmerSelect(), ...dateFilters(),
          h('div', { className:'admin-filter-actions' }, h('button', { className:'btn', type:'submit' }, 'Download CSV'))
        ),
        h('section', { className:'card' }, h('h2', null, 'Available report content'),
          h('p', null, 'Farmer profiles, farm and zone inventory, device credential status, sensor readings, alerts, and field activities. Empty filters produce a header-only CSV.')
        )
      );
    } else if (page === 'health' && pageData) {
      content = h('div', null, pageHeading('System health and integrations', 'Configuration status only; no secrets or environment variable values are shown.'),
        h('div', { className:'grid metric-grid admin-health-grid' },
          h(Metric, { label:'Backend API', value:pageData.api, sub:tx('Service: {service}', { service:pageData.service }) }),
          h(Metric, { label:'Application version', value:pageData.version, sub:tx('Generated {date}', { date:dateTime(pageData.generatedAt) }) }),
          h(Metric, { label:'Storage mode', value:pageData.storageMode, sub:'Development/demo storage' }),
          h(Metric, { label:'Database adapter', value:pageData.databaseAdapter, sub:'MySQL integration is not implemented' })
        ),
        h('section', { className:'card' }, h('h2', null, 'Integration status'),
          h('dl', { className:'admin-health-list' }, Object.entries(pageData.integrations || {}).map(([key, value]) =>
            h('div', { key }, h('dt', null, localizedStatus(key)), h('dd', null, localizedStatus(value)))
          )),
          h('p', { className:'notice' }, 'Demo weather is simulated. A configured provider is not live until verified and called. Device online status requires an authenticated LIVE_SENSOR reading.')
        )
      );
    }

    if (pageData?.items && pageData.total > pageData.pageSize && !['farmers','farms','readings'].includes(page)) {
      content = h(React.Fragment, null, content,
        h('div', { className:'admin-pagination' }, tx('Page {page} · {total} records', { page:formatNumber(pageData.page), total:formatNumber(pageData.total) }),
          h('button', { className:'btn secondary', disabled:pageData.page <= 1, onClick:() => setPageNumber(pageData.page - 1) }, 'Previous'),
          h('button', { className:'btn secondary', disabled:pageData.page * pageData.pageSize >= pageData.total, onClick:() => setPageNumber(pageData.page + 1) }, 'Next'))
      );
    }

    if (loading) content = h('div', { className:'card loading-state' }, h('div', { className:'spinner' }), h('p', null, 'Loading admin records…'));
    if (error) content = h('div', { className:'card admin-error', role:'alert' },
      h('h2', null, 'Unable to load this admin module'), h('p', null, error),
      h('button', { className:'btn', type:'button', onClick:refresh }, t('common.retry'))
    );

    let detailPanel = null;
    if (detail?.type === 'loading') {
      detailPanel = h('div', { className:'admin-modal-backdrop' }, h('section', { className:'card admin-modal', role:'dialog', 'aria-modal':'true' }, 'Loading farmer profile…'));
    } else if (detail?.type === 'farmer') {
      const farmer = detail.data;
      detailPanel = h('div', { className:'admin-modal-backdrop', onClick:(event) => { if (event.target === event.currentTarget) setDetail(null); } },
        h('section', { className:'card admin-modal', role:'dialog', 'aria-modal':'true', 'aria-labelledby':'detail-title' },
          h('div', { className:'inline-between' }, h('h2', { id:'detail-title' }, showText(farmer.name)), h('button', { className:'btn secondary', onClick:() => setDetail(null) }, 'Close')),
          h('dl', { className:'admin-health-list' }, [['Username', farmer.username],['Phone', farmer.phone],['Location', farmer.location],['Role', farmer.account?.role],['Registered', dateTime(farmer.account?.createdAt)]].map(([label, value]) =>
            h('div', { key:label }, h('dt', null, label), h('dd', null, showText(value)))
          )),
          (farmer.farms || []).map((farm) => h('section', { className:'admin-detail-section', key:farm.id },
            h('h3', null, tx('{farm} · {area} acres', { farm:farm.name, area:formatNumber(farm.areaAcres) })),
            h('p', null, `${farm.location} · ${farm.soilType} · ${farm.irrigationMethod}`),
            h('h4', null, 'Zones'),
            (farm.zones || []).map((zone) => h('p', { key:zone.id }, tx('{zone} ({id}) · {area} acres · {soil} · {crop} · Water: {water}', {
              zone:zone.name, id:zone.id, area:formatNumber(zone.areaAcres), soil:zone.soilType,
              crop:zone.currentCrop || tx('No current crop'), water:localizedStatus(zone.waterAvailability)
            }))),
            h('h4', null, 'Crop / season history'),
            (farm.seasons || []).map((season) => h('p', { key:season.id }, tx('{year} {season} · {crop} · yield {yield} quintals · {source}', {
              year:formatNumber(season.year), season:localizedStatus(season.season), crop:season.crop,
              yield:formatNumber(season.yieldQuintal), source:sourceLabel(season.source)
            }))),
            h('h4', null, 'Activity history'),
            (farm.activities || []).map((activity) => h('p', { key:activity.id }, tx('{date} · {type} · {quantity} {unit} · {source}', {
              date:formatDate(activity.date), type:localizedStatus(activity.type), quantity:formatNumber(activity.quantity),
              unit:activity.unit, source:sourceLabel(activity.source)
            })))
          ))
        )
      );
    } else if (detail?.type === 'farm') {
      const farm = detail.data;
      detailPanel = h('div', { className:'admin-modal-backdrop', onClick:(event) => { if (event.target === event.currentTarget) setDetail(null); } },
        h('section', { className:'card admin-modal', role:'dialog', 'aria-modal':'true', 'aria-labelledby':'detail-title' },
          h('div', { className:'inline-between' }, h('h2', { id:'detail-title' }, showText(farm.name)), h('button', { className:'btn secondary', onClick:() => setDetail(null) }, 'Close')),
          h('p', null, tx('{farmer} · {location} · {area} acres · {soil} · {irrigation}', {
            farmer:showText(farm.farmer?.name), location:farm.location, area:formatNumber(farm.areaAcres),
            soil:farm.soilType, irrigation:localizedStatus(farm.irrigationMethod)
          })),
          h('h3', null, 'Zones'),
          table(['Zone ID','Zone','Area','Soil','Irrigation','Current crop','Water availability','Sensor'], (farm.zones || []).map((zone) => h('tr', { key:zone.id },
            h('td', null, showText(zone.id)), h('td', null, showText(zone.name)), h('td', null, tx('{value} ac', { value:formatNumber(zone.areaAcres) })),
            h('td', null, showText(zone.soilType)), h('td', null, localizedStatus(farm.irrigationMethod)),
            h('td', null, showText(zone.currentCrop)), h('td', null, localizedStatus(zone.waterAvailability)), h('td', null, showText(zone.sensorId))
          )), 'No field zones recorded.'),
          h('h3', null, 'Soil records'),
          table(['Date','Zone','Parameter','Value','Source'], (farm.soilTests || []).map((soil) => h('tr', { key:soil.id },
            h('td', null, formatDate(soil.date)), h('td', null, showText(soil.zoneId)), h('td', null, localizedStatus(soil.parameter)),
            h('td', null, `${showText(soil.value)} ${showText(soil.unit)}`), h('td', null, provenance(soil.source))
          )), 'No soil tests recorded.'),
          h('h3', null, 'Crop and season history'),
          (farm.seasons || []).map((season) => h('p', { key:season.id }, tx('{year} {season} · {crop} · yield {yield} quintals · {source}', {
            year:formatNumber(season.year), season:localizedStatus(season.season), crop:season.crop,
            yield:formatNumber(season.yieldQuintal), source:sourceLabel(season.source)
          }))),
          h('h3', null, 'Activities'),
          (farm.activities || []).map((activity) => h('p', { key:activity.id }, tx('{date} · {type} · {quantity} {unit} · {source}', {
            date:formatDate(activity.date), type:localizedStatus(activity.type), quantity:formatNumber(activity.quantity),
            unit:activity.unit, source:sourceLabel(activity.source)
          })))
        )
      );
    } else if (detail?.type === 'device') {
      const { data:device, readings } = detail;
      detailPanel = h('div', { className:'admin-modal-backdrop', onClick:(event) => { if (event.target === event.currentTarget) setDetail(null); } },
        h('section', { className:'card admin-modal', role:'dialog', 'aria-modal':'true', 'aria-labelledby':'detail-title' },
          h('div', { className:'inline-between' }, h('h2', { id:'detail-title' }, `${showText(device.name)} · ${showText(device.id)}`),
            h('button', { className:'btn secondary', onClick:() => setDetail(null) }, 'Close')),
          h('dl', { className:'admin-health-list' },
            [['Farmer',device.farmer?.name],['Farm',device.farmName],['Zone',device.zoneName],['Presence',device.status],
              ['Last authenticated communication',dateTime(device.lastAuthenticatedAt)],['Credential status',device.credentialStatus],
              ['Revoked at',dateTime(device.revokedAt)],['Firmware',device.firmware],['Provisioning source',device.source]]
              .map(([label,value]) => h('div',{key:label},h('dt',null,label),h('dd',null,showText(value)))),
          ),
          h('h3', null, 'Device readings'),
          table(['Time','Moisture','Temperature','Humidity','Validity','Source'], readings.map((reading) => h('tr',{key:reading.id},
            h('td',null,dateTime(reading.recordedAt)),h('td',null,reading.soilMoisturePct == null ? '—' : `${reading.soilMoisturePct}%`),
            h('td',null,reading.temperatureC == null ? '—' : `${reading.temperatureC} °C`),
            h('td',null,reading.humidityPct == null ? '—' : `${reading.humidityPct}%`),
            h('td', null, localizedStatus(reading.validity)),h('td',null,provenance(reading.source))
          )), 'No readings are associated with this device.')
        )
      );
    }

    const sidebar = h('aside', { className:`sidebar admin-sidebar ${menuOpen ? 'open' : ''}` },
      h('div', { className:'brand-lockup' }, h('div', { className:'brand-mark' }, 'A'),
        h('div', null, h('div', { className:'brand-name' }, 'AGCRO'), h('div', { className:'brand-sub' }, 'Admin console'))),
      h('div', { className:'notice' }, 'ADMIN AUTHENTICATED', h('br'), 'Identity verified by server'),
      h('nav', { className:'nav-list admin-nav', 'aria-label':'Admin modules' }, modules.map(([key, label, icon]) =>
        h('button', { key, type:'button', className:`nav-link admin-nav-button ${page === key ? 'active' : ''}`, onClick:() => openPage(key) },
          h('span', { className:'nav-icon', 'aria-hidden':true }, icon), h('span', null, label)
        )
      )),
      h('div', { className:'sidebar-bottom' },
        h('button', { className:'btn secondary', style:{ width:'100%', marginBottom:8 }, onClick:onLogout }, t('auth.logout')),
        h('a', { href:'/', className:'admin-link' }, '← ', t('admin.farmerApp'))
      )
    );
    const header = h('header', { className:'topbar' },
      h('button', { className:'icon-button admin-menu-button', type:'button', 'aria-label':tx('Open navigation'), 'aria-expanded':String(menuOpen), onClick:() => setMenuOpen(!menuOpen) }, '☰'),
      h('div', { className:'breadcrumbs' }, h('span', null, 'AGCRO'), h('span', { className:'crumb-divider' }, '/'), h('strong', null, currentLabel)),
      h('div', { className:'topbar-actions' },
        h(LanguageSwitch, { lang, onChange }),
        h(Badge, { tone:'engine' }, 'ADMIN · VERIFIED'),
        h('button', { className:'btn secondary admin-topbar-refresh', type:'button', 'aria-label':t('common.refresh'), title:t('common.refresh'), onClick:refresh, disabled:loading }, t('common.refresh')),
        h('button', { className:'btn secondary admin-header-logout', type:'button', onClick:onLogout }, t('auth.logout'))
      )
    );

    return h('div', { className:'app-shell admin-app-shell' },
      sidebar,
      h('main', { className:'main-content' }, header,
        h('div', { className:'page-wrap admin-page-wrap' },
          notice ? h('div', { className:'notice admin-success', role:'status' }, notice) : null,
          content
        )
      ),
      detailPanel
    );
  }

  function AdminApp() {
    const storedLanguage = localStorage.getItem(LOCALE_KEY);
    const browserLanguage = (navigator.language || '').toLowerCase();
    const initialLanguage = ['en','mr','hi'].includes(storedLanguage) ? storedLanguage
      : browserLanguage.startsWith('hi') ? 'hi' : browserLanguage.startsWith('en') ? 'en' : 'mr';
    const [lang, setLang] = useState(initialLanguage);
    const [ready, setReady] = useState(false);
    const [localeError, setLocaleError] = useState('');
    const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || '');
    const [logoutError, setLogoutError] = useState('');

    const loadLocale = async (next) => {
      if (!['en','mr','hi'].includes(next)) throw new Error('Unsupported language selection.');
      const response = await fetch(`/locales/${next}.json`);
      if (!response.ok) throw new Error('Could not load the selected language file.');
      locale = await response.json();
      currentLang = next;
      setLang(next);
      document.documentElement.lang = next;
      document.title = tx('AGCRO · Admin Console');
      localStorage.setItem(LOCALE_KEY, next);
      setReady(true);
    };
    useEffect(() => {
      loadLocale(lang).catch(() => setLocaleError('Could not load the selected language file.'));
    }, []);

    const changeLanguage = (next) => loadLocale(next).catch(() => window.alert(tx('Could not load the selected language file.')));
    const handleLoginSuccess = (newToken) => {
      setLogoutError('');
      setToken(newToken);
      localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
    };
    const handleLogout = async (callServer = true) => {
      const currentToken = localStorage.getItem(ADMIN_TOKEN_KEY);
      let failure = '';
      if (callServer && currentToken) {
        try {
          await adminRequest('/api/auth/logout', currentToken, { method:'POST' });
        } catch (error) {
          failure = localizedError(error);
        }
      }
      setToken('');
      localStorage.removeItem(ADMIN_TOKEN_KEY);
      setLogoutError(failure ? tx('Admin session cleared locally; server logout reported: {error}', { error:failure }) : '');
    };

    if (localeError) return h('div', { className:'page-wrap' }, h('div', { className:'card admin-error', role:'alert' }, tx(localeError)));
    if (!ready) return h('div', { className:'page-wrap loading-state' }, h('div', { className:'spinner' }), h('p', null, tx('Loading admin console…')));
    if (!token) return h('div', null,
      logoutError ? h('div', { className:'notice admin-logout-error', role:'status' }, logoutError) : null,
      h(AdminLogin, { onLoginSuccess:handleLoginSuccess, lang, onChange:changeLanguage })
    );
    return h(AdminDashboard, { token, onLogout:handleLogout, lang, onChange:changeLanguage });
  }

  ReactDOM.createRoot(document.getElementById('admin-root')).render(h(AdminApp));
})();
