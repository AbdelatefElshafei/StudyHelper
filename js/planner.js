/* ============================================================
   العدّاد — محرك الخطة الذكية
   - خطة يومية بتتبني من جديد كل يوم من "اللي باقي ÷ الأيام اللي باقية"
     فلو فاتك يوم، الخطة بتصلّح نفسها تلقائياً من غير تراكم.
   - مراجعة متباعدة مدمجة (1 / 7 / 30 يوم بعد المذاكرة الأولى).
   - وضع الامتحانات: قبل امتحان أي مادة بأيام، كل الوقت ليها.
   - مؤشر السرعة + تاريخ الانتهاء المتوقع من سرعتك الفعلية.
   ============================================================ */
(function (global) {
  'use strict';

  const DAY = 86400000;

  // ---------- أدوات التاريخ ----------
  function toDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function dayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  function addDays(key, n) {
    const d = toDate(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }
  function daysBetween(fromKey, toKey) {
    return Math.round((toDate(toKey) - toDate(fromKey)) / DAY);
  }
  function weekday(key) {
    return toDate(key).getDay(); // 0 = الأحد
  }

  // ---------- استعلامات الحالة ----------
  function subjectById(state, id) {
    return state.subjects.find((s) => s.id === id);
  }
  function lessonsOf(state, subjectId) {
    return state.lessons.filter((l) => l.subjectId === subjectId).sort((a, b) => a.order - b.order);
  }
  function remainingOfLesson(l) {
    if (l.done) return 0;
    return Math.max(0, l.hours - (l.doneHours || 0));
  }
  function activeSubjects(state, today) {
    return state.subjects.filter((s) => s.enabled && daysBetween(today, s.examDate) >= 0);
  }
  function availableHours(state, key) {
    if (state.dayOverrides && state.dayOverrides[key] != null) return state.dayOverrides[key];
    return state.settings.dailyHours[weekday(key)] || 0;
  }
  function avgWeeklyHours(state) {
    const h = state.settings.dailyHours;
    let sum = 0;
    for (let i = 0; i < 7; i++) sum += h[i] || 0;
    return sum / 7;
  }

  // المراجعات المستحقة (أو المتأخرة) حتى اليوم
  function dueReviews(state, today) {
    const out = [];
    for (const l of state.lessons) {
      if (!l.reviews) continue;
      const subj = subjectById(state, l.subjectId);
      if (!subj || !subj.enabled || daysBetween(today, subj.examDate) < 0) continue;
      for (const r of l.reviews) {
        if (!r.done && daysBetween(r.due, today) >= 0) {
          out.push({ lesson: l, subject: subj, review: r, overdueDays: daysBetween(r.due, today) });
        }
      }
    }
    out.sort((a, b) => b.overdueDays - a.overdueDays);
    return out;
  }
  function reviewMinutes(lesson) {
    return clamp(Math.round((lesson.hours * 60 * 0.25) / 5) * 5, 15, 45);
  }
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // ---------- إحصائيات المواد ----------
  function subjectStats(state, today) {
    return state.subjects.map((s) => {
      const ls = lessonsOf(state, s.id);
      const total = ls.reduce((a, l) => a + l.hours, 0);
      const remaining = ls.reduce((a, l) => a + remainingOfLesson(l), 0);
      const doneCount = ls.filter((l) => l.done).length;
      const daysLeft = daysBetween(today, s.examDate);
      const effDays = Math.max(1, daysLeft - (state.settings.bufferDays || 2));
      const mastery = ls.length ? ls.reduce((a, l) => a + (l.mastery || 0), 0) / (ls.length * 3) : 0;
      return {
        subject: s,
        lessons: ls,
        totalHours: total,
        remainingHours: remaining,
        doneCount,
        lessonCount: ls.length,
        progress: total ? (total - remaining) / total : 0,
        mastery,
        daysLeft,
        loadPerDay: s.enabled && daysLeft >= 0 ? remaining / effDays : 0,
      };
    });
  }

  // ---------- مؤشر السرعة ----------
  function pace(state, today) {
    const stats = subjectStats(state, today).filter((x) => x.subject.enabled && x.daysLeft >= 0);
    const pendingReviewHours = state.lessons.reduce((a, l) => {
      if (!l.reviews) return a;
      const subj = subjectById(state, l.subjectId);
      if (!subj || !subj.enabled || daysBetween(today, subj.examDate) < 0) return a;
      return a + l.reviews.filter((r) => !r.done).length * (reviewMinutes(l) / 60);
    }, 0);
    const remainingTotal = stats.reduce((a, x) => a + x.remainingHours, 0);
    const requiredPerDay = stats.reduce((a, x) => a + x.loadPerDay, 0) +
      pendingReviewHours / Math.max(1, firstExamDays(state, today));
    const availablePerDay = avgWeeklyHours(state);
    const ratio = availablePerDay > 0 ? requiredPerDay / availablePerDay : (requiredPerDay > 0 ? 9 : 0);
    let status = 'green';
    if (ratio > 1.05) status = 'red';
    else if (ratio > 0.85) status = 'yellow';
    if (remainingTotal === 0) status = 'done';
    return { requiredPerDay, availablePerDay, ratio, status, remainingTotal, pendingReviewHours };
  }
  function firstExam(state, today) {
    const act = activeSubjects(state, today).slice().sort((a, b) => daysBetween(b.examDate, a.examDate));
    return act[0] || null;
  }
  function firstExamDays(state, today) {
    const f = firstExam(state, today);
    return f ? daysBetween(today, f.examDate) : 0;
  }

  // ---------- السرعة الفعلية وتاريخ الانتهاء المتوقع ----------
  function velocity(state, today, window = 7) {
    const start = addDays(today, -(window - 1));
    let minutes = 0;
    const days = new Set();
    for (const e of state.log) {
      if (daysBetween(start, e.date) >= 0 && daysBetween(e.date, today) >= 0) {
        minutes += e.minutes;
        days.add(e.date);
      }
    }
    return { hoursPerDay: minutes / 60 / window, activeDays: days.size, minutes };
  }
  function projectedFinish(state, today) {
    const v = velocity(state, today);
    const p = pace(state, today);
    if (p.remainingTotal === 0) return { status: 'done' };
    if (v.activeDays < 3) return { status: 'insufficient', activeDays: v.activeDays };
    if (v.hoursPerDay <= 0.05) return { status: 'stalled' };
    const days = Math.ceil((p.remainingTotal + p.pendingReviewHours) / v.hoursPerDay);
    const finish = addDays(today, days);
    const f = firstExam(state, today);
    const margin = f ? daysBetween(finish, f.examDate) : 0;
    return { status: 'ok', finish, days, margin, hoursPerDay: v.hoursPerDay };
  }

  // ---------- الستريك ----------
  function streak(state, today, minMinutes = 20) {
    const perDay = {};
    for (const e of state.log) perDay[e.date] = (perDay[e.date] || 0) + e.minutes;
    let n = 0;
    let key = today;
    if ((perDay[key] || 0) < minMinutes) key = addDays(key, -1); // اليوم لسه مخلصش
    while ((perDay[key] || 0) >= minMinutes) {
      n++;
      key = addDays(key, -1);
    }
    return n;
  }

  // ---------- بناء خطة اليوم ----------
  function round5(m) {
    return Math.max(5, Math.round(m / 5) * 5);
  }
  function lastStudiedDays(state, subjectId, today) {
    let last = null;
    for (const e of state.log) {
      const l = state.lessons.find((x) => x.id === e.lessonId);
      if (l && l.subjectId === subjectId) {
        if (!last || daysBetween(last, e.date) > 0) last = e.date;
      }
    }
    return last ? daysBetween(last, today) : 99;
  }

  /**
   * بيرجع قائمة مهام اليوم.
   * @param {object} state
   * @param {string} today  مفتاح اليوم YYYY-MM-DD
   * @param {object} opts   { budgetMinutes, excludeLessonIds:Set, excludeReviewKeys:Set }
   */
  function buildToday(state, today, opts = {}) {
    const budgetAll = Math.floor((opts.budgetMinutes != null ? opts.budgetMinutes : Math.round(availableHours(state, today) * 60)) / 5) * 5;
    let budget = budgetAll;
    const exclude = opts.excludeLessonIds || new Set();
    const excludeReviews = opts.excludeReviewKeys || new Set();
    const tasks = [];
    if (budget < 15) return tasks;

    const subjects = activeSubjects(state, today);
    if (!subjects.length) return tasks;

    // 1) وضع الامتحانات: المادة اللي امتحانها قريب تاخد اليوم كله
    const focusDays = state.settings.examFocusDays != null ? state.settings.examFocusDays : 3;
    const nearest = subjects.slice().sort((a, b) => daysBetween(b.examDate, a.examDate))[0];
    const nearestIn = daysBetween(today, nearest.examDate);
    if (nearestIn <= focusDays) {
      const ls = lessonsOf(state, nearest.id)
        .filter((l) => !exclude.has(l.id))
        .sort((a, b) => (a.mastery || 0) - (b.mastery || 0) || a.order - b.order);
      let pass = 1;
      while (budget >= 15 && ls.length && pass <= 2) {
        for (const l of ls) {
          if (budget < 15) break;
          const m = Math.min(budget, round5(clamp(l.hours * 60 * (pass === 1 ? 0.35 : 0.2), 20, 60)));
          tasks.push(makeTask(l, nearest, 'exam', m, pass));
          budget -= m;
        }
        pass++;
      }
      return tasks;
    }

    // 2) المراجعات المستحقة (بحد أقصى نصف الوقت)
    const reviewCap = Math.round(budgetAll * 0.5);
    let reviewUsed = 0;
    for (const r of dueReviews(state, today)) {
      const key = r.lesson.id + ':' + r.review.n;
      if (excludeReviews.has(key) || exclude.has(r.lesson.id)) continue;
      const m = reviewMinutes(r.lesson);
      if (reviewUsed + m > reviewCap || budget - m < 0) continue;
      tasks.push(makeTask(r.lesson, r.subject, 'review', m, r.review.n));
      reviewUsed += m;
      budget -= m;
    }

    // 3) توزيع المذاكرة الجديدة على أعلى 3 مواد احتياجاً
    const scored = subjectStats(state, today)
      .filter((x) => x.subject.enabled && x.daysLeft >= 0)
      .map((x) => {
        const remainingLessons = x.lessons.filter((l) => !l.done && !exclude.has(l.id) && remainingOfLesson(l) > 0);
        if (!remainingLessons.length) return null;
        const neglect = Math.min(5, lastStudiedDays(state, x.subject.id, today));
        const fairness = 1 + 0.15 * neglect;
        return { stat: x, remainingLessons, score: x.loadPerDay * fairness + 0.0001 };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    if (!scored.length || budget < 15) return tasks;

    const maxSubjects = state.settings.maxSubjectsPerDay || 3;
    const picked = scored.slice(0, maxSubjects);
    const totalScore = picked.reduce((a, p) => a + p.score, 0);
    let studyBudget = budget;

    // تخصيص أولي بالنسبة، مع دمج التخصيصات الصغيرة
    const allocs = picked.map((p) => ({ p, minutes: Math.floor((studyBudget * p.score) / totalScore / 5) * 5 }));
    let spare = 0;
    for (const a of allocs) {
      if (a.minutes < 25 && allocs.length > 1) {
        spare += a.minutes;
        a.minutes = 0;
      }
    }
    if (spare) {
      const first = allocs.find((a) => a.minutes > 0) || allocs[0];
      first.minutes += spare;
    }

    for (const a of allocs) {
      let left = a.minutes;
      // كمّل الدرس اللي بدأته قبل ما تبدأ جديد
      const ordered = a.p.remainingLessons.slice().sort((x, y) => {
        const px = (x.doneHours || 0) > 0 ? 0 : 1;
        const py = (y.doneHours || 0) > 0 ? 0 : 1;
        return px - py || x.order - y.order;
      });
      for (const l of ordered) {
        if (left < 15) break;
        const need = Math.round(remainingOfLesson(l) * 60);
        // لو الدرس هيخلص النهاردة خده كله (مقرّب لأعلى 5 دقايق)، غير كده خد اللي متاح
        const m = need <= left ? Math.min(left, Math.ceil(need / 5) * 5) : Math.floor(left / 5) * 5;
        if (m < 15) break;
        tasks.push(makeTask(l, a.p.stat.subject, 'study', m));
        left -= m;
      }
    }
    return tasks;
  }

  function makeTask(lesson, subject, kind, minutes, n) {
    return {
      id: 't' + Math.random().toString(36).slice(2, 9),
      lessonId: lesson.id,
      subjectId: subject.id,
      kind, // study | review | exam | custom
      minutes,
      doneMinutes: 0,
      done: false,
      n: n || 0,
    };
  }

  // عند إتمام درس لأول مرة: جدولة المراجعات المتباعدة
  function scheduleReviews(state, lesson, today) {
    const subj = subjectById(state, lesson.subjectId);
    const intervals = state.settings.reviewIntervals || [1, 7, 30];
    lesson.reviews = [];
    intervals.forEach((d, i) => {
      const due = addDays(today, d);
      if (!subj || daysBetween(due, subj.examDate) >= 1) {
        lesson.reviews.push({ n: i + 1, due, done: false });
      }
    });
  }

  global.Planner = {
    dayKey, toDate, addDays, daysBetween, weekday,
    subjectById, lessonsOf, remainingOfLesson, activeSubjects,
    availableHours, avgWeeklyHours, dueReviews, reviewMinutes,
    subjectStats, pace, firstExam, firstExamDays,
    velocity, projectedFinish, streak,
    buildToday, makeTask, scheduleReviews,
  };
})(window);
