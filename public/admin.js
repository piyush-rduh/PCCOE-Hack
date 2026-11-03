(() => {
  const { useEffect, useState } = React;
  const h = React.createElement;
  const money = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

  function Badge({ children, tone = 'engine' }) {
    return h('span', { className: `provenance ${tone}` }, children);
  }

  function AdminLogin({ onEnter }) {
    return h('div', { className: 'app-shell' },
      h('main', { className: 'main-content', style: { marginLeft: 0, width: '100%' } },
        h('div', { className: 'page-wrap', style: { maxWidth: 680, margin: '0 auto' } },
          h('div', { className: 'brand-lockup', style: { padding: '0 0 30px' } },
            h('div', { className: 'brand-mark' }, 'A'),
            h('div', null, h('div', { className: 'brand-name' }, 'AGCRO'), h('div', { className: 'brand-sub' }, 'Admin console'))
          ),
          h('section', { className: 'hero-card' },
            h('div', { className: 'eyebrow' }, 'Role boundary'),
            h('h2', null, 'Review the farm network with care.'),
            h('p', null, 'This MVP admin surface requires an explicit admin role header. Production should replace the demo gate with Manus OAuth role claims and farmer-record authorization.'),
            h('div', { className: 'hero-action' },
              h('button', { className: 'btn', onClick: onEnter }, 'Enter demo admin console'),
              h('a', { className: 'btn secondary', href: '/' }, 'Back to farmer view')
            )
          ),
          h('div', { className: 'notice', style: { marginTop: 14 } }, 'Demo mode only. This does not create a production administrator account.')
        )
      )
    );
  }

  function Overview({ data, onRefresh }) {
    const m = data.metrics;
    const exportData = () => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'agcro-admin-overview.json'; link.click(); URL.revokeObjectURL(url);
    };
    const farmRows = data.farms.map((farm) => h('tr', { key: farm.id },
      h('td', null, h('b', null, farm.name), h('div', { className: 'metric-sub' }, farm.location)),
      h('td', null, farm.farmer?.name),
      h('td', null, farm.zoneCount),
      h('td', null, farm.latestReading ? `${farm.latestReading.soilMoisturePct}% moisture · ${new Date(farm.latestReading.recordedAt).toLocaleString()}` : 'No reading'),
      h('td', null, h(Badge, { tone: 'demo' }, farm.latestReading?.source || 'FARMER_ENTERED'))
    ));
    const deviceRows = data.devices.map((device) => h('div', { className: 'action-item', key: device.id },
      h('div', { className: 'action-mark' }, '◌'),
      h('div', null, h('b', null, device.name), h('p', null, `${device.status} · zone ${device.zoneId} · last ${new Date(device.lastReadingAt).toLocaleString()}`), h(Badge, { tone: 'demo' }, device.source))
    ));
    const alertRows = data.alerts.length ? data.alerts.map((alert) => h('div', { className: `alert-item ${alert.severity === 'critical' ? 'critical' : ''}`, key: alert.id }, h('b', null, alert.title), h('p', null, alert.message), h('div', { className: 'metric-sub' }, `${alert.category} · ${new Date(alert.createdAt).toLocaleString()}`))) : h('div', { className: 'empty-state' }, 'No alerts');
    const decisionRows = data.decisions.length ? data.decisions.map((decision) => h('div', { className: 'action-item', key: decision.id }, h('div', { className: 'action-mark' }, '✓'), h('div', null, h('b', null, decision.crop || decision.category), h('p', null, `${decision.status} · ${new Date(decision.createdAt).toLocaleString()}`)))) : h('div', { className: 'empty-state' }, 'No decisions recorded');
    return h('div', { className: 'app-shell' },
      h('aside', { className: 'sidebar' },
        h('div', { className: 'brand-lockup' }, h('div', { className: 'brand-mark' }, 'A'), h('div', null, h('div', { className: 'brand-name' }, 'AGCRO'), h('div', { className: 'brand-sub' }, 'Admin console'))),
        h('div', { className: 'notice' }, 'Role: admin-demo', h('br'), 'Read-only operational review.'),
        h('div', { className: 'sidebar-bottom' }, h('a', { href: '/', className: 'admin-link' }, '← Farmer application'), h('div', { className: 'sidebar-note' }, 'Production authorization should use verified Manus OAuth claims and farmer-owned record permissions.'))
      ),
      h('main', { className: 'main-content' },
        h('header', { className: 'topbar' }, h('div', { className: 'breadcrumbs' }, h('span', null, 'AGCRO'), h('span', { className: 'crumb-divider' }, '/'), h('strong', null, 'Admin overview')), h('div', { className: 'topbar-actions' }, h(Badge, { tone: 'demo' }, 'Demo data'), h('button', { className: 'btn secondary', onClick: exportData }, 'Export overview'))),
        h('div', { className: 'page-wrap' },
          h('div', { className: 'page-heading' }, h('div', null, h('div', { className: 'eyebrow' }, 'System health'), h('h1', null, 'One view of the farm network.'), h('p', null, 'Monitor farmers, farms, zones, devices, alerts, and decision history without silently changing farmer-owned records.')), h('div', { className: 'heading-actions' }, h('button', { className: 'btn', onClick: onRefresh }, 'Refresh'))),
          h('div', { className: 'grid metric-grid' },
            h('div', { className: 'metric-card' }, h('div', { className: 'metric-label' }, 'Farmers'), h('div', { className: 'metric-value' }, m.farmers), h('div', { className: 'metric-sub' }, 'registered records')),
            h('div', { className: 'metric-card' }, h('div', { className: 'metric-label' }, 'Farms / zones'), h('div', { className: 'metric-value' }, `${m.farms} / ${m.zones}`), h('div', { className: 'metric-sub' }, 'mapped field structure')),
            h('div', { className: 'metric-card' }, h('div', { className: 'metric-label' }, 'IoT online'), h('div', { className: 'metric-value' }, `${m.onlineDevices}/${m.devices}`), h('div', { className: 'metric-sub' }, 'device status')),
            h('div', { className: 'metric-card' }, h('div', { className: 'metric-label' }, 'Active alerts'), h('div', { className: 'metric-value' }, m.activeAlerts), h('div', { className: 'metric-sub' }, 'needs review'))
          ),
          h('div', { className: 'grid content-grid' },
            h('div', { className: 'section-stack' },
              h('section', { className: 'card' }, h('div', { className: 'card-header' }, h('div', null, h('h2', null, 'Farm and device coverage'), h('p', { className: 'card-description' }, 'Live-looking values remain labelled by source.')), h(Badge, { tone: 'engine' }, 'System view')), h('div', { className: 'table-scroll' }, h('table', { className: 'data-table' }, h('thead', null, h('tr', null, h('th', null, 'Farm'), h('th', null, 'Owner'), h('th', null, 'Zones'), h('th', null, 'Latest reading'), h('th', null, 'Source'))), h('tbody', null, farmRows)))),
              h('section', { className: 'card' }, h('div', { className: 'card-header' }, h('div', null, h('h2', null, 'IoT device registry'), h('p', { className: 'card-description' }, 'Offline and stale devices should be investigated, not replaced with synthetic readings.')), h(Badge, { tone: 'demo' }, 'Sensor status')), deviceRows)
            ),
            h('div', { className: 'section-stack' },
              h('section', { className: 'card' }, h('div', { className: 'card-header' }, h('div', null, h('h2', null, 'Active alerts'), h('p', { className: 'card-description' }, 'Review queue for the farm support team.')), h(Badge, { tone: 'engine' }, 'Decision engine')), alertRows),
              h('section', { className: 'card' }, h('div', { className: 'card-header' }, h('div', null, h('h2', null, 'Decision history'), h('p', { className: 'card-description' }, 'Farmer decisions are reviewable and not overwritten by recommendations.')), h(Badge, { tone: 'farmer' }, 'Farmer record')), decisionRows)
            )
          )
        )
      )
    );
  }

  function AdminApp() {
    const [data, setData] = useState(null); const [error, setError] = useState(''); const [authenticated, setAuthenticated] = useState(false);
    const load = async () => { try { const response = await fetch('/api/admin/overview', { headers: { 'x-agcro-role': 'admin' } }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message); setData(payload.data); } catch (err) { setError(err.message); } };
    useEffect(() => { if (authenticated) load(); }, [authenticated]);
    if (!authenticated) return h(AdminLogin, { onEnter: () => setAuthenticated(true) });
    if (error) return h('div', { className: 'page-wrap' }, h('div', { className: 'card' }, h('h2', null, 'Admin data unavailable'), h('p', { className: 'card-description' }, error), h('button', { className: 'btn', onClick: load }, 'Retry')));
    if (!data) return h('div', { className: 'page-wrap loading-state' }, h('div', { className: 'spinner' }), h('p', null, 'Loading operations view…'));
    return h(Overview, { data, onRefresh: load });
  }

  ReactDOM.createRoot(document.getElementById('admin-root')).render(h(AdminApp));
})();
