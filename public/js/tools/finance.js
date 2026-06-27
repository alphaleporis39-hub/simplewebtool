/**
 * Finance Tools — interactive logic
 * --------------------------------------------------------------------------
 * Tools:
 *   1. EMI Calculator        (EMI, total interest, total payment)
 *   2. SIP Calculator        (invested, wealth gained, final value + chart)
 *   3. Inflation Calculator  (future value of an amount)
 *
 * Depends on:
 *   - /js/script.js (shared helpers)
 *   - Chart.js (global `window.Chart`, loaded via CDN in finance.html)
 * --------------------------------------------------------------------------
 */

import { $, el, toast, formatCurrency, formatNumber, theme } from '/js/script.js';

/* ==========================================================================
   Shared helpers
   ========================================================================== */
function showResult(node) {
  node.classList.remove('is-empty');
}

function resultRow(key, value, valClass = '') {
  return el('div', { class: 'result-row' }, [
    el('span', { class: 'result-key', text: key }),
    el('span', { class: `result-val ${valClass}`.trim(), text: value }),
  ]);
}

function num(value) {
  if (value === '' || value == null) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/* ==========================================================================
   1. EMI Calculator
   --------------------------------------------------------------------------
   EMI = P * r * (1+r)^n / ((1+r)^n - 1)
     P = principal, r = monthly rate (annual%/12/100), n = months
   When r = 0 (interest-free), EMI = P / n.
   ========================================================================== */
function initEMI() {
  const form = $('#emiForm');
  if (!form) return;

  const amountEl = $('#emiAmount');
  const rateEl = $('#emiRate');
  const yearsEl = $('#emiYears');
  const errorEl = $('#emiError');
  const resultEl = $('#emiResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const principal = num(amountEl.value);
    const annualRate = num(rateEl.value);
    const years = num(yearsEl.value);

    if (Number.isNaN(principal) || Number.isNaN(annualRate) || Number.isNaN(years)) {
      errorEl.textContent = 'Please fill in all fields with valid numbers.';
      return;
    }
    if (principal <= 0) {
      errorEl.textContent = 'Loan amount must be greater than zero.';
      return;
    }
    if (annualRate < 0 || years <= 0) {
      errorEl.textContent = 'Rate cannot be negative and duration must be greater than zero.';
      return;
    }

    const months = Math.round(years * 12);
    const monthlyRate = annualRate / 12 / 100;

    let emi;
    if (monthlyRate === 0) {
      emi = principal / months;
    } else {
      const factor = Math.pow(1 + monthlyRate, months);
      emi = (principal * monthlyRate * factor) / (factor - 1);
    }

    const totalPayment = emi * months;
    const totalInterest = totalPayment - principal;

    resultEl.replaceChildren(
      resultRow('Monthly EMI', formatCurrency(emi), 'good'),
      resultRow('Principal', formatCurrency(principal)),
      resultRow('Total interest', formatCurrency(totalInterest)),
      resultRow('Total payment', formatCurrency(totalPayment)),
      resultRow('Tenure', `${months} months`)
    );
    showResult(resultEl);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
  });
}

/* ==========================================================================
   2. SIP Calculator (+ Chart.js)
   --------------------------------------------------------------------------
   Future value of a monthly SIP (annuity due / end-of-month convention):
     FV = P * [((1+i)^n - 1) / i] * (1+i)
       P = monthly investment, i = monthly rate, n = months
   When i = 0, FV = P * n.
   ========================================================================== */
let sipChart = null; // holds the Chart.js instance for re-theming/destroy

/** Resolve theme-aware colors for the chart. */
function chartColors() {
  const dark = theme.getApplied() === 'dark';
  return {
    text: dark ? '#b6c0d4' : '#475569',
    grid: dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)',
    invested: dark ? '#8b5cf6' : '#7c3aed',
    value: dark ? '#06b6d4' : '#0891b2',
    investedFill: dark ? 'rgba(139,92,246,0.18)' : 'rgba(124,58,237,0.12)',
    valueFill: dark ? 'rgba(6,182,212,0.18)' : 'rgba(8,145,178,0.12)',
  };
}

/** Compute year-by-year invested vs value series for the chart. */
function sipSeries(monthly, monthlyRate, totalMonths) {
  const labels = [];
  const investedSeries = [];
  const valueSeries = [];
  const years = Math.max(1, Math.round(totalMonths / 12));

  for (let y = 1; y <= years; y += 1) {
    const n = Math.min(y * 12, totalMonths);
    const invested = monthly * n;
    let value;
    if (monthlyRate === 0) {
      value = monthly * n;
    } else {
      value = monthly * ((Math.pow(1 + monthlyRate, n) - 1) / monthlyRate) * (1 + monthlyRate);
    }
    labels.push(`Y${y}`);
    investedSeries.push(Math.round(invested));
    valueSeries.push(Math.round(value));
  }
  return { labels, investedSeries, valueSeries };
}

/** Render or update the SIP chart. */
function renderSipChart(series) {
  const wrap = $('#sipChartWrap');
  const canvas = $('#sipChart');
  if (!wrap || !canvas) return;

  // Graceful fallback if Chart.js (CDN) didn't load.
  if (typeof window.Chart === 'undefined') {
    wrap.style.display = 'block';
    wrap.innerHTML =
      '<p class="text-soft" style="text-align:center;padding:1rem">Chart unavailable offline. Results above are still accurate.</p>';
    return;
  }

  const c = chartColors();
  wrap.style.display = 'block';

  const data = {
    labels: series.labels,
    datasets: [
      {
        label: 'Invested',
        data: series.investedSeries,
        borderColor: c.invested,
        backgroundColor: c.investedFill,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
      {
        label: 'Estimated value',
        data: series.valueSeries,
        borderColor: c.value,
        backgroundColor: c.valueFill,
        fill: true,
        tension: 0.3,
        pointRadius: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: c.text } },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: { ticks: { color: c.text }, grid: { color: c.grid } },
      y: {
        ticks: {
          color: c.text,
          callback: (v) => formatCurrency(v),
        },
        grid: { color: c.grid },
      },
    },
  };

  if (sipChart) {
    sipChart.data = data;
    sipChart.options = options;
    sipChart.update();
  } else {
    sipChart = new window.Chart(canvas.getContext('2d'), { type: 'line', data, options });
  }
}

function initSIP() {
  const form = $('#sipForm');
  if (!form) return;

  const monthlyEl = $('#sipMonthly');
  const returnEl = $('#sipReturn');
  const yearsEl = $('#sipYears');
  const errorEl = $('#sipError');
  const resultEl = $('#sipResult');
  const chartWrap = $('#sipChartWrap');

  // Keep the latest series so we can re-render on theme change.
  let lastSeries = null;

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const monthly = num(monthlyEl.value);
    const annualReturn = num(returnEl.value);
    const years = num(yearsEl.value);

    if (Number.isNaN(monthly) || Number.isNaN(annualReturn) || Number.isNaN(years)) {
      errorEl.textContent = 'Please fill in all fields with valid numbers.';
      return;
    }
    if (monthly <= 0) {
      errorEl.textContent = 'Monthly investment must be greater than zero.';
      return;
    }
    if (annualReturn < 0 || years <= 0) {
      errorEl.textContent = 'Return cannot be negative and years must be greater than zero.';
      return;
    }

    const months = Math.round(years * 12);
    const monthlyRate = annualReturn / 12 / 100;

    let finalValue;
    if (monthlyRate === 0) {
      finalValue = monthly * months;
    } else {
      finalValue =
        monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    }

    const invested = monthly * months;
    const wealthGained = finalValue - invested;

    resultEl.replaceChildren(
      resultRow('Invested amount', formatCurrency(invested)),
      resultRow('Wealth gained', formatCurrency(wealthGained), 'good'),
      resultRow('Final value', formatCurrency(finalValue), 'good')
    );
    showResult(resultEl);

    lastSeries = sipSeries(monthly, monthlyRate, months);
    renderSipChart(lastSeries);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
    lastSeries = null;
    if (sipChart) {
      sipChart.destroy();
      sipChart = null;
    }
    if (chartWrap) chartWrap.style.display = 'none';
  });

  // Re-theme the chart when the user toggles light/dark.
  window.addEventListener('swt:themechange', () => {
    if (lastSeries) renderSipChart(lastSeries);
  });
}

/* ==========================================================================
   3. Inflation Calculator
   --------------------------------------------------------------------------
   Future value (cost) = P * (1 + rate)^years
   Shows how much the same amount/purchasing target will cost later, and the
   loss of purchasing power of P over the period.
   ========================================================================== */
function initInflation() {
  const form = $('#inflationForm');
  if (!form) return;

  const amountEl = $('#infAmount');
  const rateEl = $('#infRate');
  const yearsEl = $('#infYears');
  const errorEl = $('#infError');
  const resultEl = $('#infResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const amount = num(amountEl.value);
    const rate = num(rateEl.value);
    const years = num(yearsEl.value);

    if (Number.isNaN(amount) || Number.isNaN(rate) || Number.isNaN(years)) {
      errorEl.textContent = 'Please fill in all fields with valid numbers.';
      return;
    }
    if (amount <= 0) {
      errorEl.textContent = 'Amount must be greater than zero.';
      return;
    }
    if (rate < 0 || years < 0) {
      errorEl.textContent = 'Rate and years cannot be negative.';
      return;
    }

    const factor = Math.pow(1 + rate / 100, years);
    const futureValue = amount * factor;
    // Purchasing power of today's `amount` after inflation.
    const purchasingPower = amount / factor;

    resultEl.replaceChildren(
      resultRow('Future cost (same goods)', formatCurrency(futureValue), 'bad'),
      resultRow('Increase', formatCurrency(futureValue - amount)),
      resultRow("Today's value in future", formatCurrency(purchasingPower)),
      resultRow('Purchasing power lost', `${formatNumber((1 - 1 / factor) * 100, 2)}%`)
    );
    showResult(resultEl);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
  });
}

/* ==========================================================================
   Bootstrap
   ========================================================================== */
function initFinanceTools() {
  initEMI();
  initSIP();
  initInflation();

  if (typeof window.Chart === 'undefined') {
    // Non-fatal: SIP still computes; chart shows a fallback message on use.
    console.warn('Chart.js not loaded — SIP chart will show an offline fallback.');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFinanceTools);
} else {
  initFinanceTools();
}
