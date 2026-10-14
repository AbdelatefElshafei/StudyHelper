/* ============================================================
   العدّاد — واجهة التطبيق
   بدون أي مكتبات خارجية. كل البيانات في localStorage.
   ============================================================ */
(function () {
  'use strict';

  const P = window.Planner;
  const SYL = window.ADDAD_SYLLABUS;
  const STORE_KEY = 'addad:v1';
  const APP_VERSION = '1.0.0';

  // ---------- أدوات صغيرة ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const today = () => P.dayKey(new Date());
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const fmtLong = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'short' });
  const fmtFull = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
  const fdate = (key, f = fmtShort) => f.format(P.toDate(key));

  function plural(n, one, two, few, many) {
    n = Math.round(n);
    if (n === 1) return one;
    if (n === 2) return two;
    if (n >= 3 && n <= 10) return `${n} ${few}`;
    return `${n} ${many}`;
  }
  const daysText = (n) => plural(n, 'يوم واحد', 'يومين', 'أيام', 'يوم');
  const minsText = (n) => plural(n, 'دقيقة واحدة', 'دقيقتين', 'دقائق', 'دقيقة');
  function hoursText(h) {
    const r = Math.round(h * 10) / 10;
    if (Number.isInteger(r)) return plural(r, 'ساعة واحدة', 'ساعتين', 'ساعات', 'ساعة');
    return `${r} ساعة`;
  }
  const h1 = (h) => (Math.round(h * 10) / 10).toString();

  const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const WD_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  const KIND = { study: 'مذاكرة', review: 'مراجعة', exam: 'مراجعة امتحان', custom: 'مهمة' };
  const MASTERY = ['لم أبدأ', 'ذاكرت', 'راجعت', 'متقن'];

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>',
  };

  // ---------- الحالة ----------
  let state = null;
  let view = 'today';
  const openSubjects = new Set();
  let deferredInstall = null;
  let pendingSharedPlan = null;

  function defaultSettings() {
    return {
      dailyHours: { 0: 3, 1: 3, 2: 3, 3: 3, 4: 3, 5: 5, 6: 5 },
      pomodoro: { work: 25, break: 5 },
      reviewIntervals: [1, 7, 30],
      examFocusDays: 3,
      bufferDays: 2,
      openHorizonDays: 21,
      maxSubjectsPerDay: 3,
      theme: 'auto',
    };
  }

  // لون ثابت للمادة (1..8)، ولو المواد زادت عن 8 بنبدأ من الأول
  function nextSlot() {
    const used = new Set(state ? state.subjects.map((s) => s.slot) : []);
    for (let i = 1; i <= 8; i++) if (!used.has(i)) return i;
    return ((state ? state.subjects.length : 0) % 8) + 1;
  }
  // سطور نصية → محاضرات: "اسم المحاضرة | الساعات" (الساعات اختيارية)
  function parseLectureLines(text, defaultHours) {
    return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const m = line.match(/^(.*?)[|،,]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:س|ساعة|ساعات|h)?\s*$/);
      const title = (m ? m[1] : line).trim().slice(0, 120);
      const hours = clamp(m ? Number(m[2]) : defaultHours, 0.5, 40);
      return title ? { title, hours } : null;
    }).filter(Boolean);
  }
  function addLectures(subjectId, items) {
    let order = P.lessonsOf(state, subjectId).length;
    const added = items.map((it) => {
      const l = { id: uid('l'), subjectId, title: it.title, hours: it.hours, doneHours: 0, mastery: 0, done: false, completedAt: null, reviews: [], order: order++ };
      state.lessons.push(l);
      return l;
    });
    const subj = subjectOf(subjectId);
    if (subj && !subj.currentLessonId && added[0]) subj.currentLessonId = added[0].id;
    return added;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.subjects) return null;
      s.settings = Object.assign(defaultSettings(), s.settings || {});
      s.log = s.log || [];
      s.dayOverrides = s.dayOverrides || {};
      s.skips = s.skips || { date: '', lessonIds: [] };
      return s;
    } catch (e) {
      console.warn('load failed', e);
      return null;
    }
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('مش قادر أحفظ البيانات: المساحة ممتلئة؟'); }
    }, 50);
  }

  function buildSubjectsFromSeed(seed) {
    const subjects = [];
    const lessons = [];
    (seed.subjects || []).forEach((s, idx) => {
      const id = uid('s');
      subjects.push({
        id, key: s.key || 'custom', name: s.name, short: s.short || String(s.name || '').slice(0, 10),
        slot: clamp(Number(s.slot) || (idx % 8) + 1, 1, 8), enabled: s.enabled !== false,
        examDate: s.examDate || null, currentLessonId: null,
      });
      (s.lessons || []).forEach((l, i) => {
        const [title, hours] = Array.isArray(l) ? l : [l.title, l.hours];
        lessons.push({ id: uid('l'), subjectId: id, title, hours: Number(hours) || 1, doneHours: 0, mastery: 0, done: false, completedAt: null, reviews: [], order: i });
      });
      const first = lessons.find((l) => l.subjectId === id);
      if (first) subjects[subjects.length - 1].currentLessonId = first.id;
    });
    return { subjects, lessons };
  }

  function createState({ name, schoolHours, offHours }) {
    const seed = pendingSharedPlan || SYL;
    const { subjects, lessons } = buildSubjectsFromSeed(seed);
    const settings = defaultSettings();
    for (let i = 0; i <= 4; i++) settings.dailyHours[i] = schoolHours;
    settings.dailyHours[5] = offHours;
    settings.dailyHours[6] = offHours;
    return {
      version: 1,
      createdAt: today(),
      profile: { name: name || '' },
      settings,
      subjects, lessons,
      log: [],
      plan: null,
      dayOverrides: {},
      skips: { date: '', lessonIds: [] },
      installDismissed: false,
    };
  }

  // ---------- خطة اليوم ----------
  function ensurePlan() {
    const t = today();
    if (!state.plan || state.plan.date !== t) {
      if (state.skips.date !== t) state.skips = { date: t, lessonIds: [] };
      state.plan = { date: t, tasks: P.buildToday(state, t, { excludeLessonIds: new Set(state.skips.lessonIds) }) };
      save();
    }
  }
  function regenerateToday() {
    const t = today();
    const keep = (state.plan ? state.plan.tasks : []).filter((x) => x.done || x.kind === 'custom' || x.doneMinutes > 0);
    const used = keep.reduce((a, x) => a + (x.done ? x.minutes : x.doneMinutes), 0);
    const budget = Math.max(0, Math.round(P.availableHours(state, t) * 60) - used);
    const exclude = new Set(state.skips.date === t ? state.skips.lessonIds : []);
    const excludeReviews = new Set();
    for (const x of keep) {
      if (x.lessonId) exclude.add(x.lessonId);
      if (x.kind === 'review' && x.lessonId) excludeReviews.add(x.lessonId + ':' + x.n);
    }
    const fresh = P.buildToday(state, t, { budgetMinutes: budget, excludeLessonIds: exclude, excludeReviewKeys: excludeReviews });
    state.plan = { date: t, tasks: keep.concat(fresh) };
    save();
  }

  function lessonOf(task) { return state.lessons.find((l) => l.id === task.lessonId) || null; }
  function subjectOf(id) { return state.subjects.find((s) => s.id === id) || null; }

  function addLog(task, minutes) {
    state.log.push({ date: today(), lessonId: task.lessonId || null, subjectId: task.subjectId || null, minutes, kind: task.kind });
  }
  function completeLesson(lesson) {
    lesson.done = true;
    lesson.doneHours = lesson.hours;
    lesson.completedAt = today();
    lesson.mastery = Math.max(1, lesson.mastery || 0);
    P.scheduleReviews(state, lesson, today());
  }
  function applyTaskMinutes(task, minutes) {
    if (minutes <= 0) return;
    addLog(task, minutes);
    task.doneMinutes = Math.min(task.minutes, task.doneMinutes + minutes);
    const lesson = lessonOf(task);
    if (lesson && task.kind === 'study') {
      lesson.doneHours = Math.min(lesson.hours, (lesson.doneHours || 0) + minutes / 60);
      if (lesson.hours - lesson.doneHours < 0.1 && !lesson.done) completeLesson(lesson);
    }
    if (task.doneMinutes >= task.minutes) finishTask(task);
    save();
  }
  function finishTask(task) {
    if (task.done) return;
    task.done = true;
    task.doneMinutes = task.minutes;
    const lesson = lessonOf(task);
    if (lesson) {
      if (task.kind === 'review') {
        const r = (lesson.reviews || []).find((x) => x.n === task.n);
        if (r) r.done = true;
        lesson.mastery = Math.min(3, (lesson.mastery || 0) + 1);
      } else if (task.kind === 'exam') {
        lesson.mastery = Math.max(2, lesson.mastery || 0);
      } else if (task.kind === 'study') {
        if (!lesson.done && lesson.hours - (lesson.doneHours || 0) < 0.1) completeLesson(lesson);
      }
    }
    save();
  }
  function markTaskDone(task) {
    const remaining = task.minutes - task.doneMinutes;
    if (remaining > 0) addLog(task, remaining);
    const lesson = lessonOf(task);
    if (lesson && task.kind === 'study') lesson.doneHours = Math.min(lesson.hours, (lesson.doneHours || 0) + remaining / 60);
    task.doneMinutes = task.minutes;
    finishTask(task);
  }
  function undoTask(task) {
    // إلغاء "تم": نشيل آخر سجل للمهمة دي النهاردة
    const t = today();
    let idx = -1;
    for (let i = state.log.length - 1; i >= 0; i--) {
      const e = state.log[i];
      if (e.date === t && e.lessonId === task.lessonId && e.kind === task.kind) { idx = i; break; }
    }
    let minutes = 0;
    if (idx >= 0) { minutes = state.log[idx].minutes; state.log.splice(idx, 1); }
    const lesson = lessonOf(task);
    if (lesson && task.kind === 'study') {
      lesson.doneHours = Math.max(0, (lesson.doneHours || 0) - minutes / 60);
      if (lesson.done && lesson.completedAt === t) { lesson.done = false; lesson.reviews = []; lesson.completedAt = null; }
    }
    if (lesson && task.kind === 'review') {
      const r = (lesson.reviews || []).find((x) => x.n === task.n);
      if (r) r.done = false;
      lesson.mastery = Math.max(0, (lesson.mastery || 0) - 1);
    }
    task.done = false;
    task.doneMinutes = Math.max(0, task.doneMinutes - minutes);
    save();
  }

  // ---------- عرض عام ----------
  function show(v) {
    view = v;
    $$('.view').forEach((x) => x.classList.add('hidden'));
    $(`#view-${v}`).classList.remove('hidden');
    $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    render();
    window.scrollTo({ top: 0 });
  }
  function render() {
    if (!state) return;
    ensurePlan();
    if (view === 'today') renderToday();
    else if (view === 'syllabus') renderSyllabus();
    else if (view === 'progress') renderProgress();
    else if (view === 'settings') renderSettings();
  }

  function paceChip(p) {
    if (p.status === 'done') return '<span class="chip good">🎉 المواد خلصت</span>';
    if (p.status === 'green') return '<span class="chip good">✅ في المسار</span>';
    if (p.status === 'yellow') return '<span class="chip warn">⚠️ محتاج شد شوية</span>';
    return '<span class="chip bad">🔴 متأخر عن الخطة</span>';
  }
  function paceMsg(p) {
    if (p.status === 'done') return 'خلصت كل الدروس! فاضل المراجعات بس.';
    const base = `محتاج ${h1(p.requiredPerDay)} س/يوم وعندك ${h1(p.availablePerDay)} س/يوم.`;
    if (p.status === 'red') return base + ' زوّد ساعاتك من الإعدادات، أو خلّي بعض المحاضرات أقصر.';
    if (p.status === 'yellow') return base + ' الهامش ضيق، حافظ على يومك.';
    return base + ' كمّل كده.';
  }

  // ---------- اليوم ----------
  function renderToday() {
    const t = today();
    const root = $('#view-today');
    const first = P.firstExam(state, t);
    const pace = P.pace(state, t);
    const tasks = state.plan.tasks;
    const doneN = tasks.filter((x) => x.done).length;
    const totalMin = tasks.reduce((a, x) => a + x.minutes, 0);
    const avail = P.availableHours(state, t);
    const focusDays = state.settings.examFocusDays;
    const examMode = first && P.daysBetween(t, first.examDate) <= focusDays && P.daysBetween(t, first.examDate) >= 0;
    const greeting = state.profile.name ? `أهلاً يا ${esc(state.profile.name)} 👋` : 'أهلاً بيك 👋';

    if (!state.subjects.length) {
      root.innerHTML = `
        <div class="view-head"><div><h1>${greeting}</h1><div class="sub">${fdate(t, fmtLong)}</div></div></div>
        <div class="card"><div class="empty"><div class="big">📚</div>ضيف أول مادة ومحاضراتها،<br>وأنا أبني لك خطة اليوم.<br><button class="btn primary" data-action="add-subject" style="margin-top:12px">＋ ضيف مادة</button></div></div>`;
      return;
    }

    let countdown = '';
    if (!first) {
      countdown = `
        <div class="row between wrap small">${paceChip(pace)}<span class="muted xs">باقي ${hoursText(pace.remainingTotal)} مذاكرة</span></div>
        <div class="pace-bar ${pace.status}" style="margin-top:8px"><i style="width:${clamp(Math.round(pace.ratio * 100), 2, 100)}%"></i></div>
        <div class="xs text-2" style="margin-top:6px">${paceMsg(pace)}</div>`;
    } else {
      const n = P.daysBetween(t, first.examDate);
      const word = n === 0 ? 'النهاردة' : n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? 'أيام' : 'يوم';
      countdown = `
        <div class="countdown">
          <div class="big num">${n}</div>
          <div class="grow">
            <div class="bold">${n === 0 ? 'امتحان ' + esc(first.short) + ' النهاردة!' : word + ' على امتحان ' + esc(first.short)}</div>
            <div class="lbl">${WD[P.weekday(first.examDate)]} ${fdate(first.examDate, fmtFull)}</div>
          </div>
        </div>
        <div class="pace">
          <div class="row between wrap small">${paceChip(pace)}<span class="muted xs">باقي ${hoursText(pace.remainingTotal)} مذاكرة</span></div>
          <div class="pace-bar ${pace.status}"><i style="width:${clamp(Math.round(pace.ratio * 100), 2, 100)}%"></i></div>
          <div class="xs text-2">${paceMsg(pace)}</div>
        </div>`;
    }

    const installBanner = deferredInstall && !state.installDismissed
      ? `<div class="banner"><span class="grow">📲 ثبّت العدّاد على موبايلك عشان يشتغل كتطبيق وأوفلاين.</span><button class="btn sm primary" data-action="install">تثبيت</button><button class="btn sm ghost" data-action="install-dismiss" aria-label="إغلاق">✕</button></div>`
      : '';
    const examBanner = examMode
      ? `<div class="banner warn">🎯 <span class="grow"><b>وضع الامتحانات:</b> امتحان ${esc(first.short)} ${P.daysBetween(t, first.examDate) === 0 ? 'النهاردة' : 'بعد ' + daysText(P.daysBetween(t, first.examDate))}. اليوم كله مراجعة ${esc(first.short)}، الأضعف الأول.</span></div>`
      : '';

    let list = '';
    if (!tasks.length) {
      if (!state.lessons.length) list = `<div class="card"><div class="empty"><div class="big">📝</div>ضيف محاضرات لموادّك من تبويب "المواد".</div></div>`;
      else if (avail <= 0) list = `<div class="card"><div class="empty"><div class="big">🛌</div>النهاردة من غير مذاكرة (0 ساعات).<br><button class="btn sm soft" data-action="hours" style="margin-top:10px">غيّر ساعات النهاردة</button></div></div>`;
      else if (pace.status === 'done') list = `<div class="card"><div class="empty"><div class="big">🏆</div>مفيش حاجة مستحقة النهاردة. استريح أو ضيف مهمة حرة.</div></div>`;
      else list = `<div class="card"><div class="empty"><div class="big">🤔</div>مفيش مهام. جرّب "إعادة توزيع".</div></div>`;
    } else {
      list = tasks.map(taskCard).join('');
    }
    const allDone = tasks.length && doneN === tasks.length;

    const currentRows = state.subjects.filter((s) => s.enabled && !P.expired(s, t)).map((s) => {
      const cl = P.currentLesson(state, s);
      return `
        <div class="lesson" data-action="pick-current" data-id="${s.id}" role="button" tabindex="0">
          <span class="dot" style="--c:var(--s${s.slot})"></span>
          <div class="grow"><div class="l-title">${esc(s.name)}</div><div class="l-meta">${cl ? '📍 ' + esc(cl.title) : s.examDate && !P.expired(s, t) ? 'خلصت كل المحاضرات 🎉' : 'ضيف محاضرات'}</div></div>
          <span class="chip">غيّر</span>
        </div>`;
    }).join('');

    root.innerHTML = `
      <div class="view-head">
        <div><h1>${greeting}</h1><div class="sub">${fdate(t, fmtLong)}</div></div>
        <button class="btn icon soft" data-action="report" aria-label="تقرير اليوم">${ICON.share}</button>
      </div>
      ${installBanner}
      <div class="card">${countdown}</div>
      ${examBanner}
      <div class="card">
        <div class="card-title"><h3>📍 محاضراتك الحالية</h3><span class="xs muted">اضغط لتغيير المحاضرة</span></div>
        ${currentRows || '<p class="muted small">مفيش مواد مفعّلة.</p>'}
      </div>
      <div class="row between" style="margin:4px 0 10px">
        <h2 class="row">مهام اليوم <span class="chip num">${doneN}/${tasks.length} · ${totalMin} د</span></h2>
        <button class="btn sm soft num" data-action="hours">⏱ ${h1(avail)} س</button>
      </div>
      ${allDone ? `<div class="banner" style="background:var(--good-soft);color:var(--good-text)">🎉 <span class="grow">خلصت كل مهام النهاردة! ابعت تقريرك وافتخر.</span></div>` : ''}
      ${list}
      <div class="btn-row" style="margin-top:6px">
        <button class="btn soft" data-action="add-task">＋ مهمة حرة</button>
        <button class="btn soft" data-action="regen">🔁 إعادة توزيع</button>
      </div>
      <button class="btn primary block" data-action="report" style="margin-top:10px">📤 ابعت تقرير اليوم على واتساب</button>
    `;
  }

  function taskCard(task) {
    const lesson = lessonOf(task);
    const subj = subjectOf(task.subjectId);
    const slot = subj ? subj.slot : 0;
    const title = task.kind === 'custom' ? task.title : (lesson ? lesson.title : '—');
    const kind = task.kind === 'review' ? `مراجعة ${task.n}` : KIND[task.kind];
    const pct = task.minutes ? Math.round((task.doneMinutes / task.minutes) * 100) : 0;
    return `
      <div class="task ${task.done ? 'done' : ''}" style="--c:${slot ? `var(--s${slot})` : 'var(--muted)'}" data-task="${task.id}">
        <button class="check ${task.done ? 'on' : ''}" data-action="toggle-task" data-id="${task.id}" aria-label="${task.done ? 'إلغاء الإتمام' : 'تم'}">${ICON.check}</button>
        <div class="t-main">
          <div class="t-sub"><span class="dot" style="--c:${slot ? `var(--s${slot})` : 'var(--muted)'}"></span>${esc(subj ? subj.short : 'عام')} · ${kind} · <span class="num">${task.minutes} د</span></div>
          <div class="t-title" title="${esc(title)}">${esc(title)}</div>
          ${task.doneMinutes > 0 && !task.done ? `<div class="t-prog"><i style="width:${pct}%"></i></div>` : ''}
        </div>
        <div class="t-actions">
          ${task.done ? '' : `<button class="btn icon sm primary" data-action="start" data-id="${task.id}" aria-label="ابدأ جلسة">${ICON.play}</button>`}
          <button class="btn icon sm ghost" data-action="task-menu" data-id="${task.id}" aria-label="خيارات">${ICON.more}</button>
        </div>
      </div>`;
  }

  // ---------- المنهج ----------
  function renderSyllabus() {
    const t = today();
    const root = $('#view-syllabus');
    const stats = P.subjectStats(state, t);
    const due = new Set(P.dueReviews(state, t).map((r) => r.lesson.id));
    const lessonCount = state.lessons.length;
    const doneCount = state.lessons.filter((l) => l.done).length;

    const heat = stats.filter((x) => x.subject.enabled).map((x) => `
      <div class="heat-row">
        <div class="hl" title="${esc(x.subject.name)}">${esc(x.subject.short)}</div>
        <div class="cells">${x.lessons.map((l) => `<span class="cell m${l.mastery || 0} ${due.has(l.id) ? 'due' : ''}" title="${esc(l.title)} — ${MASTERY[l.mastery || 0]}"></span>`).join('')}</div>
      </div>`).join('');

    const subjects = stats.map((x) => {
      const s = x.subject;
      const passed = x.daysLeft != null && x.daysLeft < 0;
      const color = `var(--s${s.slot})`;
      const cur = P.currentLesson(state, s);
      const lessons = x.lessons.map((l) => {
        const rem = P.remainingOfLesson(l);
        const meta = l.done
          ? `خلصت · ${MASTERY[l.mastery || 0]}${(l.reviews || []).some((r) => !r.done) ? ' · مراجعة ' + fdate((l.reviews || []).find((r) => !r.done).due) : ''}`
          : (l.doneHours > 0 ? `باقي ${hoursText(rem)} من ${hoursText(l.hours)}` : hoursText(l.hours));
        return `
          <div class="lesson" data-action="lesson" data-id="${l.id}" role="button" tabindex="0">
            <span class="mastery m${l.mastery || 0}" aria-label="${MASTERY[l.mastery || 0]}"><i></i><i></i><i></i></span>
            <div class="grow"><div class="l-title">${esc(l.title)}</div><div class="l-meta">${meta}${due.has(l.id) ? ' · <b style="color:var(--warn-text)">مراجعة مستحقة</b>' : ''}</div></div>
            ${l.done ? '<span class="chip good">✓</span>' : cur && cur.id === l.id ? '<span class="chip accent">📍 الحالية</span>' : ''}
          </div>`;
      }).join('');
      return `
        <details class="subject ${s.enabled ? '' : 'off'}" data-subject="${s.id}" ${openSubjects.has(s.id) ? 'open' : ''}>
          <summary>
            <div class="row between">
              <div class="row grow"><span class="dot" style="--c:${color}"></span><h3 class="grow">${esc(s.name)}</h3></div>
              ${!s.enabled ? '<span class="chip">غير مضافة</span>' : passed ? '<span class="chip good">خلص الموعد</span>' : s.examDate ? `<span class="chip num">موعد ${fdate(s.examDate)}</span>` : ''}
            </div>
            <div class="bar" style="--c:${color}"><i style="width:${Math.round(x.progress * 100)}%"></i></div>
            <div class="row between xs muted num"><span>${x.doneCount}/${x.lessonCount} محاضرات · ${Math.round(x.progress * 100)}%</span><span>باقي ${hoursText(x.remainingHours)}</span></div>
          </summary>
          <div class="subj-body">
            ${lessons || '<p class="muted small" style="padding:10px 0">مفيش محاضرات. ضيف أول محاضرة.</p>'}
            <div class="btn-row" style="margin-top:10px">
              <button class="btn sm soft" data-action="add-lesson" data-id="${s.id}">＋ محاضرات</button>
              <button class="btn sm soft" data-action="subject-menu" data-id="${s.id}">⚙️ إعدادات المادة</button>
            </div>
          </div>
        </details>`;
    }).join('');

    root.innerHTML = `
      <div class="view-head">
        <div><h1>المواد</h1><div class="sub">${state.subjects.length} مواد · ${lessonCount} محاضرة · ${doneCount} خلصت</div></div>
        <button class="btn sm soft" data-action="add-subject">＋ مادة</button>
      </div>
      ${state.subjects.length ? `<div class="card">
        <div class="card-title"><h3>خريطة المواد</h3><span class="xs muted">كل مربع = محاضرة</span></div>
        <div class="heat">${heat}</div>
        <div class="legend">
          <span><i class="cell m0"></i>لم أبدأ</span><span><i class="cell m1"></i>ذاكرت</span><span><i class="cell m2"></i>راجعت</span><span><i class="cell m3"></i>متقن</span><span><i class="cell due"></i>مراجعة مستحقة</span>
        </div>
      </div>` : '<div class="card"><div class="empty"><div class="big">📚</div>لسه مفيش مواد. اضغط "＋ مادة" وابدأ.</div></div>'}
      ${subjects}
    `;
    $$('details.subject', root).forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) openSubjects.add(d.dataset.subject); else openSubjects.delete(d.dataset.subject);
    }));
  }

  // ---------- التقدم ----------
  function renderProgress() {
    const t = today();
    const root = $('#view-progress');
    const streak = P.streak(state, t);
    const v7 = P.velocity(state, t, 7);
    const stats = P.subjectStats(state, t);
    const totalH = stats.filter((x) => x.subject.enabled).reduce((a, x) => a + x.totalHours, 0);
    const remH = stats.filter((x) => x.subject.enabled).reduce((a, x) => a + x.remainingHours, 0);
    const pct = totalH ? Math.round(((totalH - remH) / totalH) * 100) : 0;
    const pf = P.projectedFinish(state, t);
    const first = P.firstExam(state, t);

    let finishCard = '';
    if (pf.status === 'done') finishCard = '<div class="empty"><div class="big">🏁</div>خلصت كل المحاضرات. دلوقتي المراجعة هي اللعبة.</div>';
    else if (pf.status === 'insufficient') finishCard = `<p class="text-2">ذاكر <b>3 أيام</b> على الأقل (${pf.activeDays}/3 لحد دلوقتي) وهقولك بسرعتك الحالية هتخلص موادّك إمتى.</p>`;
    else if (pf.status === 'stalled') finishCard = '<p class="text-2">آخر أسبوع مفيش مذاكرة مسجلة. أول جلسة بومودورو هتصلّح الرقم ده.</p>';
    else {
      const ok = pf.margin >= 0;
      const pace = P.pace(state, t);
      const boost = v7.hoursPerDay + 0.5;
      const days2 = Math.ceil((pace.remainingTotal + pace.pendingReviewHours) / boost);
      const finish2 = P.addDays(t, days2);
      finishCard = `
        <p class="text-2">بسرعتك الحالية (<b class="num">${h1(pf.hoursPerDay)} س/يوم</b>) هتخلص كل المحاضرات يوم</p>
        <div class="row between wrap" style="margin:6px 0">
          <div style="font-size:22px;font-weight:800" class="num">${WD[P.weekday(pf.finish)]} ${fdate(pf.finish, fmtFull)}</div>
          ${first ? `<span class="chip ${ok ? 'good' : 'bad'}">${ok ? '✅ قبل الامتحان بـ ' + daysText(pf.margin) : '🔴 بعد الامتحان بـ ' + daysText(-pf.margin)}</span>` : ''}
        </div>
        <p class="xs muted">لو زودت نص ساعة بس يومياً، هتخلص يوم ${fdate(finish2)} بدل ${fdate(pf.finish)}.</p>`;
    }

    const bySubject = stats.filter((x) => x.subject.enabled).map((x) => `
      <div class="row" style="padding:7px 0">
        <span class="dot" style="--c:var(--s${x.subject.slot})"></span>
        <div class="grow">
          <div class="row between small"><b>${esc(x.subject.name)}</b><span class="muted num">${Math.round(x.progress * 100)}% · باقي ${hoursText(x.remainingHours)}</span></div>
          <div class="bar" style="--c:var(--s${x.subject.slot});margin-top:4px"><i style="width:${Math.round(x.progress * 100)}%"></i></div>
        </div>
      </div>`).join('');

    root.innerHTML = `
      <div class="view-head"><div><h1>التقدم</h1><div class="sub">مرآتك الصادقة</div></div></div>
      <div class="tiles">
        <div class="tile"><div class="v num">🔥 ${streak}</div><div class="k">${streak === 1 ? 'يوم متواصل' : streak === 2 ? 'يومين متواصلين' : 'أيام متواصلة'}</div></div>
        <div class="tile"><div class="v num">${h1(v7.minutes / 60)}</div><div class="k">ساعات آخر 7 أيام</div></div>
        <div class="tile"><div class="v num">${pct}%</div><div class="k">من المحاضرات</div></div>
      </div>
      <div class="card"><div class="card-title"><h3>📅 تاريخ الانتهاء المتوقع</h3></div>${finishCard}</div>
      <div class="card">
        <div class="card-title"><h3>آخر 14 يوم</h3><span class="xs muted">دقائق المذاكرة يومياً</span></div>
        ${barChart(t)}
      </div>
      <div class="card"><div class="card-title"><h3>المواد</h3></div>${bySubject}</div>
    `;
    attachChartTips(root);
  }

  function barChart(t) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(P.addDays(t, -i));
    const perDay = {};
    for (const e of state.log) perDay[e.date] = (perDay[e.date] || 0) + e.minutes;
    const vals = days.map((d) => perDay[d] || 0);
    const max = Math.max(60, ...vals);
    const W = 320, H = 130, padL = 6, padR = 6, padT = 18, padB = 22;
    const innerW = W - padL - padR, innerH = H - padT - padB;
    const bw = innerW / 14;
    const gap = 2;
    const maxIdx = vals.indexOf(Math.max(...vals));
    let bars = '';
    days.forEach((d, i) => {
      const v = vals[i];
      const h = v ? Math.max(3, (v / max) * innerH) : 0;
      const x = padL + i * bw + gap / 2;
      const y = padT + innerH - h;
      const w = bw - gap;
      const r = Math.min(4, w / 2);
      const path = h > 0
        ? `M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + h} Z`
        : '';
      const isToday = d === t;
      bars += `<g class="bar-g" data-date="${d}" data-min="${v}"><rect x="${x - gap / 2}" y="${padT}" width="${bw}" height="${innerH}" fill="transparent"/>${path ? `<path class="bar-mark ${isToday ? 'today' : ''}" d="${path}"/>` : ''}` +
        (i === maxIdx && v > 0 ? `<text class="val" x="${x + w / 2}" y="${y - 5}" text-anchor="middle">${v}</text>` : '') +
        (i % 2 === 1 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${P.toDate(d).getDate()}</text>` : '') +
        '</g>';
    });
    const grid = [0.5, 1].map((f) => `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${padT + innerH - innerH * f}" y2="${padT + innerH - innerH * f}"/>`).join('');
    return `<div style="direction:ltr"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="دقائق المذاكرة في آخر 14 يوم">${grid}<line class="grid" x1="${padL}" x2="${W - padR}" y1="${padT + innerH}" y2="${padT + innerH}"/>${bars}</svg></div>`;
  }
  function attachChartTips(root) {
    let tip = $('#chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.id = 'chart-tip'; tip.className = 'tip hidden'; document.body.appendChild(tip); }
    $$('.bar-g', root).forEach((g) => {
      const showTip = (e) => {
        const d = g.dataset.date; const m = Number(g.dataset.min);
        tip.textContent = `${fdate(d)} · ${minsText(m)}`;
        tip.classList.remove('hidden');
        const p = e.touches ? e.touches[0] : e;
        tip.style.left = p.clientX + 'px'; tip.style.top = p.clientY + 'px';
      };
      g.addEventListener('mousemove', showTip);
      g.addEventListener('touchstart', showTip, { passive: true });
      g.addEventListener('mouseleave', () => tip.classList.add('hidden'));
      g.addEventListener('touchend', () => setTimeout(() => tip.classList.add('hidden'), 1200));
    });
  }

  // ---------- الإعدادات ----------
  function renderSettings() {
    const root = $('#view-settings');
    const s = state.settings;
    const dh = s.dailyHours;
    const themeSeg = ['auto', 'light', 'dark'].map((k) => `<button class="${s.theme === k ? 'on' : ''}" data-action="theme" data-v="${k}">${{ auto: 'تلقائي', light: 'فاتح', dark: 'داكن' }[k]}</button>`).join('');
    root.innerHTML = `
      <div class="view-head"><div><h1>الإعدادات</h1><div class="sub">كل حاجة بتتحفظ تلقائياً</div></div></div>

      <div class="card">
        <div class="card-title"><h3>الطالب</h3></div>
        <div class="field"><label for="st-name">الاسم</label><input class="input" id="st-name" data-setting="name" value="${esc(state.profile.name)}" maxlength="30" /></div>
      </div>

      <div class="card">
        <div class="card-title"><h3>وقت المذاكرة</h3><span class="xs muted">ساعات كل يوم في الأسبوع</span></div>
        <div class="grid-7">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<div class="d"><span>${WD_SHORT[i]}</span><input type="number" min="0" max="16" step="0.5" value="${dh[i]}" data-setting="dh" data-i="${i}" inputmode="decimal" /></div>`).join('')}</div>
        <p class="hint xs" style="margin-top:6px">المتوسط: <b class="num">${h1(P.avgWeeklyHours(state))} س/يوم</b>. تقدر تغيّر يوم بعينه من زرار الساعة في صفحة اليوم.</p>
        <div class="grid-2" style="margin-top:10px">
          <div class="field"><label for="st-max">مواد في اليوم (حد أقصى)</label><select class="input" id="st-max" data-setting="maxSubjectsPerDay">${[2, 3, 4].map((n) => `<option value="${n}" ${s.maxSubjectsPerDay === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label for="st-focus">تركيز على مادة قبل موعدها بـ</label><select class="input" id="st-focus" data-setting="examFocusDays">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${s.examFocusDays === n ? 'selected' : ''}>${daysText(n)}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label for="st-open">مادة من غير موعد: وزّعها على</label><select class="input" id="st-open" data-setting="openHorizonDays">${[7, 14, 21, 30, 45, 60].map((n) => `<option value="${n}" ${s.openHorizonDays === n ? 'selected' : ''}>${daysText(n)}</option>`).join('')}</select><span class="hint">بيحدد سرعة الخطة للمواد اللي ملهاش موعد امتحان.</span></div>
      </div>

      <div class="card">
        <div class="card-title"><h3>البومودورو والمراجعة</h3></div>
        <div class="grid-2">
          <div class="field"><label for="st-work">جلسة المذاكرة (دقيقة)</label><input class="input" id="st-work" type="number" min="10" max="90" step="5" value="${s.pomodoro.work}" data-setting="work" inputmode="numeric" /></div>
          <div class="field"><label for="st-break">الراحة (دقيقة)</label><input class="input" id="st-break" type="number" min="1" max="30" step="1" value="${s.pomodoro.break}" data-setting="break" inputmode="numeric" /></div>
        </div>
        <div class="field"><label for="st-rev">مواعيد المراجعة المتباعدة (أيام بعد المذاكرة)</label><input class="input" id="st-rev" value="${s.reviewIntervals.join(', ')}" data-setting="reviewIntervals" inputmode="numeric" /><span class="hint">الافتراضي 1, 7, 30 — أفضل توقيتات لتثبيت المعلومة في الذاكرة.</span></div>
      </div>

      <div class="card">
        <div class="card-title"><h3>المظهر</h3></div>
        <div class="seg">${themeSeg}</div>
      </div>

      <div class="card">
        <div class="card-title"><h3>التطبيق والبيانات</h3></div>
        <div class="stack">
          ${deferredInstall ? '<button class="btn primary block" data-action="install">📲 تثبيت العدّاد على الموبايل</button>' : '<p class="xs muted">لتثبيت التطبيق: من قائمة المتصفح اختار "إضافة إلى الشاشة الرئيسية".</p>'}
          <button class="btn soft block" data-action="share-link">🔗 شارك خطتك مع صاحبك (رابط)</button>
          <button class="btn soft block" data-action="export">💾 تصدير نسخة احتياطية</button>
          <label class="btn soft block" for="import-file">📥 استيراد نسخة احتياطية</label>
          <input type="file" id="import-file" accept="application/json,.json" class="hidden" />
          <button class="btn danger block" data-action="reset">🗑 مسح كل البيانات</button>
        </div>
      </div>
      <p class="xs muted" style="text-align:center">العدّاد ${APP_VERSION} · صفر تكلفة · بياناتك على جهازك بس · مفيش حساب ولا سيرفر</p>
    `;
    $$('[data-setting]', root).forEach((inp) => inp.addEventListener('change', onSettingChange));
    const fileInput = $('#import-file', root);
    if (fileInput) fileInput.addEventListener('change', (e) => importJSON(e.target.files[0]));
  }

  function onSettingChange(e) {
    const inp = e.target;
    const k = inp.dataset.setting;
    const s = state.settings;
    if (k === 'name') state.profile.name = inp.value.trim();
    else if (k === 'openHorizonDays') s.openHorizonDays = Number(inp.value);
    else if (k === 'dh') s.dailyHours[inp.dataset.i] = clamp(Number(inp.value) || 0, 0, 16);
    else if (k === 'maxSubjectsPerDay') s.maxSubjectsPerDay = Number(inp.value);
    else if (k === 'examFocusDays') s.examFocusDays = Number(inp.value);
    else if (k === 'work') s.pomodoro.work = clamp(Number(inp.value) || 25, 10, 90);
    else if (k === 'break') s.pomodoro.break = clamp(Number(inp.value) || 5, 1, 30);
    else if (k === 'reviewIntervals') {
      const arr = inp.value.split(/[,، ]+/).map(Number).filter((n) => n > 0 && n < 365).sort((a, b) => a - b);
      s.reviewIntervals = arr.length ? arr : [1, 7, 30];
      inp.value = s.reviewIntervals.join(', ');
    }
    save();
    if (k === 'dh' || k === 'openHorizonDays' || k === 'maxSubjectsPerDay') regenerateToday();
    toast('اتحفظ ✓');
    if (k === 'dh') renderSettings();
  }

  // ---------- الصفحة السفلية ----------
  function openSheet(html) {
    $('#sheet-body').innerHTML = html;
    $('#sheet-wrap').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet-wrap').classList.remove('open');
    document.body.style.overflow = '';
  }

  function taskMenu(task) {
    const lesson = lessonOf(task);
    const title = task.kind === 'custom' ? task.title : (lesson ? lesson.title : '');
    openSheet(`
      <h2>${esc(title)}</h2>
      <div class="menu">
        ${task.done ? '' : `<button data-action="start" data-id="${task.id}">▶️ ابدأ جلسة بومودورو</button>
        <button data-action="toggle-task" data-id="${task.id}">✅ تم (سجّل ${task.minutes - task.doneMinutes} دقيقة)</button>
        <button data-action="log-custom" data-id="${task.id}">⏱ سجّل وقت مختلف…</button>`}
        ${lesson && task.kind === 'study' && !lesson.done ? `<button data-action="finish-lesson" data-id="${task.id}">🏁 خلصت الدرس كله</button>` : ''}
        ${task.done ? `<button data-action="toggle-task" data-id="${task.id}">↩️ إلغاء الإتمام</button>` : `<button data-action="defer" data-id="${task.id}">⏭ أجّل لبكرة</button>`}
        ${task.kind === 'custom' ? `<button class="danger" data-action="delete-task" data-id="${task.id}">🗑 حذف المهمة</button>` : ''}
      </div>`);
  }

  function lessonSheet(lesson) {
    const subj = subjectOf(lesson.subjectId);
    const reviews = (lesson.reviews || []).map((r) => `<span class="chip ${r.done ? 'good' : (P.daysBetween(r.due, today()) >= 0 ? 'warn' : '')}">${r.done ? '✓ ' : ''}مراجعة ${r.n}: ${fdate(r.due)}</span>`).join(' ');
    openSheet(`
      <h2>تعديل محاضرة</h2>
      <p class="small muted" style="margin-bottom:8px"><span class="dot" style="--c:var(--s${subj ? subj.slot : 1})"></span> ${esc(subj ? subj.name : '')}</p>
      ${lesson.done ? '' : `<button class="btn soft block" data-action="set-current" data-id="${lesson.id}" style="margin-bottom:12px">📍 دي المحاضرة اللي أنا فيها دلوقتي</button>`}
      <div class="field"><label for="ls-title">عنوان المحاضرة</label><input class="input" id="ls-title" value="${esc(lesson.title)}" maxlength="120" /></div>
      <div class="field"><label for="ls-hours">الساعات اللازمة لمذاكرته أول مرة</label><input class="input" id="ls-hours" type="number" min="0.5" max="40" step="0.5" value="${lesson.hours}" inputmode="decimal" /></div>
      <div class="field"><label>مستوى الإتقان</label><div class="seg" id="ls-mastery">${MASTERY.map((m, i) => `<button type="button" class="${(lesson.mastery || 0) === i ? 'on' : ''}" data-v="${i}">${m}</button>`).join('')}</div></div>
      <div class="setting-row"><span>خلصت مذاكرته الأولى</span><button class="switch ${lesson.done ? 'on' : ''}" id="ls-done" role="switch" aria-checked="${lesson.done}"></button></div>
      ${reviews ? `<div class="row wrap small" style="margin:8px 0">${reviews}</div>` : ''}
      <div class="btn-row" style="margin-top:12px">
        <button class="btn danger" data-action="delete-lesson" data-id="${lesson.id}">حذف</button>
        <button class="btn primary" data-action="save-lesson" data-id="${lesson.id}" style="flex:2">حفظ</button>
      </div>`);
    $('#ls-mastery').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      $$('#ls-mastery button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#ls-done').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); });
  }
  function saveLesson(lesson) {
    const title = $('#ls-title').value.trim();
    const hours = clamp(Number($('#ls-hours').value) || lesson.hours, 0.5, 40);
    const mastery = Number(($('#ls-mastery button.on') || {}).dataset?.v ?? lesson.mastery ?? 0);
    const done = $('#ls-done').classList.contains('on');
    if (title) lesson.title = title;
    lesson.hours = hours;
    lesson.mastery = mastery;
    if (done && !lesson.done) completeLesson(lesson);
    else if (!done && lesson.done) { lesson.done = false; lesson.doneHours = 0; lesson.reviews = []; lesson.completedAt = null; }
    if (done) lesson.mastery = Math.max(1, mastery);
    lesson.doneHours = Math.min(lesson.doneHours || 0, lesson.hours);
    save();
    closeSheet();
    regenerateToday();
    render();
    toast('اتحفظ ✓');
  }

  function addLessonSheet(subject) {
    openSheet(`
      <h2>محاضرات جديدة — ${esc(subject.name)}</h2>
      <div class="field"><label for="nl-title">كل سطر محاضرة</label>
        <textarea class="input" id="nl-title" rows="5" placeholder="المحاضرة 4: الجهاز العصبي&#10;المحاضرة 5 | 3"></textarea>
        <span class="hint">الساعات بعد علامة | اختيارية.</span></div>
      <div class="field"><label for="nl-hours">الساعات الافتراضية للمحاضرة</label><input class="input" id="nl-hours" type="number" min="0.5" max="40" step="0.5" value="2" inputmode="decimal" /></div>
      <button class="btn primary block" data-action="save-new-lesson" data-id="${subject.id}">إضافة</button>`);
    setTimeout(() => $('#nl-title').focus(), 50);
  }

  function subjectMenu(subject) {
    openSheet(`
      <h2>${esc(subject.name)}</h2>
      <div class="field"><label for="sj-name">اسم المادة</label><input class="input" id="sj-name" value="${esc(subject.name)}" maxlength="60" /></div>
      <div class="field"><label for="sj-short">اسم مختصر (للبطاقات)</label><input class="input" id="sj-short" value="${esc(subject.short)}" maxlength="14" /></div>
      <div class="field"><label for="sj-exam">موعد الامتحان أو التسليم (اختياري)</label><input class="input" id="sj-exam" type="date" value="${subject.examDate || ''}" /><span class="hint">امسح التاريخ لو مفيش موعد.</span></div>
      <div class="setting-row"><span>مضافة للخطة</span><button class="switch ${subject.enabled ? 'on' : ''}" id="sj-enabled" role="switch" aria-checked="${subject.enabled}"></button></div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn danger" data-action="delete-subject" data-id="${subject.id}">حذف المادة</button>
        <button class="btn primary" data-action="save-subject" data-id="${subject.id}" style="flex:2">حفظ</button>
      </div>`);
    $('#sj-enabled').addEventListener('click', (e) => e.currentTarget.classList.toggle('on'));
  }

  function addSubjectSheet() {
    openSheet(`
      <h2>مادة جديدة</h2>
      <div class="field"><label for="ns-name">اسم المادة</label><input class="input" id="ns-name" placeholder="مثال: التشريح" maxlength="60" /></div>
      <div class="field"><label for="ns-short">اسم مختصر (اختياري)</label><input class="input" id="ns-short" placeholder="مثال: تشريح" maxlength="14" /></div>
      <div class="field"><label for="ns-exam">موعد الامتحان أو التسليم (اختياري)</label><input class="input" id="ns-exam" type="date" /><span class="hint">سيبه فاضي لو مفيش موعد، والخطة هتمشي بسرعة ثابتة.</span></div>
      <div class="field"><label for="ns-lectures">المحاضرات (كل سطر محاضرة)</label>
        <textarea class="input" id="ns-lectures" rows="5" placeholder="المحاضرة 1: مقدمة&#10;المحاضرة 2: الجهاز العضلي | 2.5&#10;المحاضرة 3"></textarea>
        <span class="hint">تقدر تكتب الساعات بعد علامة | (مثال: المحاضرة 2 | 2.5). من غيرها بتتحسب ساعتين.</span></div>
      <button class="btn primary block" data-action="save-new-subject">إضافة</button>`);
    setTimeout(() => $('#ns-name').focus(), 50);
  }

  function pickCurrentSheet(subject) {
    const cur = P.currentLesson(state, subject);
    const rows = P.lessonsOf(state, subject.id).filter((l) => !l.done).map((l) =>
      `<button data-action="set-current" data-id="${l.id}">${cur && cur.id === l.id ? '📍' : '▫️'} ${esc(l.title)}</button>`).join('');
    openSheet(`
      <h2>إنت فين في ${esc(subject.name)}؟</h2>
      <p class="small muted" style="margin-bottom:8px">اختار المحاضرة اللي هتذاكرها الأول. الخطة هتبدأ منها.</p>
      <div class="menu">${rows || '<p class="muted small" style="padding:12px 0">مفيش محاضرات متبقية. ضيف محاضرات جديدة من تبويب المواد.</p>'}</div>
      <button class="btn soft block" data-action="add-lesson" data-id="${subject.id}" style="margin-top:10px">＋ ضيف محاضرات</button>`);
  }

  function hoursSheet() {
    const t = today();
    const cur = P.availableHours(state, t);
    openSheet(`
      <h2>ساعات النهاردة</h2>
      <p class="small muted" style="margin-bottom:10px">${fdate(t, fmtLong)} · الافتراضي ${h1(state.settings.dailyHours[P.weekday(t)])} س</p>
      <div class="field"><label for="hs-val">عدد الساعات</label><input class="input" id="hs-val" type="number" min="0" max="16" step="0.5" value="${cur}" inputmode="decimal" /></div>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn sm soft" data-action="hours-quick" data-v="0">🛌 أجازة</button>
        <button class="btn sm soft" data-action="hours-quick" data-v="1.5">⏳ ساعة ونص</button>
        <button class="btn sm soft" data-action="hours-quick" data-v="6">💪 يوم كامل</button>
      </div>
      <button class="btn primary block" data-action="hours-save">حفظ وإعادة توزيع</button>`);
  }

  function customTaskSheet() {
    const opts = state.subjects.filter((s) => s.enabled).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    openSheet(`
      <h2>مهمة حرة</h2>
      <div class="field"><label for="ct-title">إيه المهمة؟</label><input class="input" id="ct-title" placeholder="مثال: حل امتحان فيزياء 2024" maxlength="80" /></div>
      <div class="grid-2">
        <div class="field"><label for="ct-min">الدقائق</label><input class="input" id="ct-min" type="number" min="5" max="300" step="5" value="45" inputmode="numeric" /></div>
        <div class="field"><label for="ct-subj">المادة</label><select class="input" id="ct-subj"><option value="">عام</option>${opts}</select></div>
      </div>
      <button class="btn primary block" data-action="save-custom">إضافة لليوم</button>`);
    setTimeout(() => $('#ct-title').focus(), 50);
  }

  function logCustomSheet(task) {
    openSheet(`
      <h2>سجّل وقت</h2>
      <div class="field"><label for="lc-min">كام دقيقة ذاكرت؟</label><input class="input" id="lc-min" type="number" min="1" max="300" value="${Math.max(5, task.minutes - task.doneMinutes)}" inputmode="numeric" /></div>
      <button class="btn primary block" data-action="log-custom-save" data-id="${task.id}">تسجيل</button>`);
  }

  function confirmSheet(title, body, action, id, danger) {
    openSheet(`
      <h2>${title}</h2>
      <p class="text-2" style="margin-bottom:14px">${body}</p>
      <div class="btn-row">
        <button class="btn soft" data-action="close-sheet">إلغاء</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-action="${action}" data-id="${id || ''}" data-confirmed="1">تأكيد</button>
      </div>`);
  }

  // ---------- البومودورو ----------
  const pomo = { task: null, phase: 'work', total: 0, endAt: 0, paused: false, pausedRemaining: 0, timer: null, wakeLock: null, audio: null };
  const ARC = 276.46;

  function startPomodoro(task) {
    pomo.task = task;
    try { const AC = window.AudioContext || window['webkitAudioContext']; pomo.audio = pomo.audio || new AC(); } catch (e) { /* no audio */ }
    const lesson = lessonOf(task);
    const subj = subjectOf(task.subjectId);
    $('#pomo-title').textContent = task.kind === 'custom' ? task.title : (lesson ? lesson.title : '');
    $('#pomo-sub').textContent = `${subj ? subj.name + ' · ' : ''}${task.kind === 'review' ? 'مراجعة ' + task.n : KIND[task.kind]} · باقي ${task.minutes - task.doneMinutes} د من المهمة`;
    $('#pomo').classList.add('open');
    document.body.style.overflow = 'hidden';
    requestWakeLock();
    startPhase('work');
  }
  function startPhase(phase) {
    clearInterval(pomo.timer);
    pomo.phase = phase;
    const s = state.settings.pomodoro;
    let mins = phase === 'work' ? s.work : s.break;
    if (phase === 'work') {
      const left = pomo.task.minutes - pomo.task.doneMinutes;
      if (left > 0 && left < mins) mins = Math.max(5, left);
    }
    pomo.total = mins * 60 * 1000;
    pomo.endAt = Date.now() + pomo.total;
    pomo.paused = false;
    $('#pomo').classList.toggle('break', phase === 'break');
    $('#pomo-mode').textContent = phase === 'work' ? '🎯 جلسة مذاكرة' : '☕ راحة';
    $('#pomo-pause').textContent = 'إيقاف مؤقت';
    $('#pomo-skip').classList.toggle('hidden', phase !== 'break');
    $('#pomo-stop').textContent = phase === 'work' ? 'إنهاء وتسجيل' : 'إنهاء';
    tick();
    pomo.timer = setInterval(tick, 500);
  }
  function tick() {
    const rem = pomo.paused ? pomo.pausedRemaining : pomo.endAt - Date.now();
    const r = Math.max(0, rem);
    const m = Math.floor(r / 60000), sec = Math.floor((r % 60000) / 1000);
    $('#pomo-time').textContent = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    $('#pomo-arc').style.strokeDashoffset = ARC * (1 - r / pomo.total);
    if (rem <= 0 && !pomo.paused) phaseComplete();
  }
  function phaseComplete() {
    clearInterval(pomo.timer);
    beep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
    if (pomo.phase === 'work') {
      const mins = Math.round(pomo.total / 60000);
      applyTaskMinutes(pomo.task, mins);
      if (pomo.task.done) { closePomodoro(); toast('🎉 خلصت المهمة! عاش.'); render(); return; }
      toast(`✅ اتسجل ${minsText(mins)}. خد راحة.`);
      startPhase('break');
    } else {
      startPhase('work');
      toast('🎯 جلسة جديدة بدأت');
    }
  }
  function togglePause() {
    if (pomo.paused) {
      pomo.endAt = Date.now() + pomo.pausedRemaining;
      pomo.paused = false;
      $('#pomo-pause').textContent = 'إيقاف مؤقت';
    } else {
      pomo.pausedRemaining = Math.max(0, pomo.endAt - Date.now());
      pomo.paused = true;
      $('#pomo-pause').textContent = 'استئناف';
    }
  }
  function stopPomodoro() {
    clearInterval(pomo.timer);
    if (pomo.phase === 'work') {
      const rem = pomo.paused ? pomo.pausedRemaining : Math.max(0, pomo.endAt - Date.now());
      const elapsed = Math.round((pomo.total - rem) / 60000);
      if (elapsed >= 1) { applyTaskMinutes(pomo.task, elapsed); toast(`اتسجل ${minsText(elapsed)} ✓`); }
    }
    closePomodoro();
    render();
  }
  function closePomodoro() {
    clearInterval(pomo.timer);
    $('#pomo').classList.remove('open');
    document.body.style.overflow = '';
    releaseWakeLock();
  }
  function beep() {
    try {
      const ctx = pomo.audio; if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      [0, 0.25, 0.5].forEach((t) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.2);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.22);
      });
    } catch (e) { /* ignore */ }
  }
  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) pomo.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { $('#pomo-hint').textContent = ''; }
  }
  function releaseWakeLock() {
    try { if (pomo.wakeLock) { pomo.wakeLock.release(); pomo.wakeLock = null; } } catch (e) { /* ignore */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if ($('#pomo').classList.contains('open') && !pomo.wakeLock) requestWakeLock();
      if (state && state.plan && state.plan.date !== today()) { ensurePlan(); render(); }
    }
  });

  // ---------- التقرير والمشاركة ----------
  function reportText() {
    const t = today();
    const tasks = state.plan.tasks;
    const doneTasks = tasks.filter((x) => x.done);
    const mins = state.log.filter((e) => e.date === t).reduce((a, e) => a + e.minutes, 0);
    const pace = P.pace(state, t);
    const first = P.firstExam(state, t);
    const lines = [];
    lines.push(`📚 تقرير مذاكرة ${state.profile.name || 'النهاردة'} — ${fdate(t, fmtLong)}`);
    lines.push(`✅ أنجزت ${doneTasks.length} من ${tasks.length} مهام (${minsText(mins)})`);
    for (const x of tasks) {
      const l = lessonOf(x); const s = subjectOf(x.subjectId);
      const title = x.kind === 'custom' ? x.title : (l ? l.title : '');
      lines.push(`${x.done ? '✔️' : x.doneMinutes > 0 ? '🔸' : '▫️'} ${s ? s.short + ': ' : ''}${title} (${x.done ? x.minutes : x.doneMinutes + '/' + x.minutes} د)`);
    }
    const st = P.streak(state, t);
    if (st > 0) lines.push(`🔥 ${st === 1 ? 'يوم واحد' : st === 2 ? 'يومين' : daysText(st)} مذاكرة متواصلة`);
    if (first) lines.push(`⏳ باقي ${daysText(P.daysBetween(t, first.examDate))} على امتحان ${first.short}`);
    const stl = { green: '✅ في المسار', yellow: '⚠️ محتاج شد شوية', red: '🔴 متأخر عن الخطة', done: '🎉 المواد خلصت' }[pace.status];
    lines.push(`🚦 ${stl}`);
    lines.push('— من تطبيق العدّاد');
    return lines.join('\n');
  }
  async function shareReport() {
    const text = reportText();
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  function planPayload() {
    return {
      v: 2,
      subjects: state.subjects.map((s) => ({
        key: s.key, name: s.name, short: s.short, slot: s.slot, enabled: s.enabled, examDate: s.examDate || null,
        lessons: P.lessonsOf(state, s.id).map((l) => [l.title, l.hours]),
      })),
    };
  }
  async function shareLink() {
    const url = location.origin + location.pathname + '#plan=' + b64urlEncode(JSON.stringify(planPayload()));
    const text = `خطة مذاكرتي على العدّاد: ${url}`;
    if (navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(url); toast('الرابط اتنسخ ✓'); } catch (e) { prompt('انسخ الرابط:', url); }
  }
  function parseSharedPlan() {
    const m = location.hash.match(/#plan=([A-Za-z0-9_-]+)/);
    if (!m) return null;
    try {
      const p = JSON.parse(b64urlDecode(m[1]));
      if (!p || !Array.isArray(p.subjects)) return null;
      return p;
    } catch (e) { return null; }
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `addad-backup-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('اتصدّرت النسخة الاحتياطية ✓');
  }
  function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || !Array.isArray(s.subjects) || !Array.isArray(s.lessons)) throw new Error('bad');
        state = s;
        state.settings = Object.assign(defaultSettings(), s.settings || {});
        state.log = s.log || []; state.dayOverrides = s.dayOverrides || {}; state.skips = s.skips || { date: '', lessonIds: [] };
        state.plan = null;
        save(); applyTheme(); show('today'); toast('اتستوردت البيانات ✓');
      } catch (e) { toast('الملف مش صالح'); }
    };
    reader.readAsText(file);
  }

  // ---------- المظهر ----------
  function applyTheme() {
    const t = state ? state.settings.theme : 'auto';
    if (t === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- الأحداث ----------
  const actions = {
    'install': async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
      deferredInstall = null; render();
    },
    'install-dismiss': () => { state.installDismissed = true; save(); render(); },
    'report': () => shareReport(),
    'hours': () => hoursSheet(),
    'hours-quick': (b) => { $('#hs-val').value = b.dataset.v; },
    'hours-save': () => {
      const v = clamp(Number($('#hs-val').value) || 0, 0, 16);
      state.dayOverrides[today()] = v;
      closeSheet(); regenerateToday(); render(); toast('اتظبطت ساعات النهاردة ✓');
    },
    'add-task': () => customTaskSheet(),
    'save-custom': () => {
      const title = $('#ct-title').value.trim();
      const minutes = clamp(Math.round(Number($('#ct-min').value) || 30), 5, 300);
      if (!title) { toast('اكتب اسم المهمة'); return; }
      const subjectId = $('#ct-subj').value || null;
      const task = P.makeTask({ id: null }, { id: subjectId }, 'custom', minutes);
      task.lessonId = null; task.title = title;
      state.plan.tasks.push(task);
      save(); closeSheet(); render();
    },
    'regen': () => { regenerateToday(); render(); toast('اتوزعت الخطة من جديد ✓'); },
    'toggle-task': (b) => {
      const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (!task) return;
      if (task.done) { undoTask(task); toast('اتلغى الإتمام'); } else { markTaskDone(task); toast('تم ✓ عاش!'); }
      closeSheet(); render();
    },
    'start': (b) => {
      const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (!task) return;
      closeSheet(); startPomodoro(task);
    },
    'task-menu': (b) => { const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (task) taskMenu(task); },
    'log-custom': (b) => { const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (task) logCustomSheet(task); },
    'log-custom-save': (b) => {
      const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (!task) return;
      const m = clamp(Math.round(Number($('#lc-min').value) || 0), 1, 300);
      applyTaskMinutes(task, m); closeSheet(); render(); toast(`اتسجل ${minsText(m)} ✓`);
    },
    'finish-lesson': (b) => {
      const task = state.plan.tasks.find((x) => x.id === b.dataset.id); if (!task) return;
      const lesson = lessonOf(task); if (!lesson) return;
      const remaining = task.minutes - task.doneMinutes;
      if (remaining > 0) addLog(task, remaining);
      completeLesson(lesson);
      task.done = true; task.doneMinutes = task.minutes;
      save(); closeSheet(); regenerateToday(); render(); toast('🏁 الدرس خلص، والمراجعات اتجدولت');
    },
    'defer': (b) => {
      const i = state.plan.tasks.findIndex((x) => x.id === b.dataset.id); if (i < 0) return;
      const task = state.plan.tasks[i];
      if (task.lessonId) { if (state.skips.date !== today()) state.skips = { date: today(), lessonIds: [] }; state.skips.lessonIds.push(task.lessonId); }
      state.plan.tasks.splice(i, 1);
      save(); closeSheet(); regenerateToday(); render(); toast('اتأجلت لبكرة');
    },
    'delete-task': (b) => {
      const i = state.plan.tasks.findIndex((x) => x.id === b.dataset.id); if (i >= 0) state.plan.tasks.splice(i, 1);
      save(); closeSheet(); render();
    },
    'lesson': (b) => { const l = state.lessons.find((x) => x.id === b.dataset.id); if (l) lessonSheet(l); },
    'save-lesson': (b) => { const l = state.lessons.find((x) => x.id === b.dataset.id); if (l) saveLesson(l); },
    'delete-lesson': (b) => {
      if (!b.dataset.confirmed) { confirmSheet('حذف المحاضرة؟', 'هتتشال من المادة ومن الخطة.', 'delete-lesson', b.dataset.id, true); return; }
      state.lessons = state.lessons.filter((x) => x.id !== b.dataset.id);
      state.plan.tasks = state.plan.tasks.filter((x) => x.lessonId !== b.dataset.id);
      save(); closeSheet(); render(); toast('اتحذف');
    },
    'add-lesson': (b) => { const s = subjectOf(b.dataset.id); if (s) addLessonSheet(s); },
    'save-new-lesson': (b) => {
      const items = parseLectureLines($('#nl-title').value, clamp(Number($('#nl-hours').value) || 2, 0.5, 40));
      if (!items.length) { toast('اكتب محاضرة واحدة على الأقل'); return; }
      addLectures(b.dataset.id, items);
      openSubjects.add(b.dataset.id);
      save(); closeSheet(); regenerateToday(); render(); toast(items.length === 1 ? 'اتضافت ✓' : `اتضافت ${items.length} محاضرات ✓`);
    },
    'pick-current': (b) => { const s = subjectOf(b.dataset.id); if (s) pickCurrentSheet(s); },
    'set-current': (b) => {
      const l = state.lessons.find((x) => x.id === b.dataset.id); if (!l) return;
      const s = subjectOf(l.subjectId); if (!s) return;
      s.currentLessonId = l.id;
      // لو المحاضرة دي ماكانتش في خطة النهاردة، نعيد التوزيع عشان الخطة تبدأ منها
      save(); closeSheet(); regenerateToday(); render(); toast('📍 اتحددت المحاضرة الحالية');
    },
    'subject-menu': (b) => { const s = subjectOf(b.dataset.id); if (s) subjectMenu(s); },
    'save-subject': (b) => {
      const s = subjectOf(b.dataset.id); if (!s) return;
      const name = $('#sj-name').value.trim(); const short = $('#sj-short').value.trim(); const exam = $('#sj-exam').value;
      if (name) s.name = name; if (short) s.short = short; s.examDate = exam || null;
      s.enabled = $('#sj-enabled').classList.contains('on');
      save(); closeSheet(); regenerateToday(); render(); toast('اتحفظ ✓');
    },
    'delete-subject': (b) => {
      if (!b.dataset.confirmed) { confirmSheet('حذف المادة؟', 'هتتشال هي وكل دروسها وسجل مذاكرتها.', 'delete-subject', b.dataset.id, true); return; }
      const id = b.dataset.id;
      state.subjects = state.subjects.filter((x) => x.id !== id);
      state.lessons = state.lessons.filter((x) => x.subjectId !== id);
      state.plan.tasks = state.plan.tasks.filter((x) => x.subjectId !== id);
      save(); closeSheet(); render(); toast('اتحذفت');
    },
    'add-subject': () => addSubjectSheet(),
    'save-new-subject': () => {
      const name = $('#ns-name').value.trim(); if (!name) { toast('اكتب اسم المادة'); return; }
      const short = $('#ns-short').value.trim() || name.slice(0, 10);
      const exam = $('#ns-exam').value || null;
      const id = uid('s');
      state.subjects.push({ id, key: 'custom', name, short, slot: nextSlot(), enabled: true, examDate: exam, currentLessonId: null });
      const items = parseLectureLines($('#ns-lectures').value, 2);
      if (items.length) addLectures(id, items);
      openSubjects.add(id);
      save(); closeSheet(); regenerateToday(); render();
      toast(items.length ? `اتضافت ${name} بـ ${items.length} محاضرات ✓` : 'اتضافت ✓ ضيف محاضراتها دلوقتي');
    },
    'theme': (b) => { state.settings.theme = b.dataset.v; save(); applyTheme(); renderSettings(); },
    'share-link': () => shareLink(),
    'export': () => exportJSON(),
    'reset': (b) => {
      if (!b.dataset.confirmed) { confirmSheet('مسح كل البيانات؟', 'هتتمسح المواد والتقدم والسجل نهائياً. اعمل نسخة احتياطية الأول لو عايز.', 'reset', '', true); return; }
      localStorage.removeItem(STORE_KEY);
      closeSheet();
      location.hash = '';
      location.reload();
    },
    'close-sheet': () => closeSheet(),
    'import-plan': (b) => {
      if (!b.dataset.confirmed) { confirmSheet('استيراد الخطة من الرابط؟', 'هتستبدل المواد والدروس الحالية، وتقدمك فيها هيتمسح. السجل والإعدادات هيفضلوا.', 'import-plan', '', true); return; }
      const p = parseSharedPlan(); if (!p) { closeSheet(); return; }
      const { subjects, lessons } = buildSubjectsFromSeed(p);
      state.subjects = subjects; state.lessons = lessons; state.plan = null;
      save(); closeSheet(); history.replaceState(null, '', location.pathname); render(); toast('اتستوردت الخطة ✓');
    },
    'ignore-plan': () => { closeSheet(); history.replaceState(null, '', location.pathname); },
  };

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const fn = actions[b.dataset.action];
    if (fn) { e.preventDefault(); fn(b, e); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.lesson[data-action]')) { e.preventDefault(); const fn = actions[e.target.dataset.action]; if (fn) fn(e.target, e); }
    if (e.key === 'Escape') closeSheet();
  });
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (b) show(b.dataset.view); });
  $('#pomo-pause').addEventListener('click', togglePause);
  $('#pomo-stop').addEventListener('click', stopPomodoro);
  $('#pomo-skip').addEventListener('click', () => { if (pomo.phase === 'break') startPhase('work'); });

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; if (state && view === 'today') render(); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; toast('اتثبّت العدّاد 🎉'); });

  // ---------- الترحيب ----------
  function showOnboarding() {
    $('#view-onboarding').classList.remove('hidden');
    $('#nav').classList.add('hidden');
    if (pendingSharedPlan) {
      const note = document.createElement('div');
      note.className = 'banner';
      note.textContent = '🔗 فيه خطة جاية من رابط صاحبك، هتتحمّل تلقائياً.';
      $('#onb-form').prepend(note);
    }
    $('#onb-form').addEventListener('submit', (e) => {
      e.preventDefault();
      state = createState({
        name: $('#onb-name').value.trim(),
        schoolHours: clamp(Number($('#onb-h-school').value) || 3, 0, 16),
        offHours: clamp(Number($('#onb-h-off').value) || 5, 0, 16),
      });
      if (pendingSharedPlan) {
        pendingSharedPlan = null;
        history.replaceState(null, '', location.pathname);
      }
      save();
      $('#view-onboarding').classList.add('hidden');
      $('#nav').classList.remove('hidden');
      applyTheme();
      show('today');
      toast(state.subjects.length ? 'خطتك جاهزة 🚀' : 'ابدأ بإضافة أول مادة 📚');
    });
  }

  // ---------- البداية ----------
  function init() {
    state = load();
    const shared = parseSharedPlan();
    if (!state) {
      pendingSharedPlan = shared;
      showOnboarding();
    } else {
      applyTheme();
      $('#nav').classList.remove('hidden');
      show('today');
      if (shared) actions['import-plan']({ dataset: {} });
    }
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) toast('فيه نسخة أحدث، اقفل التطبيق وافتحه تاني');
          });
        });
      }).catch(() => { /* offline or unsupported */ });
    }
  }
  init();
})();
