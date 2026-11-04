(() => {
  const { useEffect, useMemo, useState } = React;
  const h = React.createElement;
  const LOCALE_KEY = 'agcro-language';
  const ADMIN_TOKEN_KEY = 'agcro-admin-token';
  let locale = null;
  let currentLang = 'mr';
  const getPath = (object, path) => path.split('.').reduce((current, part) => current == null ? undefined : current[part], object);
  const t = (key, vars = {}) => {
    const value = getPath(locale || {}, key);
    if (value === undefined) return key;
    if (typeof value !== 'string') return value;
    return value.replace(/\{(\w+)\}/g, (_, name) => vars[name] ?? '');
  };
  const dataLabel = (value) => {
    const translated = getPath(locale || {}, `data.${value}`);
    return typeof translated === 'string' ? translated : value;
  };
  const dateTime = (value) => value ? new Date(value).toLocaleString({ mr:'mr-IN', hi:'hi-IN', en:'en-IN' }[currentLang] || 'en-IN', { dateStyle:'medium', timeStyle:'short' }) : '—';
  const sourceTone = (source) => ({ LIVE_SENSOR:'live', EXTERNAL_API:'external', FARMER_ENTERED:'farmer', SIMULATED_SENSOR:'demo', SIMULATED_WEATHER:'demo', DECISION_ENGINE:'engine' }[source] || 'muted');
  const sourceLabel = (source) => {
    const keys = { LIVE_SENSOR:'common.liveSensor', EXTERNAL_API:'common.externalApi', FARMER_ENTERED:'common.farmerEntered', SIMULATED_SENSOR:'common.simulated', SIMULATED_WEATHER:'common.simulated', DECISION_ENGINE:'common.decisionEngine' };
    return keys[source] ? t(keys[source]) : source || 'Unknown';
  };

  function Badge({ children, tone = 'engine' }) {
    return h('span', { className:`provenance ${tone}` }, children);
  }

  function LanguageSwitch({ lang, onChange }) {
    return h('div', { className:'language-switcher', role:'group', 'aria-label':t('language.label') },
      h('button', { type:'button', className:`language-button ${lang === 'mr' ? 'selected' : ''}`, onClick:() => onChange('mr') }, t('language.marathi')),
      h('button', { type:'button', className:`language-button ${lang === 'en' ? 'selected' : ''}`, onClick:() => onChange('en') }, t('language.english')),
      h('button', { type:'button', className:`language-button ${lang === 'hi' ? 'selected' : ''}`, onClick:() => onChange('hi') }, t('language.hindi'))
    );
  }

  function AdminLogin({ onLoginSuccess, lang, onChange }) {
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('admin123');
    const [loginError, setLoginError] = useState('');
    const [loading, setLoading] = useState(false);

    const submitLogin = async (u, p) => {
      setLoginError('');
      setLoading(true);
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: u, password: p })
        });
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message || 'Authentication failed');
        }
        if (payload.data?.user?.role !== 'ADMIN') {
          throw new Error('Access denied: account does not have administrator privileges');
        }
        onLoginSuccess(payload.data.token, payload.data.user);
      } catch (err) {
        setLoginError(err.message);
      } finally {
        setLoading(false);
      }
    };

    return h('div', { className:'app-shell' },
      h('main', { className:'main-content', style:{ marginLeft:0, width:'100%' } },
        h('div', { className:'page-wrap', style:{ maxWidth:640, margin:'0 auto' } },
          h('div', { className:'admin-login-top' },
            h('div', { className:'brand-lockup' },
              h('div', { className:'brand-mark' }, 'A'),
              h('div', null,
                h('div', { className:'brand-name' }, 'AGCRO'),
                h('div', { className:'brand-sub' }, t('brand.sub'))
              )
            ),
            h(LanguageSwitch, { lang, onChange })
          ),
          h('section', { className:'hero-card' },
            h('div', { className:'eyebrow' }, t('admin.roleBoundary')),
            h('h2', null, t('admin.reviewNetwork')),
            h('p', null, 'Enter administrator credentials to access system telemetry, device controls, and cross-farm oversight.'),
            loginError ? h('div', { className:'alert-item critical', style:{ margin:'12px 0' } }, loginError) : null,
            h('form', {
              onSubmit: (e) => {
                e.preventDefault();
                submitLogin(username, password);
              },
              style: { marginTop: 16 }
            },
              h('div', { className:'form-field', style:{ marginBottom: 12 } },
                h('label', null, t('auth.username'),
                  h('input', {
                    type: 'text',
                    value: username,
                    onChange: (e) => setUsername(e.target.value),
                    required: true,
                    style: { width: '100%', padding: '10px', marginTop: 4 }
                  })
                )
              ),
              h('div', { className:'form-field', style:{ marginBottom: 16 } },
                h('label', null, t('auth.password'),
                  h('input', {
                    type: 'password',
                    value: password,
                    onChange: (e) => setPassword(e.target.value),
                    required: true,
                    style: { width: '100%', padding: '10px', marginTop: 4 }
                  })
                )
              ),
              h('div', { className:'hero-action', style:{ display:'flex', gap:10, flexWrap:'wrap' } },
                h('button', { className:'btn', type:'submit', disabled:loading }, loading ? 'Authenticating…' : t('auth.signIn')),
                h('button', {
                  type:'button',
                  className:'btn secondary',
                  onClick: () => submitLogin('admin', 'admin123'),
                  disabled: loading
                }, t('auth.demoAdmin')),
                h('a', { className:'btn secondary', href:'/' }, t('admin.farmerApp'))
              )
            )
          ),
          h('div', { className:'notice', style:{ marginTop:14 } }, 'Server-side identity verification enforced. Client role headers are strictly ignored.')
        )
      )
    );
  }

  function Metric({ label, value, sub }) {
    return h('div', { className:'metric-card' },
      h('div', { className:'metric-label' }, label),
      h('div', { className:'metric-value' }, value),
      h('div', { className:'metric-sub' }, sub)
    );
  }

  function Overview({ data, onRefresh, onLogout, token, lang, onChange }) {
    const [search, setSearch] = useState('');
    const m = data.metrics;
    const filteredFarms = useMemo(() => data.farms.filter((farm) => `${farm.name} ${farm.location} ${farm.farmer?.name}`.toLowerCase().includes(search.toLowerCase())), [data.farms, search]);

    const exportData = () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'agcro-admin-overview.json';
      link.click();
      URL.revokeObjectURL(url);
    };

    const revokeDevice = async (deviceId) => {
      if (!confirm(`Are you sure you want to revoke sensor device ${deviceId}?`)) return;
      try {
        const response = await fetch(`/api/admin/devices/${encodeURIComponent(deviceId)}/revoke`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) throw new Error('Revocation failed');
        onRefresh();
      } catch (err) {
        alert(err.message);
      }
    };

    const farmRows = filteredFarms.map((farm) => h('tr', { key:farm.id },
      h('td', null, h('b', null, farm.name), h('div', { className:'metric-sub' }, farm.location)),
      h('td', null, farm.farmer?.name),
      h('td', null, farm.zoneCount),
      h('td', null, farm.latestReading ? `${farm.latestReading.soilMoisturePct}% · ${dateTime(farm.latestReading.recordedAt)}` : t('common.noData')),
      h('td', null, h(Badge, { tone:sourceTone(farm.latestReading?.source) }, sourceLabel(farm.latestReading?.source)))
    ));

    const deviceRows = data.devices.map((device) => h('div', { className:'action-item', key:device.id },
      h('div', { className:`action-mark ${device.status === 'revoked' ? 'risk-mark' : device.status === 'offline' ? 'warning-mark' : ''}` },
        device.status === 'revoked' ? '✕' : device.status === 'offline' ? '!' : '◌'
      ),
      h('div', null,
        h('div', { className:'inline-between' },
          h('b', null, device.name),
          h('div', { style:{ display:'flex', gap:6, alignItems:'center' } },
            h(Badge, { tone: device.status === 'revoked' ? 'demo' : sourceTone(device.source) },
              device.status === 'revoked' ? 'Revoked' : sourceLabel(device.source)
            ),
            device.status !== 'revoked' ? h('button', {
              className: 'btn secondary',
              style: { padding: '3px 8px', fontSize: '11px' },
              onClick: () => revokeDevice(device.id)
            }, 'Revoke') : null
          )
        ),
        h('p', null, `${dataLabel(device.status)} · ${t('admin.latestReading')} ${dateTime(device.lastReadingAt)}`),
        h('div', { className:'metric-sub' }, `Device ID: ${device.id} · Zone ${device.zoneId || '—'} · ${device.firmware || '—'}`)
      )
    ));

    const alertRows = data.alerts.length ? data.alerts.map((alert) => h('div', { className:`alert-item ${alert.severity === 'critical' ? 'critical' : ''}`, key:alert.id },
      h('div', { className:'alert-title-row' },
        h('b', null, dataLabel(alert.title)),
        h('span', { className:`severity ${alert.severity}` }, dataLabel(alert.severity))
      ),
      h('p', null, dataLabel(alert.message)),
      h('div', { className:'metric-sub' }, `${dateTime(alert.createdAt)} · ${alert.acknowledged ? t('common.review') : t('admin.needsReview')}`)
    )) : h('div', { className:'empty-state' }, t('common.noData'));

    const decisionRows = data.decisions.length ? data.decisions.map((decision) => h('div', { className:'action-item', key:decision.id },
      h('div', { className:'action-mark' }, '✓'),
      h('div', null,
        h('b', null, decision.crop || decision.category),
        h('p', null, `${dataLabel(decision.status)} · ${dateTime(decision.createdAt)}`)
      )
    )) : h('div', { className:'empty-state' }, t('recommendations.noDecisions'));

    const sidebar = h('aside', { className:'sidebar admin-sidebar' },
      h('div', { className:'brand-lockup' },
        h('div', { className:'brand-mark' }, 'A'),
        h('div', null,
          h('div', { className:'brand-name' }, 'AGCRO'),
          h('div', { className:'brand-sub' }, t('admin.overview'))
        )
      ),
      h('div', { className:'notice' }, 'ADMIN IDENTIFIED', h('br'), 'Role: ADMIN (Server Verified)'),
      h('nav', { className:'nav-list admin-nav', 'aria-label':t('admin.overview') },
        h('a', { href:'#overview', className:'nav-link active' }, '⌂', h('span', null, t('admin.overview'))),
        h('a', { href:'#coverage', className:'nav-link' }, '◌', h('span', null, t('admin.coverage'))),
        h('a', { href:'#alerts', className:'nav-link' }, '!', h('span', null, t('admin.activeAlerts'))),
        h('a', { href:'#decisions', className:'nav-link' }, '✓', h('span', null, t('admin.decisions')))
      ),
      h('div', { className:'sidebar-bottom' },
        h('button', {
          className:'btn secondary',
          style:{ width:'100%', marginBottom:8 },
          onClick: onLogout
        }, t('auth.logout')),
        h('a', { href:'/', className:'admin-link' }, '← ', t('admin.farmerApp'))
      )
    );

    const header = h('header', { className:'topbar' },
      h('div', { className:'breadcrumbs' },
        h('span', null, 'AGCRO'),
        h('span', { className:'crumb-divider' }, '/'),
        h('strong', null, t('admin.overview'))
      ),
      h('div', { className:'topbar-actions' },
        h(LanguageSwitch, { lang, onChange }),
        h(Badge, { tone:'engine' }, 'ADMIN SECURED'),
        h('button', { className:'btn secondary', onClick:exportData }, t('admin.export')),
        h('button', { className:'btn secondary', onClick:onLogout }, t('auth.logout'))
      )
    );

    const heading = h('div', { className:'page-heading' },
      h('div', null,
        h('div', { className:'eyebrow' }, t('admin.systemHealth')),
        h('h1', null, t('admin.overviewTitle')),
        h('p', null, t('admin.overviewDescription'))
      ),
      h('div', { className:'heading-actions' },
        h('button', { className:'btn', onClick:onRefresh }, t('common.refresh'))
      )
    );

    const metrics = h('div', { id:'overview', className:'grid metric-grid' },
      h(Metric, { label:t('admin.farmers'), value:m.farmers, sub:t('admin.registered') }),
      h(Metric, { label:t('admin.farmsZones'), value:`${m.farms} / ${m.zones}`, sub:t('admin.mapped') }),
      h(Metric, { label:t('admin.iotOnline'), value:`${m.onlineDevices}/${m.devices}`, sub:t('admin.deviceStatus') }),
      h(Metric, { label:t('admin.activeAlerts'), value:m.activeAlerts, sub:t('admin.needsReview') }),
      h(Metric, { label:t('admin.offline'), value:m.offlineDevices ?? 0, sub:t('admin.deviceStatus') }),
      h(Metric, { label:t('admin.highRisk'), value:m.highRiskFarms ?? 0, sub:t('admin.needsReview') })
    );

    const coverage = h('section', { id:'coverage', className:'card' },
      h('div', { className:'card-header' },
        h('div', null,
          h('h2', null, t('admin.coverage')),
          h('p', { className:'card-description' }, t('admin.coverageDesc'))
        ),
        h(Badge, { tone:'engine' }, t('common.decisionEngine'))
      ),
      h('div', { className:'admin-toolbar' },
        h('label', { className:'search-field' },
          h('span', { className:'sr-only' }, t('admin.search')),
          h('input', {
            value:search,
            onChange:(event) => setSearch(event.target.value),
            placeholder:t('admin.search'),
            'aria-label':t('admin.search')
          })
        )
      ),
      h('div', { className:'table-scroll' },
        h('table', { className:'data-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, t('admin.overview')),
              h('th', null, t('admin.owner')),
              h('th', null, t('memory.zones')),
              h('th', null, t('admin.latestReading')),
              h('th', null, t('common.source'))
            )
          ),
          h('tbody', null, farmRows)
        )
      )
    );

    const devices = h('section', { className:'card' },
      h('div', { className:'card-header' },
        h('div', null,
          h('h2', null, t('admin.registry')),
          h('p', { className:'card-description' }, t('admin.registryDesc'))
        ),
        h(Badge, { tone:'demo' }, t('common.simulated'))
      ),
      deviceRows
    );

    const alerts = h('section', { id:'alerts', className:'card' },
      h('div', { className:'card-header' },
        h('div', null,
          h('h2', null, t('admin.activeAlerts')),
          h('p', { className:'card-description' }, t('admin.alertsDesc'))
        ),
        h(Badge, { tone:'engine' }, t('common.decisionEngine'))
      ),
      alertRows
    );

    const decisions = h('section', { id:'decisions', className:'card' },
      h('div', { className:'card-header' },
        h('div', null,
          h('h2', null, t('admin.decisions')),
          h('p', { className:'card-description' }, t('admin.decisionsDesc'))
        ),
        h(Badge, { tone:'farmer' }, t('common.farmerRecord'))
      ),
      decisionRows
    );

    const analytics = h('section', { className:'card' },
      h('div', { className:'card-header' },
        h('div', null,
          h('h2', null, t('admin.analytics')),
          h('p', { className:'card-description' }, t('admin.analyticsDesc'))
        ),
        h(Badge, { tone:'engine' }, t('common.decisionEngine'))
      ),
      h('div', { className:'admin-bars' },
        h('div', null,
          h('span', null, t('admin.connected')),
          h('i', { style:{ width:`${m.devices ? Math.round(m.onlineDevices / m.devices * 100) : 0}%` } }),
          h('b', null, `${m.devices ? Math.round(m.onlineDevices / m.devices * 100) : 0}%`)
        ),
        h('div', null,
          h('span', null, t('admin.alertLoad')),
          h('i', { style:{ width:`${Math.min(100, m.activeAlerts * 15)}%` } }),
          h('b', null, m.activeAlerts)
        ),
        h('div', null,
          h('span', null, t('admin.farmCoverage')),
          h('i', { style:{ width:`${m.zones ? 100 : 0}%` } }),
          h('b', null, `${m.zones} ${t('memory.zones')}`)
        )
      )
    );

    const content = h('div', { className:'grid content-grid' },
      h('div', { className:'section-stack' }, coverage, devices),
      h('div', { className:'section-stack' }, alerts, decisions, analytics)
    );

    return h('div', { className:'app-shell' },
      sidebar,
      h('main', { className:'main-content' },
        header,
        h('div', { className:'page-wrap' }, heading, metrics, content)
      )
    );
  }

  function AdminApp() {
    const [lang, setLang] = useState(localStorage.getItem(LOCALE_KEY) || ((navigator.language || '').toLowerCase().startsWith('en') ? 'en' : 'mr'));
    const [ready, setReady] = useState(false);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || '');

    const loadLocale = async (next) => {
      const response = await fetch(`/locales/${next}.json`);
      locale = await response.json();
      currentLang = next;
      setLang(next);
      localStorage.setItem(LOCALE_KEY, next);
      setReady(true);
    };

    const load = async () => {
      if (!token) return;
      setError('');
      try {
        const response = await fetch('/api/admin/overview', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const payload = await response.json();
        if (response.status === 401 || response.status === 403) {
          setToken('');
          localStorage.removeItem(ADMIN_TOKEN_KEY);
          throw new Error(payload.message || 'Administrator session expired. Please log in again.');
        }
        if (!response.ok) throw new Error(payload.message || 'Failed to fetch admin overview');
        setData(payload.data);
      } catch (err) {
        setError(err.message);
      }
    };

    useEffect(() => { loadLocale(lang); }, []);
    useEffect(() => { if (ready && token) load(); }, [ready, token]);

    const changeLanguage = (next) => {
      loadLocale(next).then(() => data && load());
    };

    const handleLoginSuccess = (newToken) => {
      setToken(newToken);
      localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
    };

    const handleLogout = () => {
      setToken('');
      setData(null);
      localStorage.removeItem(ADMIN_TOKEN_KEY);
    };

    if (!ready) return h('div', { className:'page-wrap loading-state' }, h('div', { className:'spinner' }), h('p', null, t('common.loading')));
    if (!token) return h(AdminLogin, { onLoginSuccess:handleLoginSuccess, lang, onChange:changeLanguage });
    if (error) return h('div', { className:'page-wrap' },
      h('div', { className:'card' },
        h('h2', null, t('errors.admin')),
        h('p', { className:'card-description' }, error),
        h('div', { style:{ display:'flex', gap:10, marginTop:12 } },
          h('button', { className:'btn', onClick:load }, t('common.retry')),
          h('button', { className:'btn secondary', onClick:handleLogout }, t('auth.logout'))
        )
      )
    );
    if (!data) return h('div', { className:'page-wrap loading-state' }, h('div', { className:'spinner' }), h('p', null, t('common.loading')));

    return h(Overview, { data, onRefresh:load, onLogout:handleLogout, token, lang, onChange:changeLanguage });
  }

  ReactDOM.createRoot(document.getElementById('admin-root')).render(h(AdminApp));
})();
