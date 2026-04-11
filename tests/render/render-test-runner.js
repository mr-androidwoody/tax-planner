/**
 * render-test-runner.js
 *
 * Shared utilities for the render test harness.
 * Provides:
 *   - Chart.js capture stub (window.Chart)
 *   - test() assertion helper
 *   - runSuite() executor
 *   - postResults() reporter (posts to parent harness via postMessage)
 */

// ─────────────────────────────────────────────
// CHART.JS CAPTURE STUB
// Replaces Chart.js entirely. Records every new Chart(ctx, cfg) call.
// The captured cfg.data.datasets array is what we assert against.
// ─────────────────────────────────────────────
(function installChartStub() {
  const _captures = [];

  function ChartStub(ctx, cfg) {
    this.ctx      = ctx;
    this.cfg      = cfg;
    this.data     = cfg.data;
    this.options  = cfg.options || {};
    this._visible = {};

    // Stubs for methods legend/recomputeShortfall callbacks may call
    this.isDatasetVisible = (i) => this._visible[i] !== false;
    this.setDatasetVisibility = (i, v) => { this._visible[i] = v; };
    this.update   = () => {};
    this.destroy  = () => {};

    _captures.push(this);
  }

  ChartStub.captures     = _captures;
  ChartStub.last         = ()  => _captures[_captures.length - 1];
  ChartStub.byLabel      = (l) => _captures.find(c => c.data?.datasets?.some(d => d.label === l));
  ChartStub.reset        = ()  => { _captures.length = 0; };
  ChartStub.getDataset   = (captureIdx, label) => {
    const cap = _captures[captureIdx];
    return cap?.data?.datasets?.find(d => d.label === label);
  };

  window.Chart = ChartStub;
})();

// ─────────────────────────────────────────────
// ASSERTION HELPER + SUITE RUNNER + FIXTURES
// All wrapped in an IIFE so nothing leaks to global scope.
// Only window.RenderTestRunner is exposed.
// ─────────────────────────────────────────────
(function() {
const TOL = 0.01; // default absolute tolerance for floating point comparisons

/**
 * @param {string}  id       - unique test identifier
 * @param {string}  label    - human description
 * @param {*}       actual
 * @param {*}       expected
 * @param {number}  [tol]    - optional absolute tolerance (for numbers)
 * @param {boolean} [knownBug] - mark as known failing without blocking suite
 * @returns {{ id, label, pass, actual, expected, knownBug }}
 */
function test(id, label, actual, expected, tol, knownBug) {
  let pass;
  if (typeof expected === 'number' && typeof actual === 'number') {
    const tolerance = (tol !== undefined && tol !== null) ? tol : TOL;
    pass = Math.abs(actual - expected) <= tolerance;
  } else {
    pass = actual === expected;
  }
  return { id, label, pass, actual, expected, knownBug: !!knownBug };
}

/**
 * Run a suite function and render results into the page.
 * @param {string}   suiteName
 * @param {Function} suiteFn   - returns results[]
 */
function runSuite(suiteName, suiteFn) {
  const results = [];
  try {
    const returned = suiteFn(results);
    if (Array.isArray(returned)) returned.forEach(r => results.push(r));
  } catch (e) {
    results.push({
      id: 'SUITE_ERROR', label: 'Suite threw an exception: ' + e.message,
      pass: false, actual: e.stack, expected: 'no error',
    });
  }

  const passed     = results.filter(r => r.pass).length;
  const failed     = results.filter(r => !r.pass && !r.knownBug).length;
  const knownBugs  = results.filter(r => !r.pass && r.knownBug).length;
  const total      = results.length;

  // Render standalone result table into the page
  const container = document.getElementById('results') || document.body;
  const summaryClass = failed > 0 ? 'fail' : knownBugs > 0 ? 'warn' : 'pass';

  let html = `
    <h2>${suiteName} — <span class="${summaryClass}">${failed === 0 ? (knownBugs > 0 ? 'WARN' : 'PASS') : 'FAIL'}</span></h2>
    <p>Passed: <strong>${passed}</strong> / Failed: <strong>${failed}</strong> / Known bugs: <strong>${knownBugs}</strong> / Total: <strong>${total}</strong></p>
    <table>
      <thead><tr><th>ID</th><th>Test</th><th>Result</th><th>Actual</th><th>Expected</th></tr></thead>
      <tbody>
  `;

  results.forEach(r => {
    const cls  = r.pass ? 'pass' : r.knownBug ? 'warn' : 'fail';
    const icon = r.pass ? '✓' : r.knownBug ? '⚠' : '✗';
    const act  = typeof r.actual   === 'number' ? r.actual.toFixed(4)   : String(r.actual).slice(0, 80);
    const exp  = typeof r.expected === 'number' ? r.expected.toFixed(4) : String(r.expected).slice(0, 80);
    html += `<tr class="${cls}">
      <td>${r.id}</td>
      <td>${r.label}</td>
      <td>${icon}</td>
      <td>${act}</td>
      <td>${exp}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  container.innerHTML += html;

  // Post summary to parent harness if running in iframe
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({
      type: 'suite-result',
      suite: suiteName,
      passed, failed, knownBugs, total,
      ok: failed === 0,
    }, '*');
  }

  return results;
}

// ─────────────────────────────────────────────
// SHARED FIXTURE FACTORY
// Builds a minimal but complete rows[] array for tests.
// Hand-calculated values — independent of the engine.
// ─────────────────────────────────────────────

/**
 * Returns a 3-row fixture. All values are chosen so hand calculations are easy.
 *
 * Scenario:
 *   Year 1 (2026): Both working. p1 salary £30k, p2 salary £15k.
 *                  No SP yet. Some SIPP draw. realDeflator = 1.0 (base year).
 *   Year 2 (2027): p2 salary stops. p1 SP starts. realDeflator = 0.952 (2.5% inflation yr 1 applied).
 *   Year 3 (2028): p1 SP + some ISA + GIA draw. realDeflator = 0.929.
 *
 * snap values are end-of-year balances.
 */
function makeFixture() {
  return [
    {
      year: 2026, p1Age: 58, p2Age: 59,
      target: 65000,
      realDeflator: 1.0,

      p1SP: 0,        p2SP: 0,
      p1SalInc: 30000, p2SalInc: 15000,
      p1IntDraw: 2000, p2IntDraw: 1000,
      p1DivsUsed: 500, p2DivsUsed: 300,
      p1Drawn: { Cash: 0,    GIA: 2000,  ISA: 5000,  SIPP: 8000,  sippTaxable: 6000 },
      p2Drawn: { Cash: 500,  GIA: 0,     ISA: 0,     SIPP: 1000,  sippTaxable: 750  },

      p1IncomeTax: 3200, p1CGT: 400,  p1NI: 800,
      p2IncomeTax: 600,  p2CGT: 0,    p2NI: 300,

      p1GrossIncome:  47500,  // 0+30000+2000+500+0+2000+5000+8000
      p2GrossIncome:  17800,  // 0+15000+1000+300+500+0+0+1000
      householdGrossIncome: 65300,

      totalPortfolio: 1800000,

      snap: {
        p1Cash:   0,      p1IntBal: 180000,
        p1GIA:    150000, p1SIPP:   480000, p1ISA: 270000,
        p2Cash:   0,      p2IntBal: 0,
        p2GIA:    5000,   p2SIPP:   200000, p2ISA: 140000,
      },
    },
    {
      year: 2027, p1Age: 59, p2Age: 60,
      target: 66625,  // 65000 * 1.025
      realDeflator: 0.9756,  // 1/1.025

      p1SP: 0,         p2SP: 0,
      p1SalInc: 30750, p2SalInc: 0,    // p2 salary stopped
      p1IntDraw: 2050, p2IntDraw: 0,
      p1DivsUsed: 512, p2DivsUsed: 0,
      p1Drawn: { Cash: 0,    GIA: 3000,  ISA: 10000, SIPP: 12000, sippTaxable: 9000 },
      p2Drawn: { Cash: 1000, GIA: 4000,  ISA: 3000,  SIPP: 313,   sippTaxable: 234  },

      p1IncomeTax: 3500, p1CGT: 600,  p1NI: 850,
      p2IncomeTax: 200,  p2CGT: 100,  p2NI: 0,

      p1GrossIncome:  58312,
      p2GrossIncome:  8313,
      householdGrossIncome: 66625,

      totalPortfolio: 1750000,

      snap: {
        p1Cash:   0,      p1IntBal: 175000,
        p1GIA:    142000, p1SIPP:   458000, p1ISA: 258000,
        p2Cash:   0,      p2IntBal: 0,
        p2GIA:    0,      p2SIPP:   195000, p2ISA: 138000,
      },
    },
    {
      year: 2028, p1Age: 60, p2Age: 61,
      target: 68291,  // 65000 * 1.025^2
      realDeflator: 0.9518,  // 1/1.025^2

      p1SP: 11500,    p2SP: 0,
      p1SalInc: 0,    p2SalInc: 0,
      p1IntDraw: 2100, p2IntDraw: 0,
      p1DivsUsed: 0,  p2DivsUsed: 0,
      p1Drawn: { Cash: 0,    GIA: 8000,  ISA: 15000, SIPP: 20000, sippTaxable: 15000 },
      p2Drawn: { Cash: 500,  GIA: 5000,  ISA: 5000,  SIPP: 691,   sippTaxable: 518   },

      p1IncomeTax: 4200, p1CGT: 800,  p1NI: 0,
      p2IncomeTax: 300,  p2CGT: 200,  p2NI: 0,

      p1GrossIncome:  56600,
      p2GrossIncome:  11191,
      householdGrossIncome: 67791,

      totalPortfolio: 1680000,

      snap: {
        p1Cash:   0,      p1IntBal: 168000,
        p1GIA:    128000, p1SIPP:   430000, p1ISA: 242000,
        p2Cash:   0,      p2IntBal: 0,
        p2GIA:    0,      p2SIPP:   188000, p2ISA: 132000,
      },
    },
  ];
}

// ─────────────────────────────────────────────
// FIXTURE WITH BOBBY'S CASH BUG SCENARIO
// p1 (Bobby) starts with £0 cash.
// SP + salary > target → engine adds surplus to p1Bal.Cash.
// snap.p1Cash will be non-zero; Portfolio Balances card shows £0.
// ─────────────────────────────────────────────
function makeBobbyFixture() {
  return [
    {
      year: 2026, p1Age: 67, p2Age: 65,
      target: 40000,
      realDeflator: 1.0,

      p1SP: 11500,   p2SP: 9800,   // combined SP = 21300 — below target, no surplus yet
      p1SalInc: 0,   p2SalInc: 20000, // p2 salary pushes total to 41300 — £1300 surplus
      p1IntDraw: 0,  p2IntDraw: 0,
      p1DivsUsed: 0, p2DivsUsed: 0,
      p1Drawn: { Cash: 0, GIA: 0, ISA: 0, SIPP: 0, sippTaxable: 0 },
      p2Drawn: { Cash: 0, GIA: 0, ISA: 0, SIPP: 0, sippTaxable: 0 },

      p1IncomeTax: 0, p1CGT: 0, p1NI: 0,
      p2IncomeTax: 0, p2CGT: 0, p2NI: 0,

      p1GrossIncome: 11500,
      p2GrossIncome: 29800,
      householdGrossIncome: 41300,

      totalPortfolio: 100000,

      // Bobby's Cash is non-zero because engine added £1300 surplus
      // but Portfolio Balances card was initialised to £0
      snap: {
        p1Cash:   1300,  // ← the ghost cash — engine bug
        p1IntBal: 0,
        p1GIA:    100000, p1SIPP: 0, p1ISA: 0,
        p2Cash:   0,
        p2IntBal: 0,
        p2GIA:    0,      p2SIPP: 0, p2ISA: 0,
      },
    },
  ];
}

  window.RenderTestRunner = {
    test,
    runSuite,
    makeFixture,
    makeBobbyFixture,
    TOL,
  };
})(); // end IIFE
