'use strict';

/* ============================================================
 * 唯品TOP款一览 —— 筛选后动态重排 TOP100
 * 数据来源：候选池 pool-{period}-{gender}.json
 * 筛选栏：级联（品类逐级联动）+ 拼音排序 + 选项搜索
 * 排名变化：全局排名变化（非筛选后排名变化）
 * ============================================================ */

/* ── 1. 件单价区间（数值顺序） ── */
const PRICE_RANGES = [];
for (let lo = 0; lo < 700; lo += 50) {
  // 标签 100-149元，实际匹配 [100, 150)，即包含 149 元（max 取 lo+50）
  PRICE_RANGES.push({ label: `${lo}-${lo + 49}元`, min: lo, max: lo + 50 });
}
PRICE_RANGES.push({ label: '700元以上', min: 700, max: Infinity });

const DIMS = ['brand', 'cat1', 'cat2', 'cat3', 'cat4', 'price'];
const DIM_LABEL = { brand: '品牌', cat1: '一级', cat2: '二级', cat3: '三级', cat4: '四级', price: '件单价' };

/* ── 2. 状态 ── */
const POOL_CACHE = {};
let CURRENT_PERIOD = '7d';
let CURRENT_GENDER = 'female';
let CURRENT_POOL = [];
let CURRENT_TOTAL = 0;
let MASTER_OPTIONS = {};   // dim -> [[value, searchKey], ...]

/* ── 3. 多选组件（支持搜索） ── */
class MultiSelect {
  constructor(containerId, placeholder, searchable) {
    this.container = document.getElementById(containerId);
    this.placeholder = placeholder;
    this.searchable = searchable !== false;
    this.options = [];       // [[value, key], ...]
    this.selected = new Set();
    this.searchTerm = '';
    this._buildShell();
    this.bindStatic();
  }

  _buildShell() {
    this.container.innerHTML = `
      <div class="ms-display" tabindex="0">
        <span class="ms-placeholder">${this.placeholder}</span>
      </div>
      <div class="ms-dropdown" style="display:none">
        ${this.searchable ? '<input type="text" class="ms-search" placeholder="搜索…" autocomplete="off" />' : ''}
        <div class="ms-actions">
          <button class="ms-action" data-act="all">全选</button>
          <button class="ms-action" data-act="clear">清除</button>
          <span class="ms-count"></span>
        </div>
        <div class="ms-list"></div>
      </div>
    `;
    this.display = this.container.querySelector('.ms-display');
    this.dropdown = this.container.querySelector('.ms-dropdown');
    this.list = this.container.querySelector('.ms-list');
    this.searchInput = this.container.querySelector('.ms-search');
    this.countEl = this.container.querySelector('.ms-count');
  }

  bindStatic() {
    this.display.addEventListener('click', () => this.toggle());
    this.display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.toggle(); }
    });
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) this.close();
    });
    this.dropdown.querySelector('[data-act="all"]').addEventListener('click', () => {
      this.options.forEach(([v]) => this.selected.add(v));
      this.renderList(); this.updateDisplay();
    });
    this.dropdown.querySelector('[data-act="clear"]').addEventListener('click', () => {
      this.selected.clear();
      this.renderList(); this.updateDisplay();
    });
    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => {
        this.searchTerm = this.searchInput.value.trim().toLowerCase();
        this.renderList();
      });
    }
  }

  setOptions(options) {
    this.options = options || [];
    const valid = new Set(this.options.map(([v]) => v));
    for (const v of [...this.selected]) if (!valid.has(v)) this.selected.delete(v);
    this.renderList();
    this.updateDisplay();
  }

  renderList() {
    const term = this.searchTerm;
    const shown = this.options.filter(([v, k]) => !term || String(v).toLowerCase().includes(term) || (k && k.includes(term)));
    this.list.innerHTML = shown.map(([v]) =>
      `<div class="ms-option${this.selected.has(v) ? ' selected' : ''}" data-val="${v}">
         <input type="checkbox" ${this.selected.has(v) ? 'checked' : ''} /><span>${v}</span>
       </div>`).join('') || '<div class="ms-empty">无匹配项</div>';
    this.countEl.textContent = term ? `${shown.length}/${this.options.length}` : '';
    this.list.querySelectorAll('.ms-option').forEach(el => {
      el.addEventListener('click', () => {
        const val = el.dataset.val;
        if (this.selected.has(val)) this.selected.delete(val);
        else this.selected.add(val);
        el.classList.toggle('selected');
        el.querySelector('input').checked = this.selected.has(val);
        this.updateDisplay();
        if (typeof onFilterChange === 'function') onFilterChange();
      });
    });
  }

  toggle() {
    const open = this.dropdown.style.display !== 'none';
    document.querySelectorAll('.ms-dropdown').forEach(d => { if (d !== this.dropdown) d.style.display = 'none'; });
    document.querySelectorAll('.ms-display').forEach(d => d.classList.remove('open'));
    if (open) this.close(); else this.open();
  }

  open() {
    this.dropdown.style.display = '';
    this.display.classList.add('open');
    if (this.searchInput) { this.searchInput.value = this.searchTerm; this.searchInput.focus(); }
    this.renderList();
  }
  close() { this.dropdown.style.display = 'none'; this.display.classList.remove('open'); }

  updateDisplay() {
    if (this.selected.size === 0) {
      this.display.innerHTML = `<span class="ms-placeholder">${this.placeholder}</span>`;
    } else {
      const tags = [...this.selected].slice(0, 3).map(v => `<span class="ms-tag">${v}<span class="ms-tag-x" data-val="${v}">×</span></span>`).join('');
      const extra = this.selected.size > 3 ? `<span class="ms-tag">+${this.selected.size - 3}</span>` : '';
      this.display.innerHTML = tags + extra;
      this.display.querySelectorAll('.ms-tag-x').forEach(x => {
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selected.delete(x.dataset.val);
          this.renderList(); this.updateDisplay();
          if (typeof onFilterChange === 'function') onFilterChange();
        });
      });
    }
  }

  getSelected() { return [...this.selected]; }
  clear() { this.selected.clear(); this.renderList(); this.updateDisplay(); }
}

/* ── 4. 辅助 ── */
const catGradients = { 鞋: ['#f093fb', '#f5576c'] };
function catGradient(cat1) { return catGradients[cat1] || ['#8e9eab', '#eef2f3']; }

function placeholderImage(product) {
  const [c1, c2] = catGradient(product.cat1);
  const gid = 'g' + product.id;
  return `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${product.id}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#${gid})"/>
    <circle cx="200" cy="128" r="56" fill="rgba(255,255,255,0.92)"/>
    <text x="200" y="158" font-family="sans-serif" font-size="22" font-weight="bold" fill="#6b7280" text-anchor="middle">爆款</text>
    <text x="200" y="262" font-family="monospace" font-size="20" font-weight="bold" fill="rgba(255,255,255,0.95)" text-anchor="middle">${product.id}</text>
  </svg>`;
}

function rankBadgeClass(rank) {
  if (rank === 1) return 'rank-1';
  if (rank === 2) return 'rank-2';
  if (rank === 3) return 'rank-3';
  return 'rank-other';
}

function rankChangeHtml(p) {
  const rc = p.rankChange;
  if (rc === 'new') return '<span class="rank-change new">new</span>';
  if (rc === 'up') return `<span class="rank-change up">▲${p.delta}</span>`;
  if (rc === 'down') return `<span class="rank-change down">▼${p.delta}</span>`;
  return '<span class="rank-change same">—</span>';
}

function inPriceRange(p, range) {
  return p.unitPrice >= range.min && (range.max === Infinity || p.unitPrice < range.max);
}

/* ── 5. DOM ── */
const els = {
  confirm: document.getElementById('btnConfirm'),
  reset: document.getElementById('btnReset'),
  count: document.getElementById('resultCount'),
  hint: document.getElementById('resultHint'),
  grid: document.getElementById('cardGrid'),
  empty: document.getElementById('emptyState'),
  tabs: document.querySelectorAll('.tab-btn'),
  genderTabs: document.querySelectorAll('.gender-btn'),
};

let ms = {};

function buildMasterOptions(poolOptions) {
  const o = {};
  for (const dim of ['brand', 'cat1', 'cat2', 'cat3', 'cat4']) {
    o[dim] = (poolOptions && poolOptions[dim]) ? poolOptions[dim] : [];
  }
  o.price = PRICE_RANGES.map(r => [r.label, r.label]);
  return o;
}

function initMultiSelects() {
  MASTER_OPTIONS = buildMasterOptions(CURRENT_POOL_OPTIONS);
  ms = {
    brand: new MultiSelect('msBrand', '全部品牌'),
    cat1: new MultiSelect('msCat1', '全部一级品类'),
    cat2: new MultiSelect('msCat2', '全部二级品类'),
    cat3: new MultiSelect('msCat3', '全部三级品类'),
    cat4: new MultiSelect('msCat4', '全部四级品类'),
    price: new MultiSelect('msPrice', '全部件单价区间'),
  };
  refreshFilterOptions();
}

/* 级联：某维度的可选项 = 满足其他维度已选条件的记录中，该维度出现过的值 */
function matchesOtherDims(r, dim, sel) {
  for (const d of DIMS) {
    if (d === dim) continue;
    const chosen = sel[d];
    if (!chosen || chosen.length === 0) continue;
    if (d === 'price') {
      const ranges = chosen.map(l => PRICE_RANGES.find(x => x.label === l)).filter(Boolean);
      if (!ranges.some(rg => inPriceRange(r, rg))) return false;
    } else {
      if (!chosen.includes(r[d])) return false;
    }
  }
  return true;
}

function refreshFilterOptions() {
  const sel = {};
  for (const d of DIMS) sel[d] = ms[d] ? ms[d].getSelected() : [];

  for (const d of DIMS) {
    let opts;
    if (d === 'price') {
      // 件单价：只保留「其他维度命中记录中存在」的区间
      const others = CURRENT_POOL.filter(r => matchesOtherDims(r, 'price', sel));
      opts = MASTER_OPTIONS.price.filter(([v]) => {
        const rg = PRICE_RANGES.find(x => x.label === v);
        return rg && others.some(r => inPriceRange(r, rg));
      });
    } else {
      const allowed = new Set(
        CURRENT_POOL.filter(r => matchesOtherDims(r, d, sel)).map(r => r[d])
      );
      opts = MASTER_OPTIONS[d].filter(([v]) => allowed.has(v));
    }
    ms[d].setOptions(opts);
  }
}

/* 筛选条件变化时：级联更新选项（不自动应用结果，需点「确认筛选」） */
function onFilterChange() {
  refreshFilterOptions();
}

/* ── 6. 筛选 → 重排 → 取 TOP100 ── */
function applyFilters() {
  const f = {};
  for (const d of DIMS) f[d] = ms[d].getSelected();

  const hints = [];
  for (const d of DIMS) {
    if (f[d].length) hints.push(`${DIM_LABEL[d]}:${f[d].length > 1 ? f[d].length + '项' : f[d][0]}`);
  }
  els.hint.textContent = hints.length ? '当前筛选：' + hints.join(' · ') : '';

  const priceRanges = f.price.map(l => PRICE_RANGES.find(r => r.label === l)).filter(Boolean);

  let list = CURRENT_POOL.filter(p =>
    (!f.brand.length || f.brand.includes(p.brand)) &&
    (!f.cat1.length || f.cat1.includes(p.cat1)) &&
    (!f.cat2.length || f.cat2.includes(p.cat2)) &&
    (!f.cat3.length || f.cat3.includes(p.cat3)) &&
    (!f.cat4.length || f.cat4.includes(p.cat4)) &&
    (!priceRanges.length || priceRanges.some(r => inPriceRange(p, r)))
  );

  list.sort((a, b) => a.grank - b.grank);
  list = list.slice(0, 100);
  list = list.map((p, idx) => ({ ...p, rank: idx + 1 }));

  renderCards(list);
}

function renderCards(list) {
  els.count.innerHTML = `共 <strong>${list.length}</strong> 款商品`;
  els.empty.hidden = list.length > 0;
  els.grid.style.display = list.length ? '' : 'none';

  els.grid.innerHTML = list.map(p => {
    const imgContent = p.image
      ? `<img src="${p.image}" alt="${p.id}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div style="display:none;position:absolute;inset:0">${placeholderImage(p)}</div>`
      : placeholderImage(p);
    const linkHref = p.link || '#';
    const catDesc = [p.cat2, p.cat3, p.cat4].filter(Boolean).join(' · ');
    return `
    <article class="product-card">
      <div class="card-img-wrap">
        <a href="${linkHref}" target="_blank" rel="noopener noreferrer" class="card-img-link" title="点击查看商品详情">${imgContent}</a>
        <span class="rank-badge ${rankBadgeClass(p.rank)}">#${p.rank}</span>
      </div>
      <div class="card-body">
        <div class="card-brand">${p.brand}</div>
        <div class="card-style-no">${p.id}</div>
        <div class="card-main-style">${catDesc}</div>
        <div class="card-divider"></div>
        <div class="card-price-row">
          <div class="card-sales"><span class="card-sales-label">销售额：</span>${p.salesLabel}</div>
          <div class="card-unit-price">¥${p.unitPrice}</div>
        </div>
        <div class="card-rank-row">
          <div class="card-rank">排名 <span class="num">${p.rank}</span></div>
          ${rankChangeHtml(p)}
        </div>
      </div>
    </article>`;
  }).join('');
}

function resetFilters() {
  Object.values(ms).forEach(m => m.clear());
  refreshFilterOptions();
  applyFilters();
}

/* ── 7. 数据加载 ── */
function unpackPool(raw) {
  const recs = raw.records || [];
  return recs.map(r => {
    let rankChange = 'same', delta = 0;
    if (r.pr == null) { rankChange = 'new'; }
    else if (r.r < r.pr) { rankChange = 'up'; delta = r.pr - r.r; }
    else if (r.r > r.pr) { rankChange = 'down'; delta = r.r - r.pr; }
    return {
      id: r.i, brand: r.b, cat1: r.c1, cat2: r.c2, cat3: r.c3, cat4: r.c4,
      unitPrice: r.p, salesLabel: r.s, image: r.g, link: r.l,
      grank: r.r, prevGrank: r.pr, rankChange, delta,
    };
  });
}

let CURRENT_POOL_OPTIONS = null;

async function loadPool(period, gender) {
  const key = `${period}-${gender}`;
  if (POOL_CACHE[key]) return POOL_CACHE[key];
  const resp = await fetch(`./pools/pool-${period}-${gender}.json`, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`加载失败: ${resp.status}`);
  const raw = await resp.json();
  const pool = { records: unpackPool(raw), total: raw.n_total || 0, options: raw.options || null };
  POOL_CACHE[key] = pool;
  return pool;
}

/* ── 8. 视图切换 ── */
async function switchView() {
  els.grid.innerHTML = '<div class="loading">数据加载中…</div>';
  els.count.innerHTML = '加载中…';
  els.empty.hidden = true;
  try {
    const pool = await loadPool(CURRENT_PERIOD, CURRENT_GENDER);
    CURRENT_POOL = pool.records;
    CURRENT_TOTAL = pool.total;
    CURRENT_POOL_OPTIONS = pool.options;
    if (CURRENT_POOL.length > 0) {
      initMultiSelects();
    } else {
      els.grid.innerHTML = '';
      els.count.innerHTML = '共 <strong>0</strong> 款商品';
      els.empty.hidden = false;
      return;
    }
    applyFilters();
  } catch (err) {
    els.grid.innerHTML = `<div class="loading">加载失败：${err.message}</div>`;
    els.count.innerHTML = '';
  }
}

/* ── 9. 事件 ── */
els.confirm.addEventListener('click', () => {
  applyFilters();
  document.querySelector('.result-bar').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
els.reset.addEventListener('click', resetFilters);

els.tabs.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled || btn.classList.contains('active')) return;
    els.tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CURRENT_PERIOD = btn.dataset.period;
    switchView();
  });
});

els.genderTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    els.genderTabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    CURRENT_GENDER = btn.dataset.gender;
    switchView();
  });
});

/* ── 10. 初始化 ── */
if (location.protocol === 'file:') {
  // 浏览器禁止 file:// 页面 fetch 本地 JSON，给出明确指引（避免白屏）
  els.count.innerHTML = '';
  els.hint.textContent = '';
  els.empty.hidden = true;
  els.confirm.disabled = true;
  els.reset.disabled = true;
  document.querySelectorAll('.filter-item').forEach(e => e.style.display = 'none');
  els.grid.innerHTML = `<div class="file-hint">
      <p class="fh-title">⚠️ 请通过本地服务器打开</p>
      <p>浏览器禁止 <code>file://</code> 页面读取本地数据文件（<code>pools/*.json</code>），
         所以不能直接双击打开。</p>
      <p>在本文件夹下执行：</p>
      <pre>python3 -m http.server 8000</pre>
      <p>然后浏览器访问 <code>http://localhost:8000/</code></p>
    </div>`;
} else {
  switchView();
}
