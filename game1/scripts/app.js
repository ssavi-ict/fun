// ============================================================================
// State & Configuration
// ============================================================================
let config = {
  firebaseConfig: {},
  questionType: 'both',
  totalRounds: 12,
  scorePerQuestion: 1,
  noHintBonus: 0.25
};

let activeSessionQuestions = JSON.parse(sessionStorage.getItem('activeSessionQuestions')) || [];
let unlockedHints = JSON.parse(sessionStorage.getItem('unlockedHints')) || [];
let score = parseFloat(sessionStorage.getItem('score')) || 0;
let attempts = parseInt(sessionStorage.getItem('attempts')) || 0;
let currentItem = null;
let answering = false;
let hintUsed = false;
let playStartedTracked = sessionStorage.getItem('playStartedTracked') === 'true'; // Tracks if current game start was logged

// Realtime Presence Guards
let presenceRef = null;
let myPresenceRef = null;
let presenceInitialized = false;

// DOM Elements
const scoreEl = document.getElementById('score-value');
const attemptEl = document.getElementById('attempt-count');
const totalRoundsEl = document.getElementById('total-rounds');
const feedbackEl = document.getElementById('feedback');
const hintEl = document.getElementById('hint');
const boardHintDisplayEl = document.getElementById('board-hint-display');
const imageEl = document.getElementById('game-image');
const textEl = document.getElementById('game-text');
const stampEl = document.getElementById('stamp');
const progressFill = document.getElementById('progress-fill');
const itemNumberEl = document.getElementById('item-number');
const playersOnlineEl = document.getElementById('players-online');
const totalPlaysEl = document.getElementById('total-plays');
const yesBtn = document.getElementById('yes-btn');
const noBtn = document.getElementById('no-btn');
const hintBtn = document.getElementById('hint-btn');
const bonusToastEl = document.getElementById('bonus-toast');
const expandBtn = document.getElementById('expand-btn');
const hintBoardNotesEl = document.getElementById('hint-board-notes');

// Modal Elements
const modalOverlay = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const modalClose = document.getElementById('modal-close');

// Congrats Modal Elements
const congratsModal = document.getElementById('congrats-modal');
const congratsClose = document.getElementById('congrats-close');
const finalScoreDisplay = document.getElementById('final-score-display');
const modalResetBtn = document.getElementById('modal-reset-btn');
const shareFb = document.getElementById('share-fb');
const shareWa = document.getElementById('share-wa');
const shareX = document.getElementById('share-x');
const shareCopy = document.getElementById('share-copy');

// ============================================================================
// Initialization & Data Loading
// ============================================================================
async function initApp() {
  try {
    const [configRes, questionsRes] = await Promise.all([
      fetch('./config.json'),
      fetch('./questions.json')
    ]);
    
    if (!configRes.ok || !questionsRes.ok) {
      throw new Error(`HTTP error! Config: ${configRes.status}, Questions: ${questionsRes.status}`);
    }

    config = await configRes.json();
    const allQuestions = await questionsRes.json();

    totalRoundsEl.textContent = config.totalRounds;

    // Only generate new questions if none are saved in session
    if (!activeSessionQuestions || activeSessionQuestions.length === 0) {
      prepareQuestions(allQuestions);
    }

    initPresenceAndStats();
    updateUI();
    renderHintBoard();
    loadItem();
  } catch (err) {
    console.error('Initialization error:', err);
    feedbackEl.textContent = 'Error loading game configuration.';
  }
}

function prepareQuestions(questionsMap) {
  const entries = Object.entries(questionsMap);
  let filtered = [];

  if (config.questionType === 'text') {
    filtered = entries.filter(([key]) => key.startsWith('text_'));
  } else if (config.questionType === 'image') {
    filtered = entries.filter(([key]) => key.startsWith('image_'));
  } else {
    filtered = entries; // 'both'
  }

  // Fisher-Yates Shuffle
  const shuffled = filtered.map(item => item[1]);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  activeSessionQuestions = shuffled.slice(0, config.totalRounds);
  sessionStorage.setItem('activeSessionQuestions', JSON.stringify(activeSessionQuestions));
}

// ============================================================================
// Hint Board Controller
// ============================================================================
function renderHintBoard() {
  if (!hintBoardNotesEl) return;
  hintBoardNotesEl.innerHTML = '';

  const totalRounds = config.totalRounds || 12;

  for (let i = 0; i < totalRounds; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sticky-note-btn';
    btn.id = `sticky-note-${i}`;
    btn.textContent = String(i + 1).padStart(2, '0');

    // Unlocked if question was attempted OR if user requested hint before answering
    const isUnlocked = i < attempts || unlockedHints.includes(i);

    if (isUnlocked) {
      btn.classList.add('unlocked');
      btn.title = `Click to view Hint #${i + 1}`;
      btn.addEventListener('click', () => showHistoricalHint(i));
    } else {
      btn.title = 'Locked — Attempt question or request hint to unlock';
      btn.disabled = true;
    }

    hintBoardNotesEl.appendChild(btn);
  }
}

function showHistoricalHint(index) {
  document.querySelectorAll('.sticky-note-btn').forEach(btn => btn.classList.remove('active-note'));
  const activeBtn = document.getElementById(`sticky-note-${index}`);
  if (activeBtn) activeBtn.classList.add('active-note');

  if (activeSessionQuestions && activeSessionQuestions[index] && activeSessionQuestions[index].hint) {
    if (boardHintDisplayEl) {
      boardHintDisplayEl.textContent = `Hint #${index + 1}: ${activeSessionQuestions[index].hint}`;
    }
  }
}

// ============================================================================
// Game Logic
// ============================================================================
function updateUI() {
  scoreEl.textContent = Number.isInteger(score) ? score : score.toFixed(2);
  attemptEl.textContent = attempts;
  progressFill.style.width = `${Math.min(attempts / config.totalRounds, 1) * 100}%`;
  itemNumberEl.textContent = String(Math.min(attempts + 1, config.totalRounds)).padStart(2, '0');
  
  sessionStorage.setItem('score', score);
  sessionStorage.setItem('attempts', attempts);
}

function loadItem() {
  stampEl.className = 'stamp';
  bonusToastEl.classList.remove('show');
  bonusToastEl.textContent = '';
  
  answering = false;
  hintUsed = false;
  
  yesBtn.disabled = false;
  noBtn.disabled = false;
  hintBtn.disabled = false;
  hintBtn.classList.remove('hidden');
  hintEl.textContent = '';
  expandBtn.style.display = 'none';

  if (attempts >= config.totalRounds || attempts >= activeSessionQuestions.length) {
    feedbackEl.textContent = 'Case closed. Reopen case to review again.';
    imageEl.style.display = 'none';
    textEl.style.display = 'none';
    yesBtn.disabled = true;
    noBtn.disabled = true;
    hintBtn.disabled = true;
    hintBtn.classList.add('hidden');
    showCongratsModal();
    return;
  }

  currentItem = activeSessionQuestions[attempts];
  imageEl.style.display = 'none';
  textEl.style.display = 'none';

  if (currentItem.type === 'image') {
    imageEl.src = currentItem.src;
    imageEl.style.display = 'block';
    expandBtn.style.display = 'flex';
  } else {
    textEl.textContent = currentItem.text;
    textEl.style.display = 'block';
  }
  feedbackEl.textContent = '';
}

function checkAnswer(isYes) {
  if (attempts >= config.totalRounds || answering) return;
  answering = true;

  // Track total plays when the user attempts Question 1 for the first time
  if (!playStartedTracked) {
    playStartedTracked = true;
    sessionStorage.setItem('playStartedTracked', 'true');
    incrementTotalPlays();
  }

  const answer = isYes ? 'ai' : 'human';
  const correct = answer === currentItem.label;

  if (correct) {
    let pointsEarned = config.scorePerQuestion;
    feedbackEl.textContent = 'Correct.';
    stampEl.textContent = 'Verified';
    stampEl.classList.add('correct');

    if (!hintUsed) {
      pointsEarned += config.noHintBonus;
      bonusToastEl.textContent = `Well Done! +${config.noHintBonus} bonus points for no hint.`;
      bonusToastEl.classList.add('show');
    }

    score += pointsEarned;
  } else {
    feedbackEl.textContent = 'Incorrect.';
    stampEl.textContent = 'Misjudged';
    stampEl.classList.add('incorrect');
  }

  stampEl.classList.add('show');
  attempts++;
  updateUI();
  renderHintBoard();

  setTimeout(() => {
    if (attempts < config.totalRounds) {
      loadItem();
    } else {
      bonusToastEl.classList.remove('show');
      feedbackEl.textContent += ' Case closed.';
      showCongratsModal();
    }
  }, 1800);
}

// ============================================================================
// Congrats & Share Modal Logic
// ============================================================================
function showCongratsModal() {
  const formattedScore = Number.isInteger(score) ? score : score.toFixed(2);
  finalScoreDisplay.textContent = formattedScore;
  congratsModal.hidden = false;
}

function hideCongratsModal() {
  congratsModal.hidden = true;
}

function getShareText() {
  const formattedScore = Number.isInteger(score) ? score : score.toFixed(2);
  return `I scored ${formattedScore}/${config.totalRounds} on "Case File: Is This AI Generated?". Think you can beat my score? Play Now!`;
}

function getShareUrl() {
  return window.location.href;
}

shareFb.onclick = () => {
  const url = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getShareUrl())}`;
  window.open(url, '_blank', 'width=600,height=400');
};

shareWa.onclick = () => {
  const text = `${getShareText()} ${getShareUrl()}`;
  const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
};

shareX.onclick = () => {
  const text = getShareText();
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(getShareUrl())}`;
  window.open(url, '_blank', 'width=600,height=400');
};

shareCopy.onclick = async () => {
  try {
    await navigator.clipboard.writeText(`${getShareText()} ${getShareUrl()}`);
    const originalIcon = shareCopy.innerHTML;
    shareCopy.innerHTML = '<i class="fa-solid fa-check"></i>';
    setTimeout(() => { shareCopy.innerHTML = originalIcon; }, 2000);
  } catch (err) {
    console.error('Failed to copy text: ', err);
  }
};

congratsClose.onclick = hideCongratsModal;

// ============================================================================
// Event Handlers & Modal
// ============================================================================
yesBtn.onclick = () => checkAnswer(true);
noBtn.onclick = () => checkAnswer(false);

hintBtn.onclick = () => {
  hintUsed = true;
  hintEl.textContent = `Hint: ${currentItem.hint}`;
  hintBtn.classList.add('hidden');

  if (!unlockedHints.includes(attempts)) {
    unlockedHints.push(attempts);
    sessionStorage.setItem('unlockedHints', JSON.stringify(unlockedHints));
    renderHintBoard();
  }
};

function resetGame() {
  score = 0;
  attempts = 0;
  activeSessionQuestions = [];
  unlockedHints = [];
  playStartedTracked = false;
  sessionStorage.removeItem('score');
  sessionStorage.removeItem('attempts');
  sessionStorage.removeItem('activeSessionQuestions');
  sessionStorage.removeItem('unlockedHints');
  sessionStorage.removeItem('playStartedTracked');
  if (boardHintDisplayEl) boardHintDisplayEl.textContent = '';
  hideCongratsModal();
  initApp();
}

document.getElementById('reset-btn').onclick = resetGame;
modalResetBtn.onclick = resetGame;

document.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

  if (e.key === 'y' || e.key === 'Y') checkAnswer(true);
  if (e.key === 'n' || e.key === 'N') checkAnswer(false);
  if (e.key === 'Escape') {
    if (!modalOverlay.hidden) closeModal();
    if (!congratsModal.hidden) hideCongratsModal();
  }
});

// Image Zoom Modal Logic
function openModal() {
  if (currentItem && currentItem.type === 'image') {
    modalImage.src = currentItem.src;
    modalOverlay.hidden = false;
  }
}

function closeModal() {
  modalOverlay.hidden = true;
  modalImage.src = '';
}

expandBtn.onclick = openModal;
modalClose.onclick = closeModal;
modalOverlay.onclick = (e) => {
  if (e.target === modalOverlay) closeModal();
};

congratsModal.onclick = (e) => {
  if (e.target === congratsModal) hideCongratsModal();
};

// ============================================================================
// Theme Toggle
// ============================================================================
const themeToggle = document.getElementById('theme-toggle');
const themeLabel = document.getElementById('theme-label');

function updateThemeLabel() {
  const isDark = document.body.classList.contains('dark-mode');
  themeLabel.textContent = isDark ? 'Day review' : 'Night review';
}

if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark-mode');
  themeToggle.checked = true;
}
updateThemeLabel();

themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('dark-mode');
  localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
  updateThemeLabel();
});

// ============================================================================
// Realtime Presence & Global Stats (Firebase & Local Fallback)
// ============================================================================
function isFirebaseConfigured(cfg) {
  return cfg && cfg.apiKey && !cfg.apiKey.startsWith('YOUR_');
}

function initPresenceAndStats() {
  // Load local count initially so it doesn't revert to 0 on page refresh
  const savedLocalPlays = localStorage.getItem('local_total_plays') || '0';
  if (totalPlaysEl) totalPlaysEl.textContent = savedLocalPlays;

  if (typeof firebase === 'undefined' || !isFirebaseConfigured(config.firebaseConfig)) {
    if (playersOnlineEl) playersOnlineEl.textContent = '1';
    return;
  }

  // Prevent creating duplicate presence connections when restarting the game state
  if (presenceInitialized) return;

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(config.firebaseConfig);
    }
    const db = firebase.database();
    
    // Live Presence Setup
    presenceRef = db.ref('games/is_this_ai/presence');
    myPresenceRef = presenceRef.push();

    db.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        myPresenceRef.onDisconnect().remove();
        myPresenceRef.set(true);
      }
    });

    presenceRef.on('value', (snap) => {
      if (playersOnlineEl) playersOnlineEl.textContent = snap.numChildren() || 1;
    });

    // Total Played Global Counter
    const totalPlaysRef = db.ref('games/is_this_ai/total_plays');
    totalPlaysRef.on('value', (snap) => {
      const globalCount = snap.val() || 0;
      if (totalPlaysEl) totalPlaysEl.textContent = globalCount;
      localStorage.setItem('local_total_plays', globalCount);
    });

    // Mark presence connection as active for this browser tab
    presenceInitialized = true;
  } catch (err) {
    console.warn('Firebase system offline, using local fallback.', err);
    if (playersOnlineEl) playersOnlineEl.textContent = '1';
  }
}

function incrementTotalPlays() {
  // Update local display and localStorage immediately
  const currentLocal = parseInt(localStorage.getItem('local_total_plays') || '0', 10);
  const newCount = currentLocal + 1;
  localStorage.setItem('local_total_plays', newCount);
  if (totalPlaysEl) totalPlaysEl.textContent = newCount;

  // Transactionally update Firebase database globally across all users
  if (typeof firebase !== 'undefined' && isFirebaseConfigured(config.firebaseConfig)) {
    try {
      const totalPlaysRef = firebase.database().ref('games/is_this_ai/total_plays');
      totalPlaysRef.transaction((currentCount) => {
        return (currentCount || 0) + 1;
      });
    } catch (err) {
      console.warn('Failed to update global total plays stats in Firebase:', err);
    }
  }
}

// Start application
initApp();