(function () {
  const TABS = ['setup', 'assumptions', 'results'];

  function switchTab(name) {
    TABS.forEach(function (t) {
      const panel = document.getElementById('tab-' + t);
      const btn   = document.querySelector('[data-tab="' + t + '"]');
      if (panel) panel.style.display = (t === name) ? '' : 'none';
      if (btn)   btn.classList.toggle('tab-active', t === name);
    });

    // Chart.js: resize all registered charts when Results becomes visible
    // so they render correctly after being hidden on first paint.
    if (name === 'results' && window.Chart && Chart.instances) {
      Object.values(Chart.instances).forEach(function (chart) {
        try { chart.resize(); } catch (e) { /* ignore */ }
      });
    }
  }

  function init() {
    switchTab('setup');
  }

  window.RetireTabs = { init: init, switchTab: switchTab };
})();
