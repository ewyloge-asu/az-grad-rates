// Arizona Schools: Diplomas vs. Demonstrated Skills (Comparison Tool)
// Vanilla JS — loads data-with-tests.json, renders Chart.js with 6 lines, single-district selection

(function () {
  'use strict';

  const COLORS = {
    grad: '#1f4788',
    ela:  '#c47e15',
    math: '#a32d2d',
  };

  const METRIC_LABELS = {
    grad_rate:    'Graduation rate',
    ela_passing:  'ELA Grade 11 passing',
    math_passing: 'Math Grade 11 passing',
  };

  const state = {
    data: null,
    years: [],
    selectedDistrictId: null,
    searchHighlightIdx: -1,
  };

  let chart = null;

  // ---------- Bootstrapping ----------
  async function init() {
    try {
      const resp = await fetch('data-with-tests.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      state.data = await resp.json();
      state.years = state.data.years;
    } catch (err) {
      document.querySelector('.tool').innerHTML =
        `<p style="color: #a32d2d;">Could not load data: ${err.message}</p>`;
      return;
    }

    buildChart();
    renderSelected();
    renderTable();
    wireSearch();
    wireDownload();
  }

  // ---------- Chart ----------
  function buildChart() {
    const ctx = document.getElementById('chart').getContext('2d');
    chart = new Chart(ctx, {
      type: 'line',
      data: { labels: state.years, datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1a1a1a',
            titleFont: { family: '-apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif', size: 12, weight: '600' },
            bodyFont: { family: '-apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif', size: 13 },
            padding: 12,
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const v = ctx.parsed.y;
                return `  ${ctx.dataset.label}: ${v == null ? '—' : v.toFixed(1) + '%'}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false, color: '#d8d4ca' },
            ticks: {
              font: { family: '-apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif', size: 12 },
              color: '#4a4a4a',
              maxRotation: 0,
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: 100,
            grid: { color: '#ece9e1' },
            ticks: {
              font: { family: '-apple-system, BlinkMacSystemFont, Helvetica Neue, Arial, sans-serif', size: 12 },
              color: '#4a4a4a',
              callback: (v) => v + '%',
            },
          },
        },
        elements: {
          line: { tension: 0.15, borderWidth: 2 },
          point: { radius: 3, hoverRadius: 5, borderWidth: 1.5, backgroundColor: '#fff' },
        },
      },
    });
    updateChart();
  }

  function buildDataset(metricKey, color, isStatewide) {
    const series = isStatewide
      ? state.data.statewide[metricKey]
      : (findDistrict(state.selectedDistrictId) || {})[metricKey];
    if (!series) return null;
    const data = state.years.map((y) => {
      const v = series[String(y)];
      return v == null ? null : v;
    });
    const districtName = !isStatewide && state.selectedDistrictId
      ? findDistrict(state.selectedDistrictId).name
      : null;
    const label = isStatewide
      ? `Statewide ${METRIC_LABELS[metricKey].toLowerCase()}`
      : `${districtName} — ${METRIC_LABELS[metricKey].toLowerCase()}`;
    // For statewide reference lines: lighter color, thinner, dotted, no markers
    const fadedColor = isStatewide ? hexToRgba(color, 0.75) : color;
    return {
      label,
      data,
      borderColor: fadedColor,
      pointBackgroundColor: '#fff',
      pointBorderColor: fadedColor,
      borderDash: isStatewide ? [3, 3] : [],
      borderWidth: isStatewide ? 2 : 2.5,
      pointRadius: isStatewide ? 0 : 4,
      pointHoverRadius: isStatewide ? 4 : 5,
      spanGaps: false,
    };
  }

  function updateChart() {
    if (!chart) return;
    const datasets = [];
    // Statewide reference lines (dashed) — always shown
    for (const [metricKey, color] of [['grad_rate', COLORS.grad], ['ela_passing', COLORS.ela], ['math_passing', COLORS.math]]) {
      const ds = buildDataset(metricKey, color, true);
      if (ds) datasets.push(ds);
    }
    // District lines (solid) — only if a district is selected
    if (state.selectedDistrictId) {
      for (const [metricKey, color] of [['grad_rate', COLORS.grad], ['ela_passing', COLORS.ela], ['math_passing', COLORS.math]]) {
        const ds = buildDataset(metricKey, color, false);
        if (ds) datasets.push(ds);
      }
    }
    chart.data.datasets = datasets;
    chart.update();
  }

  // ---------- Search ----------
  function wireSearch() {
    const input = document.getElementById('district-search');
    const results = document.getElementById('search-results');

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { results.hidden = true; return; }
      const matches = state.data.districts
        .filter((d) => d.name.toLowerCase().includes(q))
        .slice(0, 50);
      renderSearchResults(matches);
    });

    input.addEventListener('keydown', (e) => {
      const items = Array.from(results.querySelectorAll('li[data-id]'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.searchHighlightIdx = Math.min(state.searchHighlightIdx + 1, items.length - 1);
        highlightSearchItem(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.searchHighlightIdx = Math.max(state.searchHighlightIdx - 1, 0);
        highlightSearchItem(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const el = items[state.searchHighlightIdx];
        if (el) selectDistrict(parseInt(el.dataset.id, 10));
      } else if (e.key === 'Escape') {
        results.hidden = true;
        input.blur();
      }
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) results.hidden = true;
    });
  }

  function renderSearchResults(matches) {
    const results = document.getElementById('search-results');
    state.searchHighlightIdx = -1;
    if (matches.length === 0) {
      results.innerHTML = '<li class="no-results">No districts match</li>';
      results.hidden = false;
      return;
    }
    const nameCounts = new Map();
    state.data.districts.forEach(d => {
      nameCounts.set(d.name, (nameCounts.get(d.name) || 0) + 1);
    });
    results.innerHTML = matches.map((d) => {
      const isDupe = nameCounts.get(d.name) > 1;
      const subtitle = isDupe || d.county
        ? `<span class="result-sub">${escapeHtml(d.county || '—')} County · ID ${d.id}</span>`
        : '';
      return `<li data-id="${d.id}">
        <span>${escapeHtml(d.name)}</span>
        ${subtitle}
      </li>`;
    }).join('');
    results.querySelectorAll('li[data-id]').forEach((li) => {
      li.addEventListener('click', () => selectDistrict(parseInt(li.dataset.id, 10)));
    });
    results.hidden = false;
  }

  function highlightSearchItem(items) {
    items.forEach((el, i) => el.classList.toggle('highlighted', i === state.searchHighlightIdx));
    const el = items[state.searchHighlightIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Selection ----------
  function selectDistrict(id) {
    state.selectedDistrictId = id;
    document.getElementById('district-search').value = '';
    document.getElementById('search-results').hidden = true;
    renderAll();
  }

  function clearSelection() {
    state.selectedDistrictId = null;
    renderAll();
  }

  // ---------- Selected info card ----------
  function renderSelected() {
    const container = document.getElementById('selected-info');
    if (!state.selectedDistrictId) {
      container.innerHTML = '<p class="selected-empty">No district selected — search above to compare a district to the statewide average.</p>';
      return;
    }
    const d = findDistrict(state.selectedDistrictId);
    if (!d) return;
    const meta = [d.county ? `${d.county} County` : null, `LEA ${d.id}`].filter(Boolean).join(' · ');
    container.innerHTML = `
      <div class="selected-card">
        <div>
          <h3 class="selected-name">${escapeHtml(d.name)}</h3>
          <p class="selected-meta">${escapeHtml(meta)}</p>
        </div>
        <button type="button" class="selected-clear" onclick="window.__clearSelection()">Clear</button>
      </div>
    `;
  }
  // Expose to global for the inline onclick — keeping the handler simple
  window.__clearSelection = clearSelection;

  // ---------- Table ----------
  function renderTable() {
    const table = document.getElementById('data-table');
    const downloadBtn = document.getElementById('download-csv');

    const yearHeaders = state.years.map((y) => `<th>${y}</th>`).join('');
    let rows = '';

    // Build rows in metric-grouped sections: Graduation rate, ELA, Math
    for (const [metricKey, color] of [['grad_rate', COLORS.grad], ['ela_passing', COLORS.ela], ['math_passing', COLORS.math]]) {
      rows += `<tr class="row-section"><td colspan="${state.years.length + 1}">${METRIC_LABELS[metricKey]}</td></tr>`;
      // Statewide row (dashed)
      const stwSeries = state.data.statewide[metricKey];
      const stwCells = state.years.map((y) => {
        const v = stwSeries[String(y)];
        return v == null ? '<td class="suppressed">—</td>' : `<td>${v.toFixed(1)}</td>`;
      }).join('');
      rows += `<tr>
        <td><span class="row-swatch dashed" style="color:${color}"></span>Statewide average</td>
        ${stwCells}
      </tr>`;
      // District row (if selected)
      if (state.selectedDistrictId) {
        const d = findDistrict(state.selectedDistrictId);
        if (d) {
          const dSeries = d[metricKey];
          const dCells = state.years.map((y) => {
            const v = dSeries[String(y)];
            return v == null ? '<td class="suppressed">—</td>' : `<td>${v.toFixed(1)}</td>`;
          }).join('');
          rows += `<tr>
            <td><span class="row-swatch" style="background:${color}"></span>${escapeHtml(d.name)}</td>
            ${dCells}
          </tr>`;
        }
      }
    }

    table.innerHTML = `
      <thead><tr><th>Series</th>${yearHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    `;
    downloadBtn.disabled = false;
  }

  // ---------- CSV Download ----------
  function wireDownload() {
    document.getElementById('download-csv').addEventListener('click', () => {
      const header = ['Series', ...state.years].join(',');
      const lines = [header];
      for (const [metricKey] of [['grad_rate'], ['ela_passing'], ['math_passing']]) {
        const stwLabel = `Statewide ${METRIC_LABELS[metricKey].toLowerCase()}`;
        const stwCells = state.years.map((y) => {
          const v = state.data.statewide[metricKey][String(y)];
          return v == null ? '' : v.toFixed(1);
        });
        lines.push([csvField(stwLabel), ...stwCells].join(','));
        if (state.selectedDistrictId) {
          const d = findDistrict(state.selectedDistrictId);
          if (d) {
            const dLabel = `${d.name} — ${METRIC_LABELS[metricKey].toLowerCase()}`;
            const dCells = state.years.map((y) => {
              const v = d[metricKey][String(y)];
              return v == null ? '' : v.toFixed(1);
            });
            lines.push([csvField(dLabel), ...dCells].join(','));
          }
        }
      }
      const csv = lines.join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const districtName = state.selectedDistrictId ? findDistrict(state.selectedDistrictId).name : 'statewide';
      a.download = `az-grad-vs-tests_${slugify(districtName)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function csvField(s) {
    if (s.includes(',') || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  // ---------- Utilities ----------
  function findDistrict(id) {
    return state.data.districts.find((d) => d.id === id);
  }

  function renderAll() {
    updateChart();
    renderSelected();
    renderTable();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }


  // Convert hex color to rgba with given alpha
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }


  // Convert hex color to rgba with given alpha
  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ---------- Go ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
