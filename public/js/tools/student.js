/**
 * Student Tools — interactive logic
 * --------------------------------------------------------------------------
 * Tools:
 *   1. Attendance Calculator  (%, classes needed to reach target, classes
 *                              that can be skipped while staying >= target)
 *   2. CGPA Calculator        (dynamic semesters: credits + SGPA/GPA)
 *   3. SGPA Calculator        (dynamic subjects: credits + grade points)
 *   4. Marks Calculator       (percentage, grade, pass/fail)
 *   5. Study Timer (Pomodoro)  (25/45/60, start/pause/reset, persistence)
 *
 * Depends on: /js/script.js (shared helpers)
 * --------------------------------------------------------------------------
 */

import { $, el, storage, toast, formatNumber, clamp } from '/js/script.js';

/* ==========================================================================
   Shared helpers (local to this page)
   ========================================================================== */

/** Show a result block (removes the .is-empty hidden state). */
function showResult(node) {
  node.classList.remove('is-empty');
}

/** Build a single key/value result row. */
function resultRow(key, value, valClass = '') {
  return el('div', { class: 'result-row' }, [
    el('span', { class: 'result-key', text: key }),
    el('span', { class: `result-val ${valClass}`.trim(), text: value }),
  ]);
}

/** Parse a number from an input; returns NaN if blank/invalid. */
function num(value) {
  if (value === '' || value == null) return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/* ==========================================================================
   1. Attendance Calculator
   ========================================================================== */
function initAttendance() {
  const form = $('#attendanceForm');
  if (!form) return;

  const attendedEl = $('#attAttended');
  const totalEl = $('#attTotal');
  const targetEl = $('#attTarget');
  const errorEl = $('#attError');
  const resultEl = $('#attResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const attended = num(attendedEl.value);
    const total = num(totalEl.value);
    const target = clamp(num(targetEl.value) || 75, 1, 100);

    // Validation
    if (Number.isNaN(attended) || Number.isNaN(total)) {
      errorEl.textContent = 'Please enter both attended and total classes.';
      return;
    }
    if (attended < 0 || total < 0) {
      errorEl.textContent = 'Values cannot be negative.';
      return;
    }
    if (total === 0) {
      errorEl.textContent = 'Total classes must be greater than zero.';
      return;
    }
    if (attended > total) {
      errorEl.textContent = 'Attended classes cannot exceed total classes.';
      return;
    }

    const percent = (attended / total) * 100;
    const ratio = target / 100;

    resultEl.replaceChildren();
    resultEl.appendChild(
      resultRow('Attendance', `${formatNumber(percent, 2)}%`, percent >= target ? 'good' : 'bad')
    );

    if (percent >= target) {
      // How many future classes can be skipped while staying >= target?
      // (attended) / (total + x) >= ratio  ->  x <= attended/ratio - total
      const canSkip = Math.floor(attended / ratio - total);
      resultEl.appendChild(
        resultRow(`Status (target ${target}%)`, 'On track ✅', 'good')
      );
      resultEl.appendChild(
        resultRow('Classes you can skip', `${Math.max(0, canSkip)}`)
      );
    } else {
      // How many consecutive classes must be attended to reach target?
      // (attended + x) / (total + x) >= ratio
      //  -> x >= (ratio*total - attended) / (1 - ratio)
      let needed;
      if (ratio >= 1) {
        needed = Infinity; // 100% target after a miss is unreachable
      } else {
        needed = Math.ceil((ratio * total - attended) / (1 - ratio));
        needed = Math.max(0, needed);
      }
      resultEl.appendChild(
        resultRow(`Status (target ${target}%)`, 'Below target ⚠️', 'bad')
      );
      resultEl.appendChild(
        resultRow(
          'Classes needed in a row',
          Number.isFinite(needed) ? `${needed}` : 'Not reachable'
        )
      );
    }

    showResult(resultEl);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
  });
}

/* ==========================================================================
   2. CGPA Calculator (dynamic semesters)
   ========================================================================== */
function initCGPA() {
  const form = $('#cgpaForm');
  if (!form) return;

  const rowsEl = $('#cgpaRows');
  const addBtn = $('#cgpaAdd');
  const resetBtn = $('#cgpaReset');
  const errorEl = $('#cgpaError');
  const resultEl = $('#cgpaResult');

  let counter = 0;

  /** Build one semester row: credits + SGPA/GPA + remove button. */
  function makeRow(index) {
    counter += 1;
    const id = counter;
    const row = el('div', { class: 'dynamic-row', dataset: { rowId: String(id) },
      style: 'grid-template-columns: 1fr 1fr auto;' }, [
      el('div', { class: 'field' }, [
        el('label', { for: `cgpaCredits-${id}`, text: `Sem ${index} credits` }),
        el('input', {
          id: `cgpaCredits-${id}`, class: 'input cgpa-credits', type: 'number',
          min: '0', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 24',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: `cgpaGpa-${id}`, text: 'SGPA / GPA' }),
        el('input', {
          id: `cgpaGpa-${id}`, class: 'input cgpa-gpa', type: 'number',
          min: '0', max: '10', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 8.5',
        }),
      ]),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Remove semester ${index}`,
        onClick: () => { row.remove(); renumber(); },
      }, '✕'),
    ]);
    return row;
  }

  /** Relabel rows after add/remove so labels stay sequential. */
  function renumber() {
    Array.from(rowsEl.children).forEach((row, i) => {
      const label = row.querySelector('label[for^="cgpaCredits"]');
      if (label) label.textContent = `Sem ${i + 1} credits`;
    });
  }

  function addRow() {
    rowsEl.appendChild(makeRow(rowsEl.children.length + 1));
  }

  function reset() {
    rowsEl.replaceChildren();
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
    addRow();
    addRow();
  }

  addBtn.addEventListener('click', addRow);
  resetBtn.addEventListener('click', reset);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const rows = Array.from(rowsEl.children);
    let totalCredits = 0;
    let weighted = 0;
    let valid = 0;

    for (const row of rows) {
      const credits = num(row.querySelector('.cgpa-credits').value);
      const gpa = num(row.querySelector('.cgpa-gpa').value);
      if (Number.isNaN(credits) && Number.isNaN(gpa)) continue; // skip empty rows
      if (Number.isNaN(credits) || Number.isNaN(gpa) || credits <= 0 || gpa < 0) {
        errorEl.textContent = 'Each filled semester needs valid credits (>0) and GPA (>=0).';
        return;
      }
      totalCredits += credits;
      weighted += credits * gpa;
      valid += 1;
    }

    if (valid === 0 || totalCredits === 0) {
      errorEl.textContent = 'Add at least one semester with credits and GPA.';
      return;
    }

    const cgpa = weighted / totalCredits;
    resultEl.replaceChildren(
      resultRow('Semesters counted', `${valid}`),
      resultRow('Total credits', formatNumber(totalCredits, 0)),
      resultRow('Overall CGPA', formatNumber(cgpa, 2), 'good')
    );
    showResult(resultEl);
  });

  // Seed with two semesters
  reset();
}

/* ==========================================================================
   3. SGPA Calculator (dynamic subjects)
   ========================================================================== */
function initSGPA() {
  const form = $('#sgpaForm');
  if (!form) return;

  const rowsEl = $('#sgpaRows');
  const addBtn = $('#sgpaAdd');
  const resetBtn = $('#sgpaReset');
  const errorEl = $('#sgpaError');
  const resultEl = $('#sgpaResult');

  let counter = 0;

  /** Build one subject row: credits + grade points + remove. */
  function makeRow(index) {
    counter += 1;
    const id = counter;
    const row = el('div', { class: 'dynamic-row', dataset: { rowId: String(id) },
      style: 'grid-template-columns: 1fr 1fr auto;' }, [
      el('div', { class: 'field' }, [
        el('label', { for: `sgpaCredits-${id}`, text: `Subject ${index} credits` }),
        el('input', {
          id: `sgpaCredits-${id}`, class: 'input sgpa-credits', type: 'number',
          min: '0', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 4',
        }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: `sgpaGrade-${id}`, text: 'Grade points (0-10)' }),
        el('input', {
          id: `sgpaGrade-${id}`, class: 'input sgpa-grade', type: 'number',
          min: '0', max: '10', step: 'any', inputmode: 'decimal', placeholder: 'e.g. 9',
        }),
      ]),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Remove subject ${index}`,
        onClick: () => { row.remove(); renumber(); },
      }, '✕'),
    ]);
    return row;
  }

  function renumber() {
    Array.from(rowsEl.children).forEach((row, i) => {
      const label = row.querySelector('label[for^="sgpaCredits"]');
      if (label) label.textContent = `Subject ${i + 1} credits`;
    });
  }

  function addRow() {
    rowsEl.appendChild(makeRow(rowsEl.children.length + 1));
  }

  function reset() {
    rowsEl.replaceChildren();
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
    addRow();
    addRow();
    addRow();
  }

  addBtn.addEventListener('click', addRow);
  resetBtn.addEventListener('click', reset);

  /** Auto-calculate SGPA live as the user edits (per spec). */
  function calculate(silent = true) {
    if (!silent) errorEl.textContent = '';
    const rows = Array.from(rowsEl.children);
    let totalCredits = 0;
    let weighted = 0;
    let valid = 0;

    for (const row of rows) {
      const credits = num(row.querySelector('.sgpa-credits').value);
      const grade = num(row.querySelector('.sgpa-grade').value);
      if (Number.isNaN(credits) && Number.isNaN(grade)) continue;
      if (Number.isNaN(credits) || Number.isNaN(grade) || credits <= 0 || grade < 0 || grade > 10) {
        if (!silent) errorEl.textContent = 'Each filled subject needs credits (>0) and grade (0-10).';
        return;
      }
      totalCredits += credits;
      weighted += credits * grade;
      valid += 1;
    }

    if (valid === 0 || totalCredits === 0) {
      resultEl.replaceChildren();
      resultEl.classList.add('is-empty');
      if (!silent) errorEl.textContent = 'Add at least one subject with credits and grade.';
      return;
    }

    const sgpa = weighted / totalCredits;
    resultEl.replaceChildren(
      resultRow('Subjects counted', `${valid}`),
      resultRow('Total credits', formatNumber(totalCredits, 0)),
      resultRow('SGPA', formatNumber(sgpa, 2), 'good')
    );
    showResult(resultEl);
  }

  // Live recalculation on input within the rows container.
  rowsEl.addEventListener('input', () => calculate(true));
  form.addEventListener('submit', (e) => { e.preventDefault(); calculate(false); });

  reset();
}

/* ==========================================================================
   4. Marks Calculator
   ========================================================================== */
/** Map a percentage to a letter grade. */
function gradeFor(percent) {
  if (percent >= 90) return 'A+';
  if (percent >= 80) return 'A';
  if (percent >= 70) return 'B';
  if (percent >= 60) return 'C';
  if (percent >= 50) return 'D';
  if (percent >= 40) return 'E';
  return 'F';
}

function initMarks() {
  const form = $('#marksForm');
  if (!form) return;

  const obtainedEl = $('#marksObtained');
  const totalEl = $('#marksTotal');
  const passEl = $('#marksPass');
  const errorEl = $('#marksError');
  const resultEl = $('#marksResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const obtained = num(obtainedEl.value);
    const total = num(totalEl.value);
    const pass = clamp(Number.isNaN(num(passEl.value)) ? 33 : num(passEl.value), 0, 100);

    if (Number.isNaN(obtained) || Number.isNaN(total)) {
      errorEl.textContent = 'Please enter obtained and total marks.';
      return;
    }
    if (total <= 0) {
      errorEl.textContent = 'Total marks must be greater than zero.';
      return;
    }
    if (obtained < 0) {
      errorEl.textContent = 'Obtained marks cannot be negative.';
      return;
    }
    if (obtained > total) {
      errorEl.textContent = 'Obtained marks cannot exceed total marks.';
      return;
    }

    const percent = (obtained / total) * 100;
    const grade = gradeFor(percent);
    const passed = percent >= pass;

    resultEl.replaceChildren(
      resultRow('Percentage', `${formatNumber(percent, 2)}%`),
      resultRow('Grade', grade),
      resultRow('Result', passed ? 'Pass ✅' : 'Fail ❌', passed ? 'good' : 'bad')
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
   5. Study Timer (Pomodoro)
   ========================================================================== */
const TIMER_KEY = 'swt-study-timer';

/** Read today's persisted timer stats; resets automatically on a new day. */
function loadTimerStats() {
  const today = new Date().toISOString().slice(0, 10);
  let data = { date: today, sessions: 0, seconds: 0 };
  try {
    const raw = storage.get(TIMER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === today) data = parsed;
    }
  } catch {
    /* ignore corrupt data */
  }
  return data;
}

function saveTimerStats(data) {
  storage.set(TIMER_KEY, JSON.stringify(data));
}

/** Format seconds as a friendly "Xh Ym" / "Ym" string. */
function humanDuration(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function initTimer() {
  const display = $('#timerDisplay');
  if (!display) return;

  const modeEl = $('#timerMode');
  const startBtn = $('#timerStart');
  const pauseBtn = $('#timerPause');
  const resetBtn = $('#timerReset');
  const sessionsEl = $('#timerSessions');
  const dailyEl = $('#timerDaily');

  let stats = loadTimerStats();
  let durationSec = Number(modeEl.value) * 60;
  let remaining = durationSec;
  let intervalId = null;
  let running = false;

  /** Render mm:ss into the display. */
  function paint() {
    const m = String(Math.floor(remaining / 60)).padStart(2, '0');
    const s = String(remaining % 60).padStart(2, '0');
    display.textContent = `${m}:${s}`;
  }

  /** Update the persisted stats UI. */
  function paintStats() {
    sessionsEl.textContent = String(stats.sessions);
    dailyEl.textContent = humanDuration(stats.seconds);
  }

  function clearTick() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function complete() {
    clearTick();
    running = false;
    // Record a completed session + the full focus duration.
    stats = loadTimerStats(); // refresh in case the day rolled over
    stats.sessions += 1;
    stats.seconds += durationSec;
    saveTimerStats(stats);
    paintStats();
    toast('Session complete! Great focus 🎉', 'success');
    // Reset for the next session.
    remaining = durationSec;
    paint();
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) {
      remaining = 0;
      paint();
      complete();
      return;
    }
    paint();
  }

  function start() {
    if (running) return;
    running = true;
    intervalId = setInterval(tick, 1000);
    toast('Timer started — stay focused!', 'info', 1800);
  }

  function pause() {
    if (!running) return;
    clearTick();
    running = false;
  }

  function reset() {
    clearTick();
    running = false;
    durationSec = Number(modeEl.value) * 60;
    remaining = durationSec;
    paint();
  }

  modeEl.addEventListener('change', () => {
    // Changing mode while paused/stopped resets the clock to the new duration.
    reset();
  });

  startBtn.addEventListener('click', start);
  pauseBtn.addEventListener('click', pause);
  resetBtn.addEventListener('click', reset);

  // Persist nothing for in-progress time on unload, but keep stats accurate
  // (we only count full completed sessions to match "Completed Sessions").
  paint();
  paintStats();
}

/* ==========================================================================
   Bootstrap all student tools
   ========================================================================== */
function initStudentTools() {
  initAttendance();
  initCGPA();
  initSGPA();
  initMarks();
  initTimer();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStudentTools);
} else {
  initStudentTools();
}
