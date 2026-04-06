(function () {
  const D = window.RetireData;
  const C = window.RetireCalc;
  const R = window.RetireRender;

  const STORAGE_KEY = 'rukRetirementSetup';

  const state = {
    portfolioAccounts: [],
    nextId: 1,
  };

  // ─────────────────────────────
  // SAFE HELPERS
  // ─────────────────────────────
  function safeEl(id) {
    return document.getElementById(id);
  }

  function safeValue(id) {
    const el = safeEl(id);
    return el ? el.value : '';
  }

  function safeNumber(val) {
    const n = Number(val);
    return isNaN(n) ? 0 : n;
  }

  function formatCurrency(val) {
    return D?.formatCurrency
      ? D.formatCurrency(val)
      : (val || 0).toLocaleString('en-GB');
  }

  // ─────────────────────────────
  // DOM → STATE
  // ─────────────────────────────
  function syncAccountsFromDOM() {
    const rows = document.querySelectorAll('#acct-tbody tr');
    const updated = [];

    rows.forEach((row) => {
      const id = Number(row.id.replace('acct-row-', ''));

      const get = (field) =>
        row.querySelector(`[data-field="${field}"]`);

      updated.push({
        id,
        name: get('name')?.value || '',
        wrapper: get('wrapper')?.value || 'GIA',
        owner: get('owner')?.value || 'p1',
        value: safeNumber(D.parseCurrency(get('value')?.value || 0)),
        alloc: {
          equities: safeNumber(get('equities')?.value),
          bonds: safeNumber(get('bonds')?.value),
          cashlike: safeNumber(get('cashlike')?.value),
          cash: safeNumber(get('cash')?.value),
        },
        rate: get('rate')?.value ? safeNumber(get('rate').value) : null,
        monthlyDraw: get('monthlyDraw')?.value
          ? safeNumber(D.parseCurrency(get('monthlyDraw').value))
          : null,
      });
    });

    state.portfolioAccounts = updated;
  }

  // ─────────────────────────────
  // SETUP STATE
  // ─────────────────────────────
  function readSetupInputs() {
    return {
      version: 1,
      people: {
        p1: {
          name: safeValue('sp-p1name').trim(),
          age: safeNumber(safeValue('sp-p1age')),
        },
        p2: {
          name: safeValue('sp-p2name').trim(),
          age: safeNumber(safeValue('sp-p2age')),
        },
      },
      accounts: state.portfolioAccounts,
    };
  }

  function applySetupInputs(data) {
    if (!data) return;

    if (safeEl('sp-p1name')) safeEl('sp-p1name').value = data.people?.p1?.name || '';
    if (safeEl('sp-p1age')) safeEl('sp-p1age').value = data.people?.p1?.age || '';
    if (safeEl('sp-p2name')) safeEl('sp-p2name').value = data.people?.p2?.name || '';
    if (safeEl('sp-p2age')) safeEl('sp-p2age').value = data.people?.p2?.age || '';

    state.portfolioAccounts = data.accounts || [];

    state.nextId =
      Math.max(1, ...state.portfolioAccounts.map((a) => a.id || 0)) + 1;

    const tbody = safeEl('acct-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    state.portfolioAccounts.forEach((acc) => {
      R.renderAccountRow(acc);
      R.updateRowBadge(acc);
      R.applyWrapperFieldState(acc);
    });

    refreshSetupSummary();
  }

  // ─────────────────────────────
  // CALCULATOR INITIALISATION
  // ─────────────────────────────
  function initialiseCalculatorFromSetup(data) {
    if (!data?.accounts) return;

    const totals = {
      woody: { ISA: 0, SIPP: 0, GIA: 0, Cash: 0 },
      heidi: { ISA: 0, SIPP: 0, GIA: 0, Cash: 0 },
    };

    data.accounts.forEach((acc) => {
      const ownerKey = acc.owner === 'p1' ? 'woody' : 'heidi';
      const wrapper = acc.wrapper || 'GIA';

      totals[ownerKey][wrapper] =
        (totals[ownerKey][wrapper] || 0) + (acc.value || 0);
    });

    const map = [
      ['woodyISA', totals.woody.ISA],
      ['woodySIPP', totals.woody.SIPP],
      ['woodyGIA', totals.woody.GIA],
      ['woodyCash', totals.woody.Cash],
      ['heidiISA', totals.heidi.ISA],
      ['heidiSIPP', totals.heidi.SIPP],
      ['heidiGIA', totals.heidi.GIA],
      ['heidiCash', totals.heidi.Cash],
    ];

    map.forEach(([id, val]) => {
      const el = safeEl(id);
      if (el) el.value = formatCurrency(val);
    });
  }

  // ─────────────────────────────
  // SAVE / LOAD
  // ─────────────────────────────
  function saveSetup() {
    syncAccountsFromDOM();
    const data = readSetupInputs();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    console.log('Saved:', data);
  }

  function loadSetup() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return alert('No saved setup found.');

    try {
      const data = JSON.parse(raw);
      applySetupInputs(data);
    } catch (err) {
      console.error(err);
      alert('Load failed – see console');
    }
  }

  // ─────────────────────────────
  // SUMMARY
  // ─────────────────────────────
  function refreshSetupSummary() {
    const summary = C.summarisePortfolio(state.portfolioAccounts);
    R.renderSetupSummary(summary);
  }

  // ─────────────────────────────
  // EVENTS
  // ─────────────────────────────
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;

    const action = el.dataset.action;

    if (action === 'add-account') return;
    if (action === 'remove-account') return;

    if (action === 'save-setup') return saveSetup();
    if (action === 'load-setup') return loadSetup();

    if (action === 'continue-to-main') {
      syncAccountsFromDOM();

      const data = readSetupInputs();
      console.log('HANDOFF →', data);

      initialiseCalculatorFromSetup(data);

      safeEl('setup-page').style.display = 'none';
      safeEl('main-app').style.display = '';
    }

    if (action === 'back-to-setup') {
      safeEl('setup-page').style.display = '';
      safeEl('main-app').style.display = 'none';
    }
  });

  refreshSetupSummary();
})();