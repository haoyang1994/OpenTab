import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const home = read('home.js');
function homeSection(start, end) {
  const from = home.indexOf(start), to = home.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `calendar fixture requires live source boundaries: ${start} → ${end}`);
  return home.slice(from, to);
}
const calendar = homeSection('  function formatLunarKey', "  document.addEventListener('contextmenu'");
const constants = homeSection('  const SOLAR_TERM_NAMES', '  const elements =');
const declarations = homeSection('  let calendarPicker', '  let todoAddPending');
const dateHandler = homeSection("  elements.date.addEventListener('click'", '  elements.todoCollapseBtn.addEventListener');

// Exercise the shipped Flatpickr implementation and actual home handlers, not a
// replacement picker. This small DOM records work; it does not emulate layout,
// parse innerHTML, or make any browser elapsed-time/performance claims.
function create(locale, initialDate = new Date(2026, 9, 22, 12)) {
  const counts = { elements: 0, fragments: 0, listeners: 0, intl: 0, days: 0, focus: 0 };
  let now = initialDate.getTime();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  class Element {
    constructor(tag = 'div', fragment = false) {
      this.nodeName = tag.toUpperCase(); this.nodeType = fragment ? 11 : 1;
      this.children = []; this.parentNode = null; this.className = '';
      this.dataset = {}; this.style = {}; this.attributes = {}; this.events = new Map();
      this.value = ''; this.type = 'text';
    }
    get classList() {
      return {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const add = force ?? !this.classList.contains(name);
          this.classList[add ? 'add' : 'remove'](name); return add;
        }
      };
    }
    get firstChild() { return this.children[0] || null; }
    get firstElementChild() { return this.firstChild; }
    get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
    set innerHTML(value) {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = []; this.html = value;
    }
    get innerHTML() { return this.html || ''; }
    appendChild(child) {
      if (child.nodeType === 11) { [...child.children].forEach(node => this.appendChild(node)); return child; }
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child); child.parentNode = this; return child;
    }
    removeChild(child) {
      this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child;
    }
    insertBefore(child, next) {
      this.appendChild(child);
      if (next) { this.children.pop(); this.children.splice(this.children.indexOf(next), 0, child); }
      return child;
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) {
      counts.listeners++;
      if (!this.events.has(name)) this.events.set(name, []);
      this.events.get(name).push(callback);
    }
    removeEventListener(name, callback) {
      this.events.set(name, (this.events.get(name) || []).filter(item => item !== callback));
    }
    click() { for (const callback of this.events.get('click') || []) callback({ target: this, stopPropagation() {} }); }
    focus() { counts.focus++; }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    getElementsByTagName(tag) {
      return this.children.flatMap(child => [
        ...(child.nodeName === tag.toUpperCase() ? [child] : []), ...child.getElementsByTagName(tag)
      ]);
    }
    querySelectorAll() { return []; }
    querySelector() { return null; }
  }
  const document = {
    createElement(tag) { counts.elements++; return new Element(tag); },
    createDocumentFragment() { counts.fragments++; return new Element('fragment', true); },
    addEventListener() { counts.listeners++; }, removeEventListener() {}, body: new Element('body')
  };
  const input = new Element('input'), popover = new Element(), date = new Element('button');
  popover.classList.add('hidden'); popover.appendChild(input);
  const context = {
    console: { ...console, error(error) { throw error; } },
    Date: ClockDate, HTMLElement: Element, Node: Element,
    navigator: { userAgent: 'Chrome' }, document, setTimeout, clearTimeout,
    requestAnimationFrame: () => 0, OpenTabI18n: { locale },
    elements: { calendarInput: input, calendarPopover: popover, date },
    state: { timezone: 'Asia/Shanghai' },
    rememberFocus(element) { assert.equal(element, date); counts.focus++; },
    countDay() { counts.days++; },
    Intl: { DateTimeFormat: function (...args) { counts.intl++; return new Intl.DateTimeFormat(...args); } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('vendor/flatpickr/flatpickr.min.js'), context);
  vm.runInContext(read('vendor/flatpickr/l10n/zh.js'), context);
  vm.runInContext(declarations + constants + calendar + dateHandler, context);
  vm.runInContext('const originalAnnotate = annotateCalendarDay; annotateCalendarDay = (element, date) => { countDay(); return originalAnnotate(element, date); };', context);
  return {
    context, counts, input, popover, date,
    get picker() { return input._flatpickr; },
    advance(date) { now = date.getTime(); },
    init: deferred => context.initCalendar(deferred),
    close: () => context.toggleCalendar(false),
    snapshot: () => ({ ...counts })
  };
}

function days(picker) {
  return picker.days.children.map(day => ({
    date: day.dateObj.getTime(), label: day.textContent, classes: day.className,
    annotations: day.children.map(tag => ({ text: tag.textContent, className: tag.className }))
  }));
}

for (const locale of ['en', 'zh-CN']) {
  const eager = create(locale), lazy = create(locale);
  eager.init();
  const before = lazy.snapshot();
  lazy.init(true); lazy.init(true); lazy.close();
  assert.deepEqual(lazy.snapshot(), before, `${locale}: deferred initialization creates no hidden DOM, formatter, listeners, or day callbacks`);
  assert.equal(lazy.picker, undefined);
  assert.equal(lazy.popover.classList.contains('hidden'), true);
  lazy.context.state.timezone = 'Pacific/Honolulu';

  eager.date.click(); lazy.date.click();
  assert.ok(lazy.picker, `${locale}: first real date click creates Flatpickr`);
  assert.equal(lazy.picker.days.children.length, 42);
  assert.equal(lazy.popover.classList.contains('hidden'), false);
  assert.equal(lazy.counts.focus, 1);
  assert.deepEqual(days(lazy.picker), days(eager.picker), `${locale}: first-open dates, selection and annotations match eager behavior`);
  assert.equal(lazy.picker.config.locale, locale === 'en' ? 'default' : 'zh');
  assert.equal(lazy.picker.l10n.months.longhand[9], locale === 'en' ? 'October' : '十月');
  assert.equal(lazy.counts.intl === 0, locale === 'en', 'English skips Chinese calendar annotations entirely');
  const picker = lazy.picker, built = lazy.snapshot();
  lazy.init(true); lazy.init();
  assert.deepEqual(lazy.snapshot(), built, 'reinitialization is idempotent after first open');
  lazy.date.click();
  assert.equal(lazy.popover.classList.contains('hidden'), true);
  assert.deepEqual(lazy.snapshot(), built, 'closing through the date button builds nothing');
  lazy.context.state.timezone = 'America/Los_Angeles';
  lazy.date.click();
  assert.equal(lazy.picker, picker, 'reopening reuses the picker');
  assert.equal(lazy.counts.listeners, built.listeners, 'reopening does not duplicate handlers');
  assert.deepEqual(days(lazy.picker), days(eager.picker), 'clock timezone changes do not reinterpret the local calendar');
  assert.equal(lazy.counts.focus, 2);
  lazy.close();
  assert.equal(lazy.popover.classList.contains('hidden'), true);
}

// Preserve the original selected date even if first open happens after midnight
// or a month/year boundary. Only the visible month jumps to the opening date.
for (const locale of ['en', 'zh-CN']) {
  const loaded = new Date(2026, 11, 31, 23, 59), opened = new Date(2027, 0, 1, 0, 1);
  const eager = create(locale, loaded), lazy = create(locale, loaded);
  eager.init(); lazy.init(true);
  eager.advance(opened); lazy.advance(opened);
  lazy.init(true); // A repeated state load must not recapture the selected day.
  eager.date.click(); lazy.date.click();
  assert.equal(lazy.picker.selectedDates[0].getTime(), eager.picker.selectedDates[0].getTime());
  assert.equal(lazy.picker.selectedDates[0].getDate(), 31);
  assert.equal(lazy.picker.selectedDates[0].getMonth(), 11);
  assert.equal(lazy.picker.currentYear, 2027);
  assert.equal(lazy.picker.currentMonth, 0);
  // Its initial "today" reference also stays tied to page load, just as before.
  assert.equal(lazy.picker.now.getTime(), eager.picker.now.getTime());
  assert.deepEqual(
    Array.from(lazy.picker.selectedDates, date => date.getTime()),
    Array.from(eager.picker.selectedDates, date => date.getTime())
  );
}

// The actual deck switch/minimal-mode paths call the actual home close adapter.
// Neither a hidden-card switch nor entering minimal mode should build a picker.
{
  const h = create('zh-CN');
  const deck = read('clock-deck.js');
  const methods = deck.slice(deck.indexOf('    function select('), deck.indexOf('    function refreshTodos('));
  const closeMethod = home.match(/    closeClockPopovers\(\) \{[^\n]+\}/)?.[0];
  assert.ok(closeMethod, 'exercise the real clock-popover closing adapter');
  const element = () => h.context.document.createElement('div');
  const controls = new Map();
  Object.assign(h.context, {
    index: 0, panels: [element(), element(), element()], dots: [],
    element: element(), status: element(), nav: element(), names: ['Time', 'Focus', 'Task'],
    t: value => value, refreshTodos() {},
    minimal: () => h.context.document.body.classList.contains('minimal-mode'),
    $(id) { if (!controls.has(id)) controls.set(id, element()); return controls.get(id); },
    toggleTimezoneSelector(open) { assert.equal(open, false); }
  });
  for (const id of ['clock-deck-peek', 'settings-btn']) h.context.$(id);
  h.context.adapter = vm.runInContext(`({ ${closeMethod} })`, h.context);
  vm.runInContext(methods, h.context);
  h.init(true);
  const before = h.snapshot();
  h.context.select(1);
  h.context.document.body.classList.add('minimal-mode');
  h.context.syncMode();
  assert.deepEqual(h.snapshot(), before, 'real deck and minimal-mode closure performs no hidden calendar work');
  assert.equal(h.context.index, 0);
  assert.equal(h.picker, undefined);
}

// The real state-loading adapter must use the deferred path before the grid.
{
  const h = create('zh-CN'), events = [];
  Object.assign(h.context, {
    OpenTabSceneSchema: { SCHEMA_KEY: 'sceneSchemaVersion' },
    OpenTabWorkspace: { migrationOverrides: () => ({}) },
    OpenTabBingCache: { afterStateLoaded() {} }
  });
  vm.runInContext(read('scene-home.js'), h.context);
  const state = {}, host = {
    state, HOME_FOLDER_ID: 'folder-home', LEGACY_PRESET_FOLDER_IDS: new Set(),
    activeHomeId: () => 'folder-home', t: value => value,
    ensureFolders: value => value, normalizeIconType: value => value,
    migrateBackground: value => value, backgroundsEqual: () => true,
    getFolderById: id => state.folders.find(folder => folder.id === id),
    updateClock() {}, renderTimezoneList() {},
    initCalendar(...args) { events.push('calendar'); h.context.initCalendar(...args); },
    renderWorkspaceSettings() {}, workspace: { seed() {} },
    refreshIconViews() {
      events.push('grid');
      assert.equal(h.picker, undefined, 'state loading reaches the grid without building the hidden calendar');
      assert.equal(h.counts.days, 0); assert.equal(h.counts.intl, 0);
    },
    renderTodos() {}, setTodoPanelOpen() {}, saveState() {}, writeBootMirror() {}
  };
  h.context.OpenTabSceneHome.create(host)({ folders: [{ id: 'folder-home', name: 'Home' }], icons: [] });
  assert.deepEqual(events, ['calendar', 'grid']);
  h.date.click();
  assert.equal(h.picker.days.children.length, 42, 'the same adapter still permits normal first opening');
}

console.log('Lazy calendar passed: real Flatpickr, zero hidden construction, locale, repeated open/close, timezone and captured selection.');
