(function () {
  const D = window.RetireData;

  // State shared within this module
  let _rows       = [];
  let _annotations = [];
  let _viewPerson = 'both';
  let _useReal    = true;
  let _activeResultsTab = 'income';
  let _incomeChart     = null;
  let _taxChart        = null;
  let _wealthChart     = null;
  let _spendingChart   = null;
  let _engineShortfall = [];

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────
  const L   = window.RetireCalcRenderLogic;
  const adj = (val, row) => L.adj(val, row, _useReal);
  const fmt = n => D.formatMoney(n);

  function getNames() {
    const p1 = (document.getElementById('sp-p1name')?.value || '').trim() || 'Person 1';
    const p2 = (document.getElementById('sp-p2name')?.value || '').trim() || 'Person 2';
    return { p1, p2 };
  }

  // ─────────────────────────────────────────────
  // PUBLIC: receive new projection results
  // ─────────────────────────────────────────────
  function setResults(result) {
    _rows        = result.rows || result; // backwards-compat if bare array passed
    _annotations = result.annotations || [];
    window._debugRows = _rows; // TEMP DEBUG — remove after diagnosis
  }

  // ─────────────────────────────────────────────
  // VIEW TOGGLES
  // ─────────────────────────────────────────────
  function setView(vp, btn) {
    _viewPerson = vp;
    // sync all person toggle-groups across every sidebar
    document.querySelectorAll('[data-action="view-both"],[data-action="view-p1"],[data-action="view-p2"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${btn.dataset.action}"]`)
      .forEach(b => b.classList.add('is-active'));
    renderCharts();
    renderMetrics();
  }

  function setReal(r, btn) {
    _useReal = r;
    // sync all real/nominal toggle-groups across every sidebar
    document.querySelectorAll('[data-action="real-on"],[data-action="real-off"]')
      .forEach(b => b.classList.remove('is-active'));
    document.querySelectorAll(`[data-action="${btn.dataset.action}"]`)
      .forEach(b => b.classList.add('is-active'));
    renderCharts();
    renderMetrics();
    if (_activeResultsTab === 'tables') renderTables();
  }

  function initResultsTabs() {
    document.querySelectorAll('.results-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.resultsTab;
        _activeResultsTab = tab;

        // Update tab button states
        document.querySelectorAll('.results-tab').forEach(b => {
          b.classList.toggle('results-tab--active', b === btn);
          b.classList.toggle('results-tab--inactive', b !== btn);
        });

        // Show the matching panel, hide others
        document.querySelectorAll('.chart-panel').forEach(panel => {
          panel.style.display = panel.id === `results-panel-${tab}` ? 'grid' : 'none';
        });

        // Render tables on first visit
        if (tab === 'tables') renderTables();
      });
    });
  }

  function initTableSelector() {
    document.querySelectorAll('[data-table-select]').forEach(btn => {
      btn.addEventListener('click', () => {
        const which = btn.dataset.tableSelect;

        // Update selector button states
        document.querySelectorAll('[data-table-select]').forEach(b => {
          b.classList.toggle('is-active', b === btn);
        });

        // Show matching sub-view
        document.getElementById('tables-tax-view').style.display    = which === 'tax'    ? '' : 'none';
        document.getElementById('tables-wealth-view').style.display  = which === 'wealth' ? '' : 'none';
      });
    });
  }

  // ─────────────────────────────────────────────
  // ALERTS
  // ─────────────────────────────────────────────
  function renderAlerts(depletions) {
    const c = document.getElementById('alerts-container');
    if (!c) return;
    c.innerHTML = '';
    const entries = Object.entries(depletions || {}).sort((a, b) => a[1].year - b[1].year);
    entries.forEach(([key, { year, age }]) => {
      const d = document.createElement('div');
      d.className = 'alert alert-warn';
      d.innerHTML = `⚠ <strong>${key}</strong> depleted in <strong>${year}</strong> (age ${age})`;
      c.appendChild(d);
    });
  }

  // ─────────────────────────────────────────────
  // METRICS
  // ─────────────────────────────────────────────
  function renderMetrics() {
    if (!_rows.length) return;

    const { totalTax, avgRate, lastPortfolio: _lp } = L.buildMetrics(_rows, _viewPerson, _useReal);

    const spending    = D.parseCurrency(document.getElementById('spending')?.value || '0');
    const stepDownPct = parseFloat(document.getElementById('stepDownPct')?.value) || 0;
    const fmtK = n => '£' + Math.round(n).toLocaleString('en-GB');
    let incomeTargetStr;
    if (stepDownPct > 0) {
      const reduced = spending * (1 - stepDownPct / 100);
      incomeTargetStr = fmtK(spending) + ' reducing to ' + fmtK(reduced) + ' at age 75';
    } else {
      incomeTargetStr = fmtK(spending) + ' per year';
    }

    const mTax    = document.getElementById('m-tax');
    const mRate   = document.getElementById('m-rate');
    const mTarget = document.getElementById('m-income-target');
    const mPort   = document.getElementById('m-port');
    if (mTax)    mTax.textContent    = fmt(totalTax);
    if (mRate)   mRate.textContent   = (avgRate * 100).toFixed(1) + '%';
    if (mTarget) mTarget.textContent = incomeTargetStr;
    if (mPort)   mPort.textContent   = fmt(_lp);
  }

  // ─────────────────────────────────────────────
  // INCOME LEGEND
  // ─────────────────────────────────────────────
  // ─────────────────────────────────────────────
  // LEGEND TOOLTIPS
  // ─────────────────────────────────────────────

  // Shared tooltip element — created once, reused on every hover
  let _tooltip = null;
  function getTooltip() {
    if (!_tooltip) {
      _tooltip = document.createElement('div');
      _tooltip.id = 'legend-tooltip';
      document.body.appendChild(_tooltip);
    }
    return _tooltip;
  }

  function showTooltip(anchorEl, text) {
    const tip = getTooltip();
    tip.textContent = text;
    tip.classList.add('is-visible');
    const rect = anchorEl.getBoundingClientRect();
    // Position above the icon, centred on it
    tip.style.left = '0';
    tip.style.top  = '0';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = rect.left + rect.width / 2 - tw / 2 + window.scrollX;
    let top  = rect.top - th - 8 + window.scrollY;
    // Keep within viewport horizontally
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.left = left + 'px';
    tip.style.top  = top  + 'px';
  }

  function hideTooltip() {
    if (_tooltip) _tooltip.classList.remove('is-visible');
  }

  function buildTooltipText(label, rows, viewPerson) {
    if (!rows || !rows.length) return null;

    const fmt0 = n => '£' + Math.round(n).toLocaleString('en-GB');

    if (label === 'Salary') {
      const hasSal  = rows.find(r => (r.p1SalInc || 0) + (r.p2SalInc || 0) > 0);
      if (!hasSal) return null;
      const p1name  = (document.getElementById('sp-p1name')?.value || 'Person 1').trim();
      const p2name  = (document.getElementById('sp-p2name')?.value || 'Person 2').trim();
      const p1Has   = hasSal.p1SalInc > 0;
      const p2Has   = hasSal.p2SalInc > 0;

      if (p1Has && p2Has && viewPerson === 'both') {
        // Both have salary — show combined detail
        const lastP1  = [...rows].reverse().find(r => (r.p1SalInc || 0) > 0);
        const lastP2  = [...rows].reverse().find(r => (r.p2SalInc || 0) > 0);
        const p1Annual = hasSal.p1SalInc;
        const p2Annual = hasSal.p2SalInc;
        const combined = p1Annual + p2Annual;
        return `${p1name}'s salary of ${fmt0(p1Annual)}/yr (to age ${lastP1.p1Age}) and ${p2name}'s salary of ${fmt0(p2Annual)}/yr (to age ${lastP2.p2Age}), combined ${fmt0(combined)}/yr`;
      }

      // Single person has salary, or person filter active
      const p1Show  = viewPerson === 'p2' ? false : p1Has;
      const name    = p1Show ? p1name : p2name;
      const annual  = p1Show ? hasSal.p1SalInc : hasSal.p2SalInc;
      const lastSal = [...rows].reverse().find(r => (p1Show ? r.p1SalInc : r.p2SalInc) > 0);
      return `${name}'s salary of ${fmt0(annual)}/yr, drawn until ${lastSal.year} (age ${p1Show ? lastSal.p1Age : lastSal.p2Age})`;
    }

    if (label === 'Cash') {
      const firstCash = rows.find(r => (r.p1Drawn?.Cash || 0) + (r.p2Drawn?.Cash || 0) > 0);
      const lastCash  = [...rows].reverse().find(r => (r.p1Drawn?.Cash || 0) + (r.p2Drawn?.Cash || 0) > 0);
      if (!firstCash) return null;
      const yrs = lastCash.year - firstCash.year + 1;
      return `Liquid cash reserves drawn in early retirement to bridge spending before investment wrappers — used across ${yrs} year${yrs !== 1 ? 's' : ''} (${firstCash.year}–${lastCash.year})`;
    }

    if (label === 'Interest') {
      const firstInt = rows.find(r => (r.p1IntDraw || 0) + (r.p2IntDraw || 0) > 0);
      const lastInt  = [...rows].reverse().find(r => (r.p1IntDraw || 0) + (r.p2IntDraw || 0) > 0);
      if (!firstInt) return null;
      const yrs = lastInt.year - firstInt.year + 1;
      return `Monthly draws from interest-bearing accounts (e.g. money market funds) over ${yrs} years (${firstInt.year}–${lastInt.year}), at their configured draw rate`;
    }

    if (label === 'Dividends') {
      // Average GIA balance across years that have dividends
      const divRows = rows.filter(r => (r.p1Divs || 0) + (r.p2Divs || 0) > 0);
      if (!divRows.length) return null;
      const avgGIA = divRows.reduce((s, r) => s + (r.snap?.p1GIA || 0) + (r.snap?.p2GIA || 0), 0) / divRows.length;
      const sampleDiv = divRows[0].p1Divs + divRows[0].p2Divs;
      const sampleGIA = (divRows[0].snap?.p1GIA || 0) + (divRows[0].snap?.p2GIA || 0);
      const yieldPct  = sampleGIA > 0 ? ((sampleDiv / sampleGIA) * 100).toFixed(1) : '?';
      return `Estimated dividend income from GIA holdings — average GIA balance of ${fmt0(avgGIA)} at a ${yieldPct}% annual yield. Shown separately from GIA capital withdrawals`;
    }

    if (label === 'GIA') {
      const firstGIA = rows.find(r => (r.p1Drawn?.GIA || 0) + (r.p2Drawn?.GIA || 0) > 0);
      const lastGIA  = [...rows].reverse().find(r => (r.p1Drawn?.GIA || 0) + (r.p2Drawn?.GIA || 0) > 0);
      const totalDivs = rows.reduce((s, r) => s + (r.p1Divs || 0) + (r.p2Divs || 0), 0);
      if (!firstGIA) return null;
      const yrs = lastGIA.year - firstGIA.year + 1;
      return `Capital withdrawals from GIA over ${yrs} years (${firstGIA.year}–${lastGIA.year}). Excludes ${fmt0(totalDivs)} dividend income shown separately — GIA gains within annual CGT exemption where possible`;
    }

    if (label === 'ISA') {
      const firstISA = rows.find(r => (r.p1Drawn?.ISA || 0) + (r.p2Drawn?.ISA || 0) > 0);
      const lastISA  = [...rows].reverse().find(r => (r.p1Drawn?.ISA || 0) + (r.p2Drawn?.ISA || 0) > 0);
      if (!firstISA) return null;
      return `Completely tax-free withdrawals from ISA, drawn from ${firstISA.year} onwards. No income tax, CGT or dividend tax on any ISA income`;
    }

    if (label === 'SIPP / WP') {
      const totalGross = rows.reduce((s, r) => s + (r.p1Drawn?.SIPP || 0) + (r.p2Drawn?.SIPP || 0), 0);
      const totalTaxable = rows.reduce((s, r) => s + (r.p1Drawn?.sippTaxable || 0) + (r.p2Drawn?.sippTaxable || 0), 0);
      const taxFree = totalGross - totalTaxable;
      const firstSIPP = rows.find(r => (r.p1Drawn?.SIPP || 0) + (r.p2Drawn?.SIPP || 0) > 0);
      if (!firstSIPP) return null;
      return `Gross pension withdrawals from ${firstSIPP.year} — ${fmt0(taxFree)} tax-free (25%) and ${fmt0(totalTaxable)} taxable (75%). The largest single investment source over retirement`;
    }

    if (label === 'State Pension') {
      const p1SP = rows.find(r => r.p1SP > 0);
      const p2SP = rows.find(r => r.p2SP > 0);
      const p1Name = (document.getElementById('sp-p1name')?.value || 'Person 1').trim();
      const p2Name = (document.getElementById('sp-p2name')?.value || 'Person 2').trim();
      const parts = [];
      if (p1SP) parts.push(`${p1Name} from ${p1SP.year} (age ${p1SP.p1Age})`);
      if (p2SP) parts.push(`${p2Name} from ${p2SP.year} (age ${p2SP.p2Age})`);
      return `Combined state pension — ${parts.join(', ')}. The largest single lifetime income source`;
    }

    if (label === 'Shortfall') {
      const sfRows = rows.filter(r => (r.cashflowShortfall || 0) > 0);
      if (!sfRows.length) return 'Portfolio fully meets the spending target across all years — no shortfall';
      return `Spending target unmet in ${sfRows.length} year${sfRows.length !== 1 ? 's' : ''}, first occurring in ${sfRows[0].year}`;
    }

    return null;
  }

  function renderIncomeLegend(chart, recomputeShortfall) {
    const host = document.getElementById('incomeLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows how your retirement income is drawn from each source year by year. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Source</span><span>Lifetime</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      if (ds.stack !== 'income') return;
      if (ds.label === 'Shortfall') return;

      const item = document.createElement('div');
      item.className = 'sidebar-legend__item';
      if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      const raw = ds._lifetimeValue || 0;
      value.textContent = raw > 0 ? fmt(raw) : '—';

      item.appendChild(swatch);
      item.appendChild(label);

      // Info icon — shows contextual tooltip on hover
      const tipText = buildTooltipText(ds.label, _rows, _viewPerson);
      if (tipText) {
        const info = document.createElement('span');
        info.className = 'sidebar-legend__info';
        info.textContent = 'ⓘ';
        info.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(info, tipText); });
        info.addEventListener('mouseleave', hideTooltip);
        item.appendChild(info);
      }

      item.appendChild(value);

      item.addEventListener('click', () => {
        chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
        recomputeShortfall(chart);
        chart.update();
        renderIncomeLegend(chart, recomputeShortfall);
      });

      host.appendChild(item);
    });

    // Shortfall — always shown, not toggleable
    const sfRaw = _engineShortfall.reduce((s, v) => s + v * 1000, 0);
    const sfItem = document.createElement('div');
    sfItem.className = 'sidebar-legend__item sidebar-legend__item--fixed';
    const sfSwatch = document.createElement('span');
    sfSwatch.className = 'sidebar-legend__swatch';
    sfSwatch.style.background = '#DC2626';
    const sfLabel = document.createElement('span');
    sfLabel.textContent = 'Shortfall';
    sfLabel.style.flex = '1';
    sfItem.appendChild(sfSwatch);
    sfItem.appendChild(sfLabel);
    const sfTipText = buildTooltipText('Shortfall', _rows, _viewPerson);
    if (sfTipText) {
      const sfInfo = document.createElement('span');
      sfInfo.className = 'sidebar-legend__info';
      sfInfo.textContent = 'ⓘ';
      sfInfo.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(sfInfo, sfTipText); });
      sfInfo.addEventListener('mouseleave', hideTooltip);
      sfItem.appendChild(sfInfo);
    }
    if (sfRaw > 0) {
      const sfVal = document.createElement('span');
      sfVal.className = 'sidebar-legend__value';
      sfVal.textContent = fmt(sfRaw);
      sfItem.appendChild(sfVal);
    } else {
      const sfNote = document.createElement('span');
      sfNote.className = 'sidebar-legend__fixed-note';
      sfNote.textContent = 'always on';
      sfNote.style.marginLeft = 'auto';
      sfItem.appendChild(sfNote);
    }
    host.appendChild(sfItem);
  }

  // ─────────────────────────────────────────────
  // GROSS VS NET LEGEND
  // ─────────────────────────────────────────────
  function renderGrossNetLegend(chart) {
    const host = document.getElementById('spendingLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows gross income drawn each year split between net spending and tax paid. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Source</span><span>Lifetime</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      if (ds.type === 'line') return;

      const fixed = ds._fixed === true;
      const item = document.createElement('div');
      item.className = 'sidebar-legend__item' + (fixed ? ' sidebar-legend__item--fixed' : '');
      if (!fixed && !chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      const raw = ds._lifetimeValue || 0;
      value.textContent = raw > 0 ? fmt(raw) : '—';

      item.appendChild(swatch);
      item.appendChild(label);
      item.appendChild(value);

      if (!fixed) {
        item.addEventListener('click', () => {
          chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
          chart.update('none');
          renderGrossNetLegend(chart);
        });
      }

      host.appendChild(item);
    });


  }

  // ─────────────────────────────────────────────
  // TAX LEGEND
  // ─────────────────────────────────────────────
  function renderTaxLegend(chart) {
    const host = document.getElementById('taxLegend');
    if (!host) return;
    host.innerHTML = '';

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows total income tax and CGT paid each year, with the effective rate on the right axis. Click either item to show or hide it.';
    host.appendChild(intro);

    function toggleDataset(idx) {
      const visible = chart.isDatasetVisible(idx);
      chart.setDatasetVisibility(idx, !visible);
      // Bar (idx 0) hides left y axis; line (idx 1) hides right y1 axis
      const axisKey = idx === 0 ? 'y' : 'y1';
      if (chart.options.scales && chart.options.scales[axisKey]) {
        chart.options.scales[axisKey].display = !visible;
      }
      chart.update();
      renderTaxLegend(chart);
    }

    // Tax paid — bar item
    const barVisible = chart.isDatasetVisible(0);
    const barItem = document.createElement('div');
    barItem.className = 'sidebar-legend__item' + (barVisible ? '' : ' is-hidden');
    barItem.style.cursor = 'pointer';

    const barSwatch = document.createElement('span');
    barSwatch.className = 'sidebar-legend__swatch';
    barSwatch.style.background = '#C55A11';

    const barLabel = document.createElement('span');
    barLabel.textContent = 'Tax paid';
    barLabel.style.flex = '1';

    const barValue = document.createElement('span');
    barValue.className = 'sidebar-legend__value';
    const totalTax = _rows.reduce((s, r) => {
      const t = _viewPerson === 'p1' ? r.p1IncomeTax + r.p1CGT + r.p1NI
              : _viewPerson === 'p2' ? r.p2IncomeTax + r.p2CGT + r.p2NI
              : r.p1IncomeTax + r.p1CGT + r.p1NI + r.p2IncomeTax + r.p2CGT + r.p2NI;
      return s + adj(t, r);
    }, 0);
    barValue.textContent = fmt(totalTax);

    barItem.appendChild(barSwatch);
    barItem.appendChild(barLabel);
    barItem.appendChild(barValue);
    barItem.addEventListener('click', () => toggleDataset(0));
    host.appendChild(barItem);

    // Effective tax rate — line item
    const lineVisible = chart.isDatasetVisible(1);
    const lineItem = document.createElement('div');
    lineItem.className = 'sidebar-legend__item' + (lineVisible ? '' : ' is-hidden');
    lineItem.style.cursor = 'pointer';

    const lineSwatch = document.createElement('span');
    lineSwatch.className = 'sidebar-legend__swatch';
    lineSwatch.style.background = 'none';
    lineSwatch.style.borderTop = '2px solid #7F6000';
    lineSwatch.style.height = '0';
    lineSwatch.style.alignSelf = 'center';

    const lineLabel = document.createElement('span');
    lineLabel.textContent = 'Effective tax rate';
    lineLabel.style.flex = '1';

    const avgRate = _rows.length
      ? (() => {
          const { t, g } = _rows.reduce((s, r) => {
            const tax   = _viewPerson === 'p1' ? r.p1IncomeTax + r.p1CGT + r.p1NI
                        : _viewPerson === 'p2' ? r.p2IncomeTax + r.p2CGT + r.p2NI
                        : r.p1IncomeTax + r.p1CGT + r.p1NI + r.p2IncomeTax + r.p2CGT + r.p2NI;
            const gross = _viewPerson === 'p1' ? (r.p1GrossIncome  || 0)
                        : _viewPerson === 'p2' ? (r.p2GrossIncome  || 0)
                        : (r.householdGrossIncome || 0);
            return { t: s.t + adj(tax, r), g: s.g + adj(gross, r) };
          }, { t: 0, g: 0 });
          return g > 0 ? (t / g * 100).toFixed(1) : '0.0';
        })()
      : '0.0';

    const lineValue = document.createElement('span');
    lineValue.className = 'sidebar-legend__value';
    lineValue.textContent = avgRate + '% avg';

    lineItem.appendChild(lineSwatch);
    lineItem.appendChild(lineLabel);
    lineItem.appendChild(lineValue);
    lineItem.addEventListener('click', () => toggleDataset(1));
    host.appendChild(lineItem);
  }

  // ─────────────────────────────────────────────
  // ENGINE NOTES OVERLAY
  // ─────────────────────────────────────────────
  let _overlayOpen = false;

  const ANNOTATION_GROUPS = [
    { event: 'cash_surplus', emoji: '💰', label: 'Surplus cash' },
    { event: 'sp_starts',   emoji: '🏦', label: 'State Pension' },
    { event: 'salary_stop', emoji: '💼', label: 'Salary stops' },
    { event: 'shortfall',   emoji: '⚠️',  label: 'Shortfall years' },
    { event: 'depletion',   emoji: '🛑', label: 'Depletions' },
  ];

  function renderAnnotationsOverlay() {
    const panel = document.getElementById('results-panel-wealth');
    if (!panel) return;

    // Remove any existing overlay
    const existing = panel.querySelector('.engine-notes-overlay');
    if (existing) existing.remove();
    if (!_overlayOpen) return;

    const overlay = document.createElement('div');
    overlay.className = 'engine-notes-overlay';
    overlay.innerHTML = `
      <div class="engine-notes-overlay__header">
        <span>Engine notes</span>
        <button class="engine-notes-overlay__close" aria-label="Close">✕</button>
      </div>
      <div class="engine-notes-overlay__body"></div>
    `;

    const body = overlay.querySelector('.engine-notes-overlay__body');

    ANNOTATION_GROUPS.forEach(({ event, emoji, label }) => {
      const items = _annotations.filter(a => a.event === event);
      if (!items.length) return;

      const group = document.createElement('div');
      group.className = 'engine-notes-group';

      const heading = document.createElement('div');
      heading.className = 'engine-notes-group__heading';
      heading.textContent = `${emoji} ${label}`;
      group.appendChild(heading);

      items.forEach(a => {
        const row = document.createElement('div');
        row.className = 'engine-notes-group__row';
        row.innerHTML = `<span class="engine-notes-year">${a.year}</span><span>${a.message}</span>`;
        group.appendChild(row);
      });

      body.appendChild(group);
    });

    // Close on ✕
    overlay.querySelector('.engine-notes-overlay__close').addEventListener('click', () => {
      _overlayOpen = false;
      renderAnnotationsOverlay();
      // Re-render legend so button label reflects closed state
      if (_wealthChart) renderWealthLegend(_wealthChart);
    });

    // Close on click outside overlay
    setTimeout(() => {
      document.addEventListener('click', function outsideClick(e) {
        if (!overlay.contains(e.target)) {
          _overlayOpen = false;
          renderAnnotationsOverlay();
          if (_wealthChart) renderWealthLegend(_wealthChart);
          document.removeEventListener('click', outsideClick);
        }
      });
    }, 0);

    panel.appendChild(overlay);
  }

  // ─────────────────────────────────────────────
  // WEALTH LEGEND
  // ─────────────────────────────────────────────
  function buildWealthTooltip(label) {
    if (label.includes('SIPP')) return 'Pension fund balance — tax-free growth inside the wrapper. Withdrawals are subject to income tax (75% taxable, 25% tax-free). Subject to IHT on death before age 75 in some cases.';
    if (label.includes('ISA'))  return 'ISA balance — completely tax-free growth, income, and withdrawals. No CGT, income tax, or dividend tax on any gains.';
    if (label.includes('GIA'))  return 'General Investment Account — subject to CGT on gains above the annual exemption (£3,000) and dividend tax above the allowance (£500). Growth is otherwise unrestricted.';
    if (label.includes('Interest')) return 'Interest-bearing accounts (e.g. money market funds) — interest taxed as savings income, within the Starting Rate for Savings (£5,000) and Personal Savings Allowance (£1,000) where available.';
    if (label.includes('Cash')) return 'Liquid cash reserves — interest taxed as savings income within standard allowances. Used to bridge spending before investment wrappers are drawn.';
    return null;
  }

  function renderWealthLegend(chart) {
    const host = document.getElementById('wealthLegend');
    if (!host) return;
    host.innerHTML = '';
    host.classList.add('sidebar-legend--scrollable');

    const intro = document.createElement('p');
    intro.className = 'chart-intro';
    intro.textContent = 'Shows portfolio balance by wrapper at end of each year. Click any legend item to show or hide it in the chart.';
    host.appendChild(intro);

    // Engine notes button — only shown when there are annotations
    if (_annotations.length > 0) {
      const notesBtn = document.createElement('button');
      notesBtn.className = 'engine-notes-btn' + (_overlayOpen ? ' is-active' : '');
      notesBtn.textContent = `ⓘ Engine notes (${_annotations.length})`;
      notesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        _overlayOpen = !_overlayOpen;
        renderAnnotationsOverlay();
        renderWealthLegend(chart);
      });
      host.appendChild(notesBtn);
    }

    const header = document.createElement('div');
    header.className = 'sidebar-legend__header';
    header.innerHTML = '<span>Wrapper</span><span>Now</span>';
    host.appendChild(header);

    chart.data.datasets.forEach((ds, i) => {
      const item = document.createElement('div');
      item.className = 'sidebar-legend__item';
      if (!chart.isDatasetVisible(i)) item.classList.add('is-hidden');

      const swatch = document.createElement('span');
      swatch.className = 'sidebar-legend__swatch';
      swatch.style.background = ds.backgroundColor;

      const label = document.createElement('span');
      label.textContent = ds.label;
      label.style.flex = '1';

      // Current (first year) balance as the "now" value
      const nowVal = ds.data[0] || 0;
      const value = document.createElement('span');
      value.className = 'sidebar-legend__value';
      value.textContent = nowVal > 0 ? fmt(nowVal) : '—';

      item.appendChild(swatch);
      item.appendChild(label);

      const tipText = buildWealthTooltip(ds.label);
      if (tipText) {
        const info = document.createElement('span');
        info.className = 'sidebar-legend__info';
        info.textContent = 'ⓘ';
        info.addEventListener('mouseenter', e => { e.stopPropagation(); showTooltip(info, tipText); });
        info.addEventListener('mouseleave', hideTooltip);
        item.appendChild(info);
      }

      item.appendChild(value);

      item.addEventListener('click', () => {
        chart.setDatasetVisibility(i, !chart.isDatasetVisible(i));
        chart.update('none');
        renderWealthLegend(chart);
      });

      host.appendChild(item);
    });
  }

    function renderCharts() {
    if (!_rows.length) return;
    const labels = _rows.map(r => r.year);
    const { p1, p2 } = getNames();

    // ─────────────────────────────────────────────
    // INCOME CHART
    // ─────────────────────────────────────────────

    // Full household target — always used for shortfall regardless of person toggle
    const _targetData      = _rows.map(r => adj(r.target || 0, r) / 1000);

    const sets = L.buildIncomeDatasets(_rows, _viewPerson, _useReal);

    // Extract the engine shortfall from the Shortfall dataset for legend use
    _engineShortfall = sets[sets.length - 1].data.slice();

    // Recompute shortfall when sources are toggled on/off in the legend
    function recomputeShortfall(chart) {
      const sfIdx = chart.data.datasets.findIndex(d => d.label === 'Shortfall');
      if (sfIdx < 0) return;
      const sourceSets = chart.data.datasets.filter(
        d => d.stack === 'income' && d.label !== 'Shortfall'
      );
      chart.data.datasets[sfIdx].data = _targetData.map((tgt, i) => {
        const visibleGross = sourceSets.reduce((sum, d) => {
          return sum + (chart.isDatasetVisible(chart.data.datasets.indexOf(d)) ? (d.data[i] || 0) : 0);
        }, 0);
        return Math.max(_engineShortfall[i], tgt - visibleGross);
      });
    }

    const incCtx = document.getElementById('incomeChart')?.getContext('2d');
    if (incCtx) {
      if (_incomeChart) _incomeChart.destroy();
      _incomeChart = new Chart(incCtx, {
        type: 'bar',
        data: { labels, datasets: sets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = (ctx.parsed.y || 0) * 1000;
                  if (!val) return null;
                  if (ctx.dataset.label === 'Shortfall') return `Shortfall: ${D.formatMoney(val)}`;
                  if (ctx.dataset.label === 'Spending target')    return `Target: ${D.formatMoney(val)}`;
                  return `${ctx.dataset.label}: ${D.formatMoney(val)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £k' : 'Nominal £k',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v + 'k',
              },
            },
          },
        },
      });
      renderIncomeLegend(_incomeChart, recomputeShortfall);
    }

    // ─────────────────────────────────────────────
    // TAX / RATE DATA — used by both Gross vs Net and Tax charts
    // ─────────────────────────────────────────────
    const { taxData, rateData } = L.buildTaxChartData(_rows, _viewPerson, _useReal);

    // ─────────────────────────────────────────────
    // GROSS VS NET INCOME CHART
    // Two segments only: Net income (bottom) + Tax (top).
    // Bar total = gross drawn. Tax segment shows what's lost.
    // ─────────────────────────────────────────────
    const spendingCtx = document.getElementById('spendingChart')?.getContext('2d');
    if (spendingCtx) {
      const grossNetSets = L.buildGrossNetDatasets(_rows, _viewPerson, _useReal);

      if (_spendingChart) _spendingChart.destroy();
      _spendingChart = new Chart(spendingCtx, {
        type: 'bar',
        data: { labels, datasets: grossNetSets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  const val = (ctx.parsed.y || 0) * 1000;
                  if (!val) return null;
                  if (ctx.dataset.label === 'Spending target') return `Target: ${D.formatMoney(val)}`;
                  return `${ctx.dataset.label}: ${D.formatMoney(val)}`;
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £k' : 'Nominal £k',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v + 'k',
              },
            },
          },
        },
      });

      renderGrossNetLegend(_spendingChart);

      // Update chart panel heading if present
      const heading = document.getElementById('spendingChartTitle');
      if (heading) heading.textContent = 'Gross vs net income';
    }

    // ─────────────────────────────────────────────
    // TAX CHART
    // Rate line scaled to share the left axis so it tracks bar heights.
    // Right axis back-calculates scaled values to show real % labels.
    // ─────────────────────────────────────────────
    const taxCtx = document.getElementById('taxChart')?.getContext('2d');
    if (taxCtx) {
      const maxTax  = Math.max(...taxData, 1);
      const maxRate = Math.max(...rateData, 1);
      const rateScaled = rateData.map(v => (v / maxRate) * maxTax);

      if (_taxChart) _taxChart.destroy();
      _taxChart = new Chart(taxCtx, {
        data: {
          labels,
          datasets: [
            {
              type: 'bar',
              label: 'Tax paid',
              data: taxData,
              backgroundColor: '#C55A11',
              yAxisID: 'y',
              order: 2,
            },
            {
              type: 'line',
              label: 'Effective tax rate',
              data: rateScaled,
              borderColor: '#7F6000',
              backgroundColor: 'transparent',
              borderWidth: 2,
              pointRadius: 2,
              tension: 0.2,
              yAxisID: 'y',
              order: 1,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.label === 'Effective tax rate') {
                    const realRate = maxTax > 0 ? (ctx.parsed.y / maxTax * maxRate).toFixed(1) : '0.0';
                    return `Effective tax rate: ${realRate}%`;
                  }
                  return `Tax paid: ${D.formatMoney(ctx.parsed.y || 0)}`;
                },
              },
            },
          },
          scales: {
            x: {
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              position: 'left',
              min: 0,
              max: maxTax * 1.05,
              title: {
                display: true,
                text: _useReal ? 'Real £' : 'Nominal £',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => '£' + Math.round(v).toLocaleString('en-GB'),
              },
            },
            y1: {
              position: 'right',
              min: 0,
              max: maxRate * 1.05,
              grid: { drawOnChartArea: false },
              title: {
                display: true,
                text: 'Rate %',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => v.toFixed(1) + '%',
              },
            },
          },
        },
      });
      renderTaxLegend(_taxChart);
    }

    // ─────────────────────────────────────────────
    // WEALTH CHART
    // ─────────────────────────────────────────────
    const wealthCtx = document.getElementById('wealthChart')?.getContext('2d');
    if (wealthCtx) {
      const wealthDatasets = L.buildWealthDatasets(_rows, _viewPerson, _useReal, p1, p2);

      if (_wealthChart) _wealthChart.destroy();
      _wealthChart = new Chart(wealthCtx, {
        type: 'bar',
        data: {
          labels,
          datasets: wealthDatasets,
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${D.formatMoney(ctx.parsed.y || 0)}`,
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { font: { size: 10 }, maxRotation: 45 },
            },
            y: {
              stacked: true,
              title: {
                display: true,
                text: _useReal ? 'Real £' : 'Nominal £',
                font: { size: 11 },
              },
              ticks: {
                font: { size: 11 },
                callback: v => '£' + Math.round(v).toLocaleString('en-GB'),
              },
            },
          },
        },
      });
      renderWealthLegend(_wealthChart);
    }
  }


  // ─────────────────────────────────────────────
  // TABLES
  // ─────────────────────────────────────────────
  function renderTables() {
    if (!_rows.length) return;
    const f = n => D.formatMoney(n);
    const { p1, p2 } = getNames();

    // Tax table
    const taxTbl = document.getElementById('tax-table');
    if (taxTbl) {
      const taxRows = L.buildTableTaxRows(_rows, _useReal);
      let grandWI = 0, grandWC = 0, grandWN = 0, grandHI = 0, grandHC = 0, grandHN = 0;
      let body = '<tbody>';
      taxRows.forEach(row => {
        const { year, p1Age, p2Age, wi, wc, wn, wt, hi, hc, hn, ht, hh, cumTax } = row;
        grandWI += wi; grandWC += wc; grandWN += wn;
        grandHI += hi; grandHC += hc; grandHN += hn;
        body += `<tr>
          <td>${year}</td><td>${p1Age}</td><td>${p2Age}</td>
          <td>${f(wi)}</td><td>${f(wc)}</td><td>${f(wn)}</td><td>${f(wt)}</td>
          <td>${f(hi)}</td><td>${f(hc)}</td><td>${f(hn)}</td><td>${f(ht)}</td>
          <td>${f(hh)}</td><td>${f(cumTax)}</td>
        </tr>`;
      });
      const grand = grandWI + grandWC + grandWN + grandHI + grandHC + grandHN;
      body += `<tr class="total-row">
        <td colspan="3">Total</td>
        <td>${f(grandWI)}</td><td>${f(grandWC)}</td><td>${f(grandWN)}</td><td>${f(grandWI+grandWC+grandWN)}</td>
        <td>${f(grandHI)}</td><td>${f(grandHC)}</td><td>${f(grandHN)}</td><td>${f(grandHI+grandHC+grandHN)}</td>
        <td>${f(grand)}</td><td>${f(grand)}</td>
      </tr></tbody>`;
      taxTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>${p1} age</th><th>${p2} age</th>
        <th>${p1} income tax</th><th>${p1} CGT</th><th>${p1} NI</th><th>${p1} total</th>
        <th>${p2} income tax</th><th>${p2} CGT</th><th>${p2} NI</th><th>${p2} total</th>
        <th>Household tax</th><th>Cumulative tax</th>
      </tr></thead>` + body;
    }

    // Wealth table
    const wTbl = document.getElementById('wealth-table');
    if (wTbl) {
      const wealthRows = L.buildTableWealthRows(_rows, _useReal);
      let body = '<tbody>';
      wealthRows.forEach(row => {
        const { year, p1Age, p2Age,
                p1Cash, p1IntBal, p1GIA, p1SIPP, p1ISA,
                p2Cash, p2IntBal, p2GIA, p2SIPP, p2ISA, total } = row;
        // Depleted marker: cell value rounds to zero but underlying snap was positive
        const cell = (adjVal, snapVal) =>
          `<td${adjVal < 1 && snapVal > 0 ? ' class="depleted"' : ''}>${f(adjVal)}</td>`;
        const s = _rows.find(r => r.year === year).snap;
        body += `<tr>
          <td>${year}</td><td>${p1Age}</td><td>${p2Age}</td>
          ${cell(p1Cash, s.p1Cash)}${cell(p1IntBal, s.p1IntBal||0)}${cell(p1GIA, s.p1GIA)}${cell(p1SIPP, s.p1SIPP)}${cell(p1ISA, s.p1ISA)}
          ${cell(p2Cash, s.p2Cash)}${cell(p2IntBal, s.p2IntBal||0)}${cell(p2GIA, s.p2GIA)}${cell(p2SIPP, s.p2SIPP)}${cell(p2ISA, s.p2ISA)}
          <td>${f(total)}</td>
        </tr>`;
      });
      body += '</tbody>';
      wTbl.innerHTML = `<thead><tr>
        <th>Year</th><th>${p1} age</th><th>${p2} age</th>
        <th>${p1} Cash</th><th>${p1} Interest</th><th>${p1} GIA</th><th>${p1} SIPP</th><th>${p1} ISA</th>
        <th>${p2} Cash</th><th>${p2} Interest</th><th>${p2} GIA</th><th>${p2} SIPP</th><th>${p2} ISA</th>
        <th>Total</th>
      </tr></thead>` + body;
    }
  }

  window.RetireCalcRender = {
    setResults,
    setView,
    setReal,
    initResultsTabs,
    initTableSelector,
    renderAlerts,
    renderMetrics,
    renderCharts,
    renderTables,
  };
})();
