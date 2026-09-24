// =====================================================================
//  Hadith Explorer (Android) — mobile UI
//  Talks to Kotlin via window.Android.* (see HadithApi.kt). Those calls
//  are synchronous and return JSON strings, so `api.xxx()` below just
//  parses them — kept as a small wrapper so the rest of this file reads
//  the same either way.
// =====================================================================

const $ = id => document.getElementById(id);
const screenEl = $('screen');

const api = {
  getBooks: () => JSON.parse(Android.getBooks()),
  getChapters: bookId => JSON.parse(Android.getChapters(bookId)),
  getChapterHadiths: (bookId, num) => JSON.parse(Android.getChapterHadiths(bookId, num)),
  getHadith: id => JSON.parse(Android.getHadith(id)),
  randomHadith: () => parseInt(Android.randomHadith(), 10),
  stats: () => JSON.parse(Android.stats()),
  search: filters => JSON.parse(Android.search(JSON.stringify(filters))),
  chapterFilter: q => JSON.parse(Android.chapterFilter(q)),
  listBookmarks: () => JSON.parse(Android.listBookmarks()),
  toggleBookmark: id => JSON.parse(Android.toggleBookmark(id)),
};

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// =====================================================================
//  NAVIGATION — one stack per bottom tab. Each stack entry is
//  { render: fn(container), title: string }. Switching tabs shows that
//  tab's current top screen; drilling in pushes; back pops.
//  window.handleNativeBack() is polled by MainActivity's back-press
//  handler and must return the *string* 'true'/'false'.
// =====================================================================
const stacks = { books: [], search: [], favorites: [] };
let activeTab = 'books';

function pushScreen(tab, entry) {
  stacks[tab].push(entry);
  render();
}

function popScreen() {
  if (stacks[activeTab].length > 1) {
    stacks[activeTab].pop();
    render();
    return true;
  }
  return false;
}

window.handleNativeBack = function () {
  return popScreen() ? 'true' : 'false';
};

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

function render() {
  const top = stacks[activeTab][stacks[activeTab].length - 1];
  $('appbar-title').textContent = top.title;
  $('back-btn').hidden = stacks[activeTab].length <= 1;
  screenEl.innerHTML = '';
  screenEl.scrollTop = 0;
  top.render(screenEl);
}

$('back-btn').addEventListener('click', popScreen);

document.querySelectorAll('.tab-btn').forEach(b =>
  b.addEventListener('click', () => switchTab(b.dataset.tab)));

// =====================================================================
//  Reusable: a hadith row with an inline favorite star (like the
//  reference app's list rows — favorite right from the list, no need
//  to open the hadith first).
// =====================================================================
function hadithRowHtml(h, snippetSource) {
  const snippet = (snippetSource === 'en' ? h.text_en : h.text_ar || h.text_en || '').slice(0, 90);
  const arabic = snippetSource !== 'en';
  return `
    <div class="hadith-row" data-id="${h.id}">
      <div class="hadith-row-main">
        <span class="hadith-row-ref">${esc(h.book_ar || h.book_en || '')} · #${esc(h.number_in_book)}</span>
        <span class="hadith-row-snippet ${arabic ? 'ar' : 'en'}">${esc(snippet)}…</span>
      </div>
      <button class="star-btn ${h.is_bookmarked ? 'on' : ''}" data-fav-id="${h.id}">
        ${h.is_bookmarked ? '★' : '☆'}
      </button>
    </div>`;
}

function wireHadithRows(container, rows, snippetSource) {
  container.querySelectorAll('.hadith-row').forEach(el => {
    const id = parseInt(el.dataset.id, 10);
    el.querySelector('.hadith-row-main').addEventListener('click', () => openHadith(id));
  });
  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.favId, 10);
      const res = api.toggleBookmark(id);
      btn.classList.toggle('on', res.bookmarked);
      btn.textContent = res.bookmarked ? '★' : '☆';
    });
  });
}

// =====================================================================
//  SCREEN: books list (root of the "Books" tab)
// =====================================================================
function renderBooksScreen(container) {
  const books = api.getBooks();
  container.innerHTML = `
    <div class="book-list">
      ${books.map(b => `
        <div class="book-card" data-id="${b.id}">
          <span class="book-card-ar">${esc(b.title_ar)}</span>
          <span class="book-card-en">${esc(b.title_en)}</span>
          ${b.author_ar ? `<span class="book-card-author">${esc(b.author_ar)}</span>` : ''}
        </div>`).join('')}
    </div>`;
  container.querySelectorAll('.book-card').forEach(el => {
    el.addEventListener('click', () => {
      const book = books.find(b => b.id === parseInt(el.dataset.id, 10));
      openBook(book);
    });
  });
}

function openBook(book) {
  pushScreen('books', {
    title: book.title_ar,
    render: (c) => renderChaptersScreen(c, book),
  });
}

// =====================================================================
//  SCREEN: chapters of one book
// =====================================================================
function renderChaptersScreen(container, book) {
  const chapters = api.getChapters(book.id);
  container.innerHTML = `
    <div class="chapter-list">
      ${chapters.map(c => `
        <div class="chapter-row" data-num="${c.number}">
          <span class="chapter-num">${c.number}</span>
          <span class="chapter-title">${esc(c.title_ar || c.title_en || '')}</span>
        </div>`).join('')}
    </div>`;
  container.querySelectorAll('.chapter-row').forEach(el => {
    el.addEventListener('click', () => {
      const num = parseInt(el.dataset.num, 10);
      const ch = chapters.find(c => c.number === num);
      openChapter(book, ch);
    });
  });
}

function openChapter(book, chapter) {
  pushScreen('books', {
    title: chapter.title_ar || `الباب ${chapter.number}`,
    render: (c) => renderHadithListScreen(c, api.getChapterHadiths(book.id, chapter.number)),
  });
}

function renderHadithListScreen(container, rows) {
  container.innerHTML = `<div class="hadith-list">${
    rows.length
      ? rows.map(h => hadithRowHtml(h, 'ar')).join('')
      : '<div class="empty">لا توجد أحاديث</div>'
  }</div>`;
  wireHadithRows(container, rows, 'ar');
}

// =====================================================================
//  SCREEN: single hadith reader (pushed onto whichever tab opened it)
// =====================================================================
function openHadith(id) {
  pushScreen(activeTab, {
    title: 'الحديث',
    render: (c) => renderReaderScreen(c, id),
  });
}

function renderReaderScreen(container, id) {
  const h = api.getHadith(id);
  if (!h) { container.innerHTML = '<div class="empty">لم يتم العثور على الحديث</div>'; return; }
  container.innerHTML = `
    <div class="hadith-card">
      <div class="hadith-card-book">${esc(h.book_ar)}</div>
      <div class="hadith-card-meta">
        الحديث رقم ${esc(h.number_in_book)}
        ${h.chap_ar ? ` · ${esc(h.chap_ar)}` : ''}
      </div>
      ${h.text_ar ? `<p class="hadith-arabic" dir="rtl">${esc(h.text_ar)}</p>` : ''}
      ${h.narrator_en ? `<p class="hadith-narrator" dir="ltr">${esc(h.narrator_en)}</p>` : ''}
      ${h.text_en ? `<p class="hadith-english" dir="ltr">${esc(h.text_en)}</p>` : ''}
      <button id="reader-fav-btn" class="fav-toggle-btn ${h.is_bookmarked ? 'on' : ''}">
        ${h.is_bookmarked ? '★ إزالة من المفضلة' : '☆ إضافة إلى المفضلة'}
      </button>
    </div>`;
  $('reader-fav-btn').addEventListener('click', () => {
    const res = api.toggleBookmark(id);
    const btn = $('reader-fav-btn');
    btn.classList.toggle('on', res.bookmarked);
    btn.textContent = res.bookmarked ? '★ إزالة من المفضلة' : '☆ إضافة إلى المفضلة';
  });
}

// =====================================================================
//  SCREEN: search (root of the "Search" tab)
//  Covers: free-text keywords, exact hadith number, narrator/sanad,
//  book author, optionally scoped to one book.
// =====================================================================
function renderSearchScreen(container) {
  const books = api.getBooks();
  container.innerHTML = `
    <div class="search-form">
      <input type="text" id="s-query" class="search-input" placeholder="كلمات من الحديث…">
      <button id="s-random" class="ghost-btn">🎲 حديث عشوائي</button>

      <details class="advanced-details">
        <summary>بحث متقدم (الرقم، الراوي/السند، المؤلف)</summary>
        <div class="advanced-grid">
          <label>الكتاب</label>
          <select id="s-book">
            <option value="">كل الكتب</option>
            ${books.map(b => `<option value="${b.id}">${esc(b.title_ar)}</option>`).join('')}
          </select>

          <label>رقم الحديث</label>
          <input type="number" id="s-number" placeholder="مثال: 12">

          <label>الراوي / السند</label>
          <input type="text" id="s-narrator" placeholder="مثال: Umar">

          <label>المؤلف</label>
          <input type="text" id="s-author" placeholder="مثال: Bukhari">
        </div>
      </details>

      <button id="s-go" class="primary-btn">بحث</button>
      <div id="s-results" class="hadith-list"></div>
    </div>`;

  const runSearch = () => {
    const filters = {
      query: $('s-query').value.trim(),
      narrator: $('s-narrator').value.trim(),
      author: $('s-author').value.trim(),
      book_id: $('s-book').value ? parseInt($('s-book').value, 10) : null,
      number: $('s-number').value ? parseInt($('s-number').value, 10) : null,
      limit: 300,
    };
    if (!filters.query && !filters.narrator && !filters.author &&
        filters.book_id == null && filters.number == null) return;
    const rows = api.search(filters);
    const results = $('s-results');
    results.innerHTML = rows.length
      ? rows.map(h => hadithRowHtml(h, /[\u0600-\u06FF]/.test(filters.query) ? 'ar' : 'ar')).join('')
      : '<div class="empty">لا نتائج</div>';
    wireHadithRows(results, rows, 'ar');
  };

  $('s-go').addEventListener('click', runSearch);
  $('s-query').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });
  $('s-random').addEventListener('click', () => {
    const id = api.randomHadith();
    if (id >= 0) openHadith(id);
  });
}

// =====================================================================
//  SCREEN: favorites (root of the "Favorites" tab)
// =====================================================================
function renderFavoritesScreen(container) {
  const rows = api.listBookmarks();
  container.innerHTML = `<div class="hadith-list">${
    rows.length
      ? rows.map(r => hadithRowHtml(
          { ...r, is_bookmarked: true, id: r.hadith_id }, 'ar')).join('')
      : '<div class="empty">لا توجد أحاديث مفضلة بعد</div>'
  }</div>`;
  wireHadithRows(container, rows, 'ar');
  // Un-starring here should drop the row immediately.
  container.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', () => setTimeout(() => renderFavoritesScreen(container), 150));
  });
}

// =====================================================================
//  THEME SHEET
// =====================================================================
function setupThemeSheet() {
  const sheet = $('theme-sheet');
  $('theme-btn').addEventListener('click', () => { sheet.hidden = false; });
  $('sheet-close-btn').addEventListener('click', () => { sheet.hidden = true; });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });

  document.querySelectorAll('.sheet-option').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  const saved = localStorage.getItem('theme') || 'mushaf';
  applyTheme(saved);

  const slider = $('font-size');
  const savedSize = localStorage.getItem('arabic-size');
  if (savedSize) {
    slider.value = savedSize;
    document.documentElement.style.setProperty('--arabic-size', savedSize + 'px');
  }
  slider.addEventListener('input', () => {
    document.documentElement.style.setProperty('--arabic-size', slider.value + 'px');
    localStorage.setItem('arabic-size', slider.value);
  });
}

function applyTheme(name) {
  $('theme-link').href = `themes/${name}.css`;
  localStorage.setItem('theme', name);
}

// =====================================================================
//  INIT
// =====================================================================
function init() {
  setupThemeSheet();
  stacks.books = [{ title: 'موسوعة الحديث', render: renderBooksScreen }];
  stacks.search = [{ title: 'البحث', render: renderSearchScreen }];
  stacks.favorites = [{ title: 'المفضلة', render: renderFavoritesScreen }];
  render();
}

if (typeof Android === 'undefined') {
  screenEl.innerHTML = '<div class="empty">هذا التطبيق يحتاج للعمل داخل تطبيق أندرويد (لا يعمل في متصفح عادي).</div>';
} else {
  init();
}
