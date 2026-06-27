
/**
 * Food & Nutrition Tools - interactive logic
 * --------------------------------------------------------------------------
 * Tools:
 *   1. Protein Calculator        (daily protein target by weight/goal/activity)
 *   2. Food Recommendation Chat  (API-backed, AI-style chat interface)
 *
 * Depends on:
 *   - /js/script.js (shared helpers)
 *   - /api/food-chat (rule-based food recommendation endpoint)
 * --------------------------------------------------------------------------
 */

import { $, el, toast, setButtonLoading, formatNumber } from '/js/script.js';

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

function scrollChatToBottom(container) {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}

const PROTEIN_FACTORS = Object.freeze({
  fatloss: { low: 1.6, moderate: 1.8, high: 2.0 },
  maintenance: { low: 1.2, moderate: 1.5, high: 1.8 },
  muscle: { low: 1.6, moderate: 1.9, high: 2.2 },
});

const GOAL_LABELS = Object.freeze({
  fatloss: 'Fat loss',
  maintenance: 'Maintenance',
  muscle: 'Muscle gain',
});

const ACTIVITY_LABELS = Object.freeze({
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
});

function proteinNote(goal) {
  if (goal === 'fatloss') {
    return 'Keep protein steady across meals and pair it with vegetables, water and strength training.';
  }
  if (goal === 'muscle') {
    return 'Spread protein across 3-5 meals and combine it with progressive training and enough calories.';
  }
  return 'This is a balanced everyday target. Adjust slightly based on hunger, training and recovery.';
}

function initProteinCalculator() {
  const form = $('#proteinForm');
  if (!form) return;

  const weightEl = $('#proteinWeight');
  const unitEl = $('#proteinUnit');
  const genderEl = $('#proteinGender');
  const goalEl = $('#proteinGoal');
  const activityEl = $('#proteinActivity');
  const errorEl = $('#proteinError');
  const resultEl = $('#proteinResult');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    errorEl.textContent = '';

    const rawWeight = num(weightEl.value);
    const unit = unitEl.value;
    const goal = goalEl.value;
    const activity = activityEl.value;

    if (Number.isNaN(rawWeight)) {
      errorEl.textContent = 'Please enter a valid body weight.';
      weightEl.focus();
      return;
    }

    if (rawWeight <= 0) {
      errorEl.textContent = 'Weight must be greater than zero.';
      weightEl.focus();
      return;
    }

    const weightKg = unit === 'lb' ? rawWeight * 0.45359237 : rawWeight;
    if (weightKg < 20 || weightKg > 300) {
      errorEl.textContent = 'Please enter a realistic weight between 20 kg and 300 kg.';
      weightEl.focus();
      return;
    }

    const factor = PROTEIN_FACTORS[goal]?.[activity] || PROTEIN_FACTORS.maintenance.moderate;
    const target = weightKg * factor;
    const lowTarget = Math.max(0, target - weightKg * 0.15);
    const highTarget = target + weightKg * 0.15;
    const meals = target >= 130 ? 5 : target >= 90 ? 4 : 3;
    const perMeal = target / meals;

    resultEl.replaceChildren(
      resultRow('Daily protein target', `${formatNumber(target, 0)} g`, 'good'),
      resultRow('Practical range', `${formatNumber(lowTarget, 0)}-${formatNumber(highTarget, 0)} g`),
      resultRow('Protein per meal', `${formatNumber(perMeal, 0)} g x ${meals} meals`),
      resultRow('Weight used', `${formatNumber(weightKg, 1)} kg`),
      resultRow('Goal', GOAL_LABELS[goal] || 'Maintenance'),
      resultRow('Activity level', ACTIVITY_LABELS[activity] || 'Moderate')
    );

    const note = el('p', {
      class: 'text-soft',
      style: 'margin-top:.75rem;font-size:.92rem',
      text: proteinNote(goal),
    });

    if (genderEl.value === 'female') {
      note.textContent += ' Requirements can change during pregnancy or breastfeeding.';
    }

    resultEl.append(note);
    showResult(resultEl);
  });

  form.addEventListener('reset', () => {
    errorEl.textContent = '';
    resultEl.replaceChildren();
    resultEl.classList.add('is-empty');
  });
}

const GREETING = [
  'Hi! Tell me your goal and food preference, and I will suggest simple options.',
  'Try asking for "high protein vegetarian meals", "budget student foods", or "healthy Indian dinner".',
].join('\n\n');

function messageNode(role, text) {
  const safeRole = role === 'user' ? 'user' : 'assistant';
  return el('div', { class: `chat-message ${safeRole}` }, [
    el('div', { class: 'chat-bubble', text }),
  ]);
}

function typingNode() {
  return el('div', {
    class: 'chat-message assistant',
    id: 'chatTyping',
    'aria-label': 'Assistant is typing',
  }, [
    el('div', { class: 'typing-indicator' }, [
      el('span', { 'aria-hidden': 'true' }),
      el('span', { 'aria-hidden': 'true' }),
      el('span', { 'aria-hidden': 'true' }),
    ]),
  ]);
}

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
}

async function fetchFoodReply(message) {
  const response = await fetch('/api/food-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Could not get a recommendation right now.');
  }

  return String(data.reply || '').trim() || 'I could not find a useful recommendation for that. Try asking another way.';
}

function initFoodChat() {
  const form = $('#chatForm');
  const input = $('#chatInput');
  const send = $('#chatSend');
  const messages = $('#chatMessages');
  const suggestions = $('#chatSuggestions');

  if (!form || !input || !send || !messages) return;

  messages.append(messageNode('assistant', GREETING));
  scrollChatToBottom(messages);

  input.addEventListener('input', () => autoResizeTextarea(input));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  suggestions?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-suggest]');
    if (!chip) return;

    input.value = chip.dataset.suggest || '';
    autoResizeTextarea(input);
    input.focus();
    form.requestSubmit();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = input.value.trim().replace(/\s+/g, ' ');
    if (!message) {
      input.focus();
      return;
    }

    messages.append(messageNode('user', message));
    input.value = '';
    autoResizeTextarea(input);

    const typing = typingNode();
    messages.append(typing);
    scrollChatToBottom(messages);
    setButtonLoading(send, true);

    try {
      const reply = await fetchFoodReply(message);
      typing.remove();
      messages.append(messageNode('assistant', reply));
    } catch (err) {
      typing.remove();
      messages.append(
        messageNode(
          'assistant',
          'Sorry, I could not reach the food assistant. Please check your connection and try again.'
        )
      );
      toast(err.message || 'Food assistant is unavailable.', 'error');
    } finally {
      setButtonLoading(send, false);
      scrollChatToBottom(messages);
      input.focus();
    }
  });
}

function initFoodTools() {
  initProteinCalculator();
  initFoodChat();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initFoodTools);
} else {
  initFoodTools();
}