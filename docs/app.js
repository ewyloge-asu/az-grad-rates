// Arizona Graduation Rate Comparison Tool
// Vanilla JS — loads data.json, renders Chart.js line chart + data table

(function () {
  'use strict';

  // ---------- Color palette for district lines ----------
  const PALETTE = [
    '#1f4788', '#c47e15', '#4a7c2a', '#6b2d8c', '#0d6e7a',
    '#b14d75', '#3d5e20', '#8a4d1a', '#2d5aa7', '#944a8c'
  ];
  const STATEWIDE_COLOR = '#a32d2d';

  // ---------- App state ----------
  const state = {
    data: null,                  // loaded data.json
    years: [],
    selected: [],                // array of { kind: 'statewide'|'district', id?, name, color, visible }
    searchHighlightIdx: -1,
  };

  let chart = null;

  // ---------- Bootstrapping ----------
  async function init() {
    try {
      const resp = await fetch('data.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      state.data = await resp.json();
      state.years = state.data.years;
    } catch (err) {
      document.querySelector('.tool').innerHTML =
        `<p style="color: #a32d2d; font-family: monospace;">Could not load data.json: ${err.message}</p>`;
      return;
    }

    // Default: statewide line on
    state.selected.push({
      kind: 'statewide',
      name: 'Arizona statewide average',
      color: STATEWIDE_COLOR,
      visible: true,
    });

    buildChart();
    renderChips();
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
            titleFont: { family: "'Space Grotesk', sans-serif", size: 12, weight: '600' },
            bodyFont: { family: "'Space Grotesk', sans-serif", size: 13 },
            padding: 12,
            borderColor: '#1a1a1a',
            displayColors: true,
            boxWidth: 10,
            boxHeight: 10,
            callbacks: {
              title: (items) => `Cohort ${items[0].label}`,
              label: (ctx) => {
                const v = ctx.parsed.y;
                return `  ${ctx.dataset.label}: ${v == null ? '—' : v.toFixed(1) + '%'}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false, drawBorder: true, color: '#d8d4ca' },
            ticks: {
              font: { family: "'Space Grotesk', sans-serif", size: 12 },
              color: '#4a4a4a',
              maxRotation: 0,
            },
          },
          y: {
            beginAtZero: false,
            suggestedMin: 40,
            suggestedMax: 100,
            grid: { color: '#ece9e1', drawBorder: false },
            ticks: {
              font: { family: "'Space Grotesk', sans-serif", size: 12 },
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

  function buildDataset(sel) {
    const series = sel.kind === 'statewide' ? state.data.statewide : findDistrict(sel.id);
    if (!series) return null;
    const data = state.years.map((y) => {
      const r = series.rates[String(y)];
      return r == null ? null : r;
    });
    return {
      label: displayLabel(sel),
      data,
      borderColor: sel.color,
      pointBackgroundColor: '#fff',
      pointBorderColor: sel.color,
      spanGaps: false,
      hidden: !sel.visible,
    };
  }

  // Display label: adds disambiguation for duplicate district names
  function displayLabel(sel) {
    if (sel.kind === 'statewide') return sel.name;
    const d = findDistrict(sel.id);
    if (!d) return sel.name;
    // If there's another district in state.data with the same name, disambiguate
    const duplicates = state.data.districts.filter(x => x.name === d.name);
    if (duplicates.length > 1) {
      const county = d.county ? `${d.county} County` : '';
      const parts = [county, `ID ${d.id}`].filter(Boolean);
      return `${d.name} (${parts.join(' · ')})`;
    }
    return d.name;
  }

  function updateChart() {
    if (!chart) return;
    chart.data.datasets = state.selected
      .map(buildDataset)
      .filter(Boolean);
    chart.update();
  }

  // ---------- Search ----------
  function wireSearch() {
    const input = document.getElementById('district-search');
    const results = document.getElementById('search-results');

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) {
        results.hidden = true;
        return;
      }
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
        if (el && !el.classList.contains('already-added')) {
          addDistrict(parseInt(el.dataset.id, 10));
        }
      } else if (e.key === 'Escape') {
        results.hidden = true;
        input.blur();
      }
    });

    // Click outside to close results
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-wrap')) {
        results.hidden = true;
      }
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
    // Identify names that appear more than once — we'll show county for those
    const nameCounts = new Map();
    state.data.districts.forEach(d => {
      nameCounts.set(d.name, (nameCounts.get(d.name) || 0) + 1);
    });
    const selectedIds = new Set(state.selected.filter(s => s.kind === 'district').map(s => s.id));
    results.innerHTML = matches.map((d) => {
      const already = selectedIds.has(d.id);
      const isDupe = nameCounts.get(d.name) > 1;
      const subtitle = isDupe
        ? `<span class="result-sub">${escapeHtml(d.county || '—')} County · ID ${d.id}</span>`
        : '';
      return `<li data-id="${d.id}" class="${already ? 'already-added' : ''}">
        <span class="result-main">${escapeHtml(d.name)}${already ? ' — already added' : ''}</span>
        ${subtitle}
      </li>`;
    }).join('');
    results.querySelectorAll('li[data-id]').forEach((li) => {
      li.addEventListener('click', () => {
        if (!li.classList.contains('already-added')) {
          addDistrict(parseInt(li.dataset.id, 10));
        }
      });
    });
    results.hidden = false;
  }

  function highlightSearchItem(items) {
    items.forEach((el, i) => {
      el.classList.toggle('highlighted', i === state.searchHighlightIdx);
    });
    const el = items[state.searchHighlightIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- Selection management ----------
  function addDistrict(id) {
    if (state.selected.some((s) => s.kind === 'district' && s.id === id)) return;
    const d = findDistrict(id);
    if (!d) return;
    const color = nextColor();
    state.selected.push({
      kind: 'district',
      id,
      name: d.name,
      color,
      visible: true,
    });
    document.getElementById('district-search').value = '';
    document.getElementById('search-results').hidden = true;
    renderAll();
  }

  function nextColor() {
    const used = state.selected
      .filter((s) => s.kind === 'district')
      .map((s) => s.color);
    for (const c of PALETTE) {
      if (!used.includes(c)) return c;
    }
    // All palette colors taken — cycle
    return PALETTE[state.selected.length % PALETTE.length];
  }

  function toggleSelected(idx) {
    state.selected[idx].visible = !state.selected[idx].visible;
    renderAll();
  }

  function removeSelected(idx) {
    state.selected.splice(idx, 1);
    renderAll();
  }

  // ---------- Chips ----------
  function renderChips() {
    const container = document.getElementById('chips');
    if (state.selected.length === 0) {
      container.innerHTML = '<span class="chips-empty">Nothing selected — search above to add a district.</span>';
      return;
    }
    container.innerHTML = state.selected.map((s, i) => {
      const label = displayLabel(s);
      return `
      <span class="chip ${s.visible ? '' : 'chip-off'}" data-idx="${i}" title="Click to ${s.visible ? 'hide' : 'show'}">
        <span class="chip-swatch" style="background:${s.color}"></span>
        <span class="chip-label">${escapeHtml(label)}</span>
        <button type="button" class="chip-remove" data-remove="${i}" aria-label="Remove ${escapeHtml(label)}">×</button>
      </span>
    `;}).join('');

    container.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        if (e.target.closest('.chip-remove')) return;
        toggleSelected(parseInt(chip.dataset.idx, 10));
      });
    });
    container.querySelectorAll('.chip-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSelected(parseInt(btn.dataset.remove, 10));
      });
    });
  }

  // ---------- Table ----------
  function renderTable() {
    const table = document.getElementById('data-table');
    if (state.selected.length === 0) {
      table.innerHTML = '<tbody><tr><td class="table-empty">Select at least one district to see data.</td></tr></tbody>';
      return;
    }

    const yearHeaders = state.years.map((y) => `<th>${y}</th>`).join('');
    const rows = state.selected.map((s) => {
      const series = s.kind === 'statewide' ? state.data.statewide : findDistrict(s.id);
      if (!series) return '';
      const cells = state.years.map((y) => {
        const v = series.rates[String(y)];
        if (v == null) return '<td class="suppressed">—</td>';
        return `<td>${v.toFixed(1)}</td>`;
      }).join('');
      return `<tr>
        <td><span class="row-swatch" style="background:${s.color}"></span>${escapeHtml(displayLabel(s))}</td>
        ${cells}
      </tr>`;
    }).join('');

    table.innerHTML = `
      <thead><tr><th>District</th>${yearHeaders}</tr></thead>
      <tbody>${rows}</tbody>
    `;
  }

  // ---------- CSV download ----------
  function wireDownload() {
    document.getElementById('download-csv').addEventListener('click', () => {
      if (state.selected.length === 0) return;
      const header = ['District', ...state.years].join(',');
      const lines = state.selected.map((s) => {
        const series = s.kind === 'statewide' ? state.data.statewide : findDistrict(s.id);
        const cells = state.years.map((y) => {
          const v = series.rates[String(y)];
          return v == null ? '' : v.toFixed(1);
        });
        const label = displayLabel(s);
        // Wrap name in quotes if it contains a comma
        const name = label.includes(',') ? `"${label.replace(/"/g, '""')}"` : label;
        return [name, ...cells].join(',');
      });
      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'az-grad-rates-comparison.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ---------- Utilities ----------
  function findDistrict(id) {
    return state.data.districts.find((d) => d.id === id);
  }

  function renderAll() {
    updateChart();
    renderChips();
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

  // ---------- Go ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
