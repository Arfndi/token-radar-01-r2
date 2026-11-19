// Token Radar's console dashboard, radar-3. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, the filters, the per-protocol detail panel, the
// validation panel and the live-token view. No network: every byte it shows is in data.js.
// The farm plan shown in the detail panel is the board's own farm_steps, so the page and
// board.json always agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtOdds(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return Math.round(n * 100) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function fmtRange(r) {
    if (r.rank_low === undefined || r.rank_high === undefined) return 'n/a';
    return '#' + r.rank_low + '–#' + r.rank_high;
  }
  // The model in one function, recomputed in the page from the snapshot figures: the detail panel
  // shows the same arithmetic board.json carries, so a reader can check any row by hand.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    var odds = row.launch_odds === null || row.launch_odds === undefined ? 1 : row.launch_odds;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * odds));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('minTvl')) state.minTvl = Number(params.get('minTvl')) || 0;
    if (params.get('wl')) state.wl = params.get('wl') === '1';
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.minTvl) params.set('minTvl', String(state.minTvl));
    if (state.wl) params.set('wl', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function isWatchlist(r) { return r.on_watchlist === true; }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.wl && !isWatchlist(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.minTvl && r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function renderStatic() {
    var top = DATA.rows[0];
    document.getElementById('mast-meta').innerHTML = '';
    var meta = document.getElementById('mast-meta');
    [['Snapshot', DATA.as_of], ['Model', DATA.model_version], ['Rows', String(DATA.board_size)]].forEach(function (pair) {
      var span = el('span', null, pair[0] + ' ', el('b', { text: pair[1] }));
      meta.appendChild(span);
    });
    document.getElementById('hero-title').textContent = DATA.watchlist_size + ' watchlist protocols, ranked by expected value';
    document.getElementById('hero-lede').textContent = 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, found by the same rule. Expected value is implied value times launch odds: a large launch in a category that almost never issues a token is worth less than a smaller one in a category that usually does. It is a model, not a promise.';
    var stats = document.getElementById('stats');
    stats.textContent = '';
    [['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
     ['Pre-token rows scored', String(DATA.board_size)],
     ['Early rows below the floor', String(DATA.early_size)],
     ['Live-token protocols set aside', String(DATA.live_size)],
     ['Top expected value', top ? fmtUsd(top.implied_value_usd) : 'n/a'],
     ['Size-curve slope', String(DATA.fitted_slope)],
     ['Global launch odds', fmtOdds(DATA.launch_odds_global)]].forEach(function (pair) {
      stats.appendChild(el('div', null, el('dt', { text: pair[0] }), el('dd', { text: pair[1] })));
    });
    var signals = document.getElementById('signals');
    signals.textContent = '';
    DATA.rows.slice(0, 5).forEach(function (r) {
      signals.appendChild(el('button', { class: 'signal', type: 'button', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: 'RANK ' + r.rank + ' · ' + fmtRange(r) + (isWatchlist(r) ? ' · WATCHLIST' : '') }),
        el('span', { class: 'name', text: r.name }),
        el('span', { class: 'val', text: fmtUsd(r.implied_value_usd) }),
        el('span', { class: 'sub', text: 'TVL ' + fmtUsd(r.tvl_usd) + ' · ' + (r.category || 'Other') + ' · odds ' + fmtOdds(r.launch_odds) })
      ));
    });
    renderValidation();
    var expl = document.getElementById('explainer');
    var m = DATA.model;
    expl.textContent = '';
    expl.appendChild(el('h2', { text: 'How expected value is computed' }));
    expl.appendChild(el('p', { text: 'One function scores every row. The launch multiple comes from a size curve fitted on the snapshot\'s own ' + DATA.n_live_fit + ' live-token protocols: log(mcap/TVL) ~ ' + DATA.fitted_intercept + ' + ' + DATA.fitted_slope + ' x log(TVL), with a category offset — the median residual of the category\'s live protocols, only when at least ' + m.min_live_for_category + ' report both figures, shrunk by n/(n+10) so a small category cannot steer the board. Bigger protocols price lower per TVL dollar, so a flat category median overpriced the biggest protocols and underpriced the smallest. Multiples are clamped to x' + m.multiple_floor + '–x' + m.multiple_cap + '; the band binds on ' + DATA.clamp_hits + ' of ' + DATA.board_size + ' board rows.' }));
    expl.appendChild(el('div', { class: 'formula', text: 'implied = round( tvl_usd x clamp(exp(' + DATA.fitted_intercept + ' + ' + DATA.fitted_slope + ' x ln(tvl_usd) + category_offset), ' + m.multiple_floor + ', ' + m.multiple_cap + ') x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x launch_odds )' }));
    expl.appendChild(el('p', { text: 'Launch odds are the share of protocols in the row\'s category that already have a token, shrunk toward the global rate (' + fmtOdds(DATA.launch_odds_global) + ') with a prior strength of ' + m.odds_prior_strength + ' and clamped to ' + m.odds_floor + '–' + m.odds_cap + '. Growth and age are small priors, not fitted effects: the live protocols show no growth premium (corr -0.15) and no age effect (corr 0.00), so growth counts at weight ' + m.growth_weight + ' and maturity spans only ' + m.maturity_floor + '–' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days + ' days. Every row also carries a rank range from ' + m.bootstrap_refits + ' bootstrap refits of the size curve (p10–p90): a row ranked #5 with a range of #3–#18 is less certain than one ranked #5 with #4–#6.' }));
    expl.appendChild(el('p', { text: 'Age is the time since the protocol was first listed — the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Protocols whose token already trades are set aside with their market caps shown, never mixed into the ranking. The snapshot records no token for the ranked protocols; that is a record, not proof that no token exists.' }));
    var foot = document.getElementById('foot');
    foot.textContent = '';
    foot.appendChild(el('p', null, el('b', { text: 'Read this before you farm: ' }), 'Expected value is this entry\'s own claim, never a price and never a promise that a token will be issued. “Records no token” means the snapshot carries no token for the protocol — not that it has none. Farming costs real gas and real capital; never pay anyone to claim an airdrop.'));
    foot.appendChild(el('p', { text: 'Source: ' + DATA.source + ' · Floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · ' + DATA.board_size + ' rows, ' + DATA.watchlist_size + ' on the watchlist · Model ' + DATA.model_version + '.' }));
  }

  function renderValidation() {
    var v = DATA.validation;
    if (!v) return;
    var box = document.getElementById('validation');
    box.textContent = '';
    box.appendChild(el('h2', { text: 'Does the size curve beat the old median?' }));
    box.appendChild(el('p', { text: 'Both models predict the market cap of live-token protocols they were not fitted on: 5-fold cross-validation (folds by slug, fit on train only) and a time split (train on the oldest half by first listing, test on the newest half). Errors are on log market cap, so a median error of 1.24 means the typical prediction is off by a factor of about ' + Math.exp(v.five_fold.radar3.med_ae).toFixed(1) + 'x.' }));
    var row = function (label, metric2, metric3) {
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num' + (metric2.med_ae < metric3.med_ae ? ' best' : ''), text: metric2.med_ae.toFixed(3) }),
        el('td', { class: 'num' + (metric3.med_ae < metric2.med_ae ? ' best' : ''), text: metric3.med_ae.toFixed(3) }),
        el('td', { class: 'num' + (metric2.mae < metric3.mae ? ' best' : ''), text: metric2.mae.toFixed(3) }),
        el('td', { class: 'num' + (metric3.mae < metric2.mae ? ' best' : ''), text: metric3.mae.toFixed(3) }),
        el('td', { class: 'num' + (metric2.spearman > metric3.spearman ? ' best' : ''), text: metric2.spearman.toFixed(3) }),
        el('td', { class: 'num' + (metric3.spearman > metric2.spearman ? ' best' : ''), text: metric3.spearman.toFixed(3) }),
        el('td', { class: 'num', text: String(metric3.n_test) })
      );
    };
    box.appendChild(el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Held-out live protocols: radar-2 is round 1\'s category-median multiple; radar-3 is this size curve. Lower error is better; higher Spearman is better.' }),
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Check' }),
          el('th', { scope: 'col', text: 'radar-2 medAE' }),
          el('th', { scope: 'col', text: 'radar-3 medAE' }),
          el('th', { scope: 'col', text: 'radar-2 MAE' }),
          el('th', { scope: 'col', text: 'radar-3 MAE' }),
          el('th', { scope: 'col', text: 'radar-2 Spearman' }),
          el('th', { scope: 'col', text: 'radar-3 Spearman' }),
          el('th', { scope: 'col', text: 'n' })
        )),
        el('tbody', null,
          row('5-fold CV', v.five_fold.radar2, v.five_fold.radar3),
          row('Time split', v.time_split.radar2, v.time_split.radar3)
        )
      )
    ));
    box.appendChild(el('p', { class: 'verdict', text: 'The size curve wins on absolute error in both checks — the typical held-out prediction is off by about ' + Math.exp(v.five_fold.radar3.med_ae).toFixed(1) + 'x instead of ' + Math.exp(v.five_fold.radar2.med_ae).toFixed(1) + 'x. Spearman is mixed: worse on 5-fold CV (' + v.five_fold.radar3.spearman.toFixed(2) + ' vs ' + v.five_fold.radar2.spearman.toFixed(2) + '), better on the time split (' + v.time_split.radar3.spearman.toFixed(2) + ' vs ' + v.time_split.radar2.spearman.toFixed(2) + ') — so the curve calibrates better but does not rank better everywhere. Round 1 had no validation at all; this is the first measurement of either model.' }));
  }

  function renderControls() {
    var box = document.getElementById('controls');
    box.textContent = '';
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderBoard(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderBoard(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderBoard(); });
    var tvlSel = el('select', { id: 'minTvl', 'aria-label': 'Minimum TVL' },
      [[0, 'Any TVL'], [10000000, 'TVL $10M+'], [50000000, 'TVL $50M+'], [100000000, 'TVL $100M+'], [500000000, 'TVL $500M+']].map(function (pair) {
        return el('option', { value: String(pair[0]), text: pair[1], selected: state.minTvl === pair[0] ? 'selected' : null });
      })
    );
    tvlSel.addEventListener('change', function () { state.minTvl = Number(tvlSel.value) || 0; writeHash(); renderBoard(); });
    var wlBox = el('label', { class: 'check' },
      el('input', { type: 'checkbox', checked: state.wl ? 'checked' : null, onchange: function (e) { state.wl = e.target.checked; writeHash(); renderBoard(); } }),
      'Watchlist only'
    );
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); renderBoard(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); renderBoard(); } });
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel));
    box.appendChild(el('div', { class: 'field' }, el('label', { for: 'minTvl', text: 'Min TVL' }), tvlSel));
    box.appendChild(wlBox);
    box.appendChild(el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)));
    box.appendChild(el('span', { class: 'count', id: 'count' }));
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderBoard(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.wl = false; writeHash(); renderBoard(); } })
      );
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', { class: 'num', text: fmtOdds(r.launch_odds) }),
        el('td', { class: 'num', text: fmtRange(r) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill' + (isWatchlist(r) ? ' hot' : ''), text: isWatchlist(r) ? 'watchlist · no token' : 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols, strongest expected value first. Select a row for its model breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          sortHeader('tvl', 'TVL'),
          sortHeader('growth', '7d'),
          sortHeader('age', 'Age'),
          sortHeader('multiple', 'Multiple'),
          sortHeader('odds', 'Odds'),
          el('th', { scope: 'col', text: 'Rank range' }),
          sortHeader('implied', 'Expected value'),
          el('th', { scope: 'col', text: 'Token' })
        )),
        tbody
      )
    );
  }

  function liveTable() {
    var count = document.getElementById('count');
    if (count) count.textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'table-wrap' },
      el('table', null,
        el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what price the board.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
        tbody
      )
    );
  }

  var detail = document.getElementById('detail');

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    detail.textContent = '';
    detail.hidden = false;
    var recomputed = impliedOf(row);
    var matches = recomputed === row.implied_value_usd;
    detail.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · range ' + fmtRange(row) + (isWatchlist(row) ? ' · on the watchlist' : ' · early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · first listed ' + (row.listed_at || 'date unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: closeDetail })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Expected value — the model, line by line' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Launch multiple (' + (row.multiple_source === 'curve+category' ? 'size curve + category offset' : 'size curve') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Launch odds (' + (row.odds_source === 'category' ? 'category rate' : 'global rate') + ')' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds) })),
        el('div', null, el('span', { text: 'Rank range (bootstrap p10–p90)' }), el('b', { class: 'num', text: fmtRange(row) })),
        el('div', { class: 'total' }, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'note', text: 'The page recomputes this row as ' + fmtUsd(recomputed) + (matches ? ', the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') + ' This is an estimate from the snapshot\'s own figures, not a price and not a promise of a token.' })
    ));
    detail.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — what to do' }),
      el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) { return el('li', { text: s }); })),
      el('p', { class: 'note', text: 'This plan is the board\'s own farm_steps for ' + row.name + '. It records no token: the plan farms the protocol as it stands, and says nothing about whether or when a token is issued.' })
    ));
  }

  function closeDetail() {
    state.selected = null;
    detail.hidden = true;
    writeHash();
    renderBoard();
  }

  function renderBoard() {
    var panel = document.getElementById('board-panel');
    panel.textContent = '';
    panel.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    var app = document.getElementById('app');
    if (app) app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
    else if (!detail.hidden) detail.hidden = true;
  }

  readHash();
  renderStatic();
  renderControls();
  renderBoard();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !detail.hidden) closeDetail();
  });
})();
