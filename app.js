
/* =========================================================
   VoltWise – Electricity Bill Calculator
   Backend: FastAPI + SQLite
   Sections: Config, Backend, Helpers, Auth, Data,
             Render, Views & Events
   ========================================================= */


/* ---------- 1. CONFIG ---------- */

const SLABS = [
  { from: 0, upto: 100, rate: 0 },
  { from: 100, upto: 200, rate: 4.70 },
  { from: 200, upto: 400, rate: 4.95 },
  { from: 400, upto: 500, rate: 6.65 },
  { from: 500, upto: 600, rate: 8.40 },
  { from: 600, upto: 800, rate: 9.45 },
  { from: 800, upto: 1000, rate: 10.50 },
  { from: 1000, upto: Infinity, rate: 11.55 }
];

const MONTHS = [
  'January', 'February', 'March', 'April',
  'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'
];

const API_BASE = 'postgresql://voltwise_db_user:BPaOOQKNFH7UmpWLF0jNhwvev8rijA8X@dpg-db573ed9fdbs73brfrng-a/voltwise_db';

const SESSION = 'vw_session';
const TOKEN_KEY = 'vw_access_token';


/* ---------- 2. BACKEND CONNECTION ---------- */

// Send requests to FastAPI.
// Protected routes automatically receive the login token.

async function apiRequest(path, options = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY);
  const headers = new Headers(options.headers || {});

  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  if (token && !path.startsWith('/auth/')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.detail || `Request failed (${response.status})`
    );
  }

  return result;
}


// Calculate a bill through FastAPI.

async function getBackendBill(units) {
  return await apiRequest(
    `/calculate?units=${encodeURIComponent(units)}`
  );
}


// Save a monthly reading to SQLite.

async function saveReadingToBackend(
  username,
  selectedYear,
  month,
  units
) {
  return await apiRequest('/readings', {
    method: 'POST',
    body: JSON.stringify({
      username,
      year: Number(selectedYear),
      month: Number(month),
      units
    })
  });
}


// Retrieve monthly readings from SQLite.

async function getReadingsFromBackend(username, selectedYear) {
  return await apiRequest(
    `/readings/${encodeURIComponent(username)}/${selectedYear}`
  );
}


// Delete a monthly reading from SQLite.

async function deleteReadingFromBackend(
  username,
  selectedYear,
  month
) {
  return await apiRequest(
    `/readings/${encodeURIComponent(username)}/${selectedYear}/${month}`,
    { method: 'DELETE' }
  );
}


/* ---------- 3. HELPERS ---------- */

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const nf = new Intl.NumberFormat('en-IN', {
  maximumFractionDigits: 2
});

const round2 = number =>
  Math.round((number + Number.EPSILON) * 100) / 100;

const slabLabel = slab =>
  slab.upto === Infinity
    ? `Above ${slab.from}`
    : `${slab.from === 0 ? 0 : slab.from + 1}–${slab.upto}`;


// Progressive billing calculation.

function breakdown(units) {
  const rows = [];

  for (const slab of SLABS) {
    if (units <= slab.from) break;

    const used = Math.min(units, slab.upto) - slab.from;

    rows.push({
      slab,
      used,
      cost: used * slab.rate
    });
  }

  return rows;
}

const calcBill = units =>
  round2(
    breakdown(units).reduce(
      (total, row) => total + row.cost,
      0
    )
  );

async function getBillAmount(units) {
  const result = await getBackendBill(units);
  return result.estimated_bill;
}


// Toast notification.

function toast(message) {
  const element = $('#toast');

  if (!element) {
    console.log(message);
    return;
  }

  element.textContent = message;
  element.classList.add('show');

  clearTimeout(toast.id);

  toast.id = setTimeout(() => {
    element.classList.remove('show');
  }, 2200);
}


/* ---------- 4. AUTHENTICATION ---------- */

// Registration is handled by FastAPI.
// Passwords are hashed and stored by the backend.

async function register(username, password, password2) {
  username = username.trim().toLowerCase();

  if (!/^[a-z0-9_.-]{3,20}$/.test(username)) {
    return 'Username must be 3–20 characters: letters, numbers, . _ -';
  }

  if (password.length < 8 || password.length > 128) {
    return 'Password must be between 8 and 128 characters.';
  }

  if (password !== password2) {
    return 'Passwords do not match.';
  }

  try {
    await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    // Automatically log in after successful registration.
    return await login(username, password);
  } catch (error) {
    return error.message || 'Registration failed.';
  }
}


// Login checks the credentials against SQLite.

async function login(username, password) {
  username = username.trim().toLowerCase();

  if (!username || !password) {
    return 'Enter your username and password.';
  }

  try {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password
      })
    });

    if (!result.access_token) {
      return 'Login failed: no access token received.';
    }

    // Save username for the interface.
    localStorage.setItem(
      SESSION,
      result.username || username
    );

    // Keep the access token for the current browser session.
    sessionStorage.setItem(
      TOKEN_KEY,
      result.access_token
    );

    return '';
  } catch (error) {
    return error.message || 'Login failed.';
  }
}


/* ---------- 5. DATA AND DATABASE LOADING ---------- */

let user = null;
let year = new Date().getFullYear();
let data = {};

const dataKey = () => `vw_data_${user}`;

const saveData = () => {
  if (user) {
    localStorage.setItem(dataKey(), JSON.stringify(data));
  }
};

const yearData = () =>
  data[year] || (data[year] = {});


// Load readings from SQLite.
// Database readings override local cached readings for matching months.

async function loadYearFromBackend(selectedYear) {
  try {
    const readings = await getReadingsFromBackend(
      user,
      selectedYear
    );

    if (!Array.isArray(readings)) {
      throw new Error('Unexpected database response format.');
    }

    if (!data[selectedYear]) {
      data[selectedYear] = {};
    }

    readings.forEach(reading => {
      data[selectedYear][reading.month] = {
        units: Number(reading.units),
        bill: Number(reading.bill)
      };
    });

    saveData();

    console.log(
      `Loaded ${readings.length} readings from SQLite for ${selectedYear}.`
    );

    return true;
  } catch (error) {
    console.error('Database loading failed:', error);

    if (error.message.includes('401')) {
      toast('Session expired. Please log in again.');
      signOut();
      return false;
    }

    toast('Could not load database readings. Check the backend.');

    return false;
  }
}


// Dashboard statistics.

function stats() {
  const entries = Object.values(yearData());
  const count = entries.length;

  const units = entries.reduce(
    (total, reading) => total + reading.units,
    0
  );

  const bill = round2(
    entries.reduce((total, reading) => {
      return total + (
        Number.isFinite(reading.bill)
          ? reading.bill
          : calcBill(reading.units)
      );
    }, 0)
  );

  return {
    n: count,
    units,
    bill,
    avgU: count ? units / count : 0,
    avgB: count ? round2(bill / count) : 0
  };
}


/* ---------- 6. RENDER DASHBOARD ---------- */

let billChart;
let unitChart;

function renderOverview() {
  const summary = stats();

  $('#sUnits').textContent = nf.format(summary.units);
  $('#sBill').textContent = inr.format(summary.bill);
  $('#sAvgU').textContent = nf.format(summary.avgU);
  $('#sAvgB').textContent = inr.format(summary.avgB);

  $('#sCount').textContent =
    `${summary.n} month${summary.n === 1 ? '' : 's'} saved`;

  renderCharts();
  renderTracker();
}


function renderCharts() {
  const yearReadings = yearData();

  const bills = MONTHS.map((_, index) => {
    const reading = yearReadings[index];

    if (!reading) return null;

    return Number.isFinite(reading.bill)
      ? reading.bill
      : calcBill(reading.units);
  });

  const max = Math.max(
    1,
    ...bills.filter(bill => bill !== null)
  );

  const shortMonths = MONTHS.map(month => month.slice(0, 3));

  const billData = bills.map(
    bill => bill === null ? max * 0.04 : bill
  );

  const colors = bills.map(
    bill => bill === null ? '#dfe7e2' : '#1f8a5b'
  );

  const common = {
    responsive: true,
    maintainAspectRatio: false
  };

  if (!billChart) {
    Chart.defaults.font.family =
      "'Manrope', system-ui, sans-serif";

    billChart = new Chart($('#billChart'), {
      type: 'bar',

      data: {
        labels: MONTHS,
        datasets: [{
          data: [],
          backgroundColor: [],
          borderRadius: 8
        }]
      },

      options: {
        ...common,

        plugins: {
          legend: { display: false },

          tooltip: {
            callbacks: {
              title: context => context[0].label,

              label: context =>
                bills[context.dataIndex] === null
                  ? 'Not saved'
                  : 'Estimated bill: ' +
                    inr.format(bills[context.dataIndex])
            }
          }
        },

        scales: {
          x: {
            grid: { display: false },

            ticks: {
              callback: index => shortMonths[index]
            }
          },

          y: {
            beginAtZero: true,

            ticks: {
              callback: value => '₹' + nf.format(value)
            }
          }
        }
      }
    });


    unitChart = new Chart($('#unitChart'), {
      type: 'line',

      data: {
        labels: shortMonths,

        datasets: [{
          data: [],
          borderColor: '#0b3d2e',
          backgroundColor: 'rgba(76,195,138,.25)',
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#4cc38a',
          pointRadius: 5,
          spanGaps: false
        }]
      },

      options: {
        ...common,

        plugins: {
          legend: { display: false },

          tooltip: {
            callbacks: {
              title: context => MONTHS[context[0].dataIndex],

              label: context =>
                nf.format(context.parsed.y) + ' units'
            }
          }
        },

        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true }
        }
      }
    });
  }

  billChart.data.datasets[0].data = billData;
  billChart.data.datasets[0].backgroundColor = colors;
  billChart.update();

  unitChart.data.datasets[0].data = MONTHS.map(
    (_, index) =>
      yearReadings[index]
        ? yearReadings[index].units
        : null
  );

  unitChart.update();
}


function renderTracker() {
  const yearReadings = yearData();

  $('#tracker').innerHTML = MONTHS.map((month, index) => {
    const reading = yearReadings[index];

    const bill = reading
      ? Number.isFinite(reading.bill)
        ? reading.bill
        : calcBill(reading.units)
      : null;

    return `
      <button class="chip ${reading ? 'saved' : ''}" data-go="${index}">
        <b>${month}</b>
        <span>${reading ? nf.format(reading.units) + ' units' : '—'}</span>
        <span>${reading ? inr.format(bill) : ''}</span>
        <em>${reading ? 'Saved' : 'Not saved'}</em>
      </button>
    `;
  }).join('');
}


function slabTable() {
  return `
    <table>
      <thead>
        <tr>
          <th>Units</th>
          <th class="r">Rate per unit</th>
        </tr>
      </thead>

      <tbody>
        ${SLABS.map(slab => `
          <tr>
            <td>
              ${slabLabel(slab)}${slab.rate === 0 ? ' (free)' : ''}
            </td>
            <td class="r">${inr.format(slab.rate)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}


function renderRates() {
  $('#slabTable').innerHTML = slabTable();

  $('#miniRates').innerHTML =
    slabTable() +
    '<p class="hint" style="margin-top:.8rem">' +
    'Example rates; your provider’s actual tariff and subsidy may differ.' +
    '</p>';

  renderSample();
}


async function renderSample() {
  const input = $('#sample');
  const units = parseFloat(input.value);

  if (isNaN(units) || units < 0) {
    $('#sampleOut').innerHTML =
      '<p class="err">Enter a non-negative number of units.</p>';
    return;
  }

  $('#sampleOut').innerHTML = '<p>Calculating bill...</p>';

  try {
    const result = await getBackendBill(units);
    const rows = breakdown(units);

    $('#sampleOut').innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Slab</th>
            <th class="r">Units × rate</th>
            <th class="r">Cost</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${slabLabel(row.slab)}</td>
              <td class="r">
                ${nf.format(row.used)} × ${inr.format(row.slab.rate)}
              </td>
              <td class="r">${inr.format(row.cost)}</td>
            </tr>
          `).join('')}
        </tbody>

        <tfoot>
          <tr>
            <td colspan="2">Backend estimated bill</td>
            <td class="r">${inr.format(result.estimated_bill)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  } catch (error) {
    $('#sampleOut').innerHTML = `
      <p class="err">
        Cannot connect to the VoltWise backend.
        Make sure the Python server is running.
      </p>
    `;

    console.error('Sample bill calculation failed:', error);
  }
}


/* ---------- 7. MONTHLY READING CARDS ---------- */

function renderMonths() {
  const yearReadings = yearData();

  $('#monthGrid').innerHTML = MONTHS.map((month, index) => `
    <article class="card m" id="m${index}" data-m="${index}">
      <div class="m-head">
        <h3>${month}</h3>
        <span class="badge"></span>
      </div>

      <label>
        Units consumed
        <input
          type="number"
          min="0"
          step="any"
          inputmode="decimal"
          placeholder="e.g. 250"
          value="${yearReadings[index] ? yearReadings[index].units : ''}"
        >
      </label>

      <p class="err"></p>

      <div class="est">
        <span>Estimated bill</span>
        <strong></strong>
      </div>

      <div class="m-act">
        <button class="btn save"></button>
        <button class="btn danger del">Delete</button>
      </div>
    </article>
  `).join('');

  $$('.m').forEach(refreshCard);
}


function readUnits(input) {
  const value = input.value.trim();

  if (value === '') return null;

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : NaN;
}


function refreshCard(card) {
  if (!card) return;

  const index = Number(card.dataset.m);
  const input = card.querySelector('input');
  const saved = yearData()[index];
  const units = readUnits(input);

  const badge = card.querySelector('.badge');
  const dirty = saved && units !== saved.units;

  badge.textContent = !saved
    ? 'Not saved'
    : dirty
      ? 'Unsaved changes'
      : 'Saved';

  badge.className = 'badge ' + (
    !saved ? '' : dirty ? 'dirty' : 'saved'
  );

  card.querySelector('strong').textContent =
    inr.format(
      units !== null && !Number.isNaN(units)
        ? calcBill(units)
        : 0
    );

  card.querySelector('.save').textContent =
    saved ? 'Update reading' : 'Save reading';

  card.querySelector('.del').hidden = !saved;

  input.classList.toggle('bad', Number.isNaN(units));

  card.querySelector('.err').textContent =
    Number.isNaN(units)
      ? 'Units must be a number, zero or more.'
      : '';
}


/* ---------- 8. SAVE READING ---------- */

async function saveReading(card) {
  if (!card || !user) return;

  const index = Number(card.dataset.m);
  const input = card.querySelector('input');
  const units = readUnits(input);

  if (units === null) {
    card.querySelector('.err').textContent =
      `Enter the units for ${MONTHS[index]} first.`;

    input.classList.add('bad');
    return;
  }

  if (Number.isNaN(units)) return;

  const saveButton = card.querySelector('.save');
  const errorMessage = card.querySelector('.err');
  const wasSaved = Boolean(yearData()[index]);

  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';
  errorMessage.textContent = '';

  try {
    // Save to the database before updating the browser cache.
    const result = await saveReadingToBackend(
      user,
      year,
      index,
      units
    );

    const saved = result.reading;

    yearData()[index] = {
      units: Number(saved.units),
      bill: Number(saved.bill)
    };

    saveData();

    refreshCard(card);
    renderOverview();

    toast(
      `${MONTHS[index]} ${wasSaved ? 'updated' : 'saved'} — ` +
      inr.format(Number(saved.bill))
    );
  } catch (error) {
    console.error('Database save error:', error);

    errorMessage.textContent =
      error.message.includes('401')
        ? 'Session expired. Please log in again.'
        : 'Database save failed. Check the backend and try again.';

    if (error.message.includes('401')) {
      signOut();
    }
  } finally {
    saveButton.disabled = false;

    saveButton.textContent = yearData()[index]
      ? 'Update reading'
      : 'Save reading';
  }
}


/* ---------- 9. DELETE READING ---------- */

async function deleteReading(card) {
  if (!card || !user) return;

  const index = Number(card.dataset.m);

  if (!yearData()[index]) return;

  const deleteButton = card.querySelector('.del');
  deleteButton.disabled = true;

  try {
    await deleteReadingFromBackend(user, year, index);

    delete yearData()[index];
    saveData();

    card.querySelector('input').value = '';

    refreshCard(card);
    renderOverview();

    toast(`${MONTHS[index]} reading deleted.`);
  } catch (error) {
    console.error('Database delete error:', error);

    toast(
      error.message.includes('401')
        ? 'Session expired. Please log in again.'
        : 'Could not delete reading. Check the backend.'
    );

    if (error.message.includes('401')) {
      signOut();
    }
  } finally {
    deleteButton.disabled = false;
  }
}


/* ---------- 10. VIEWS AND NAVIGATION ---------- */

function showView(view) {
  $$('.view').forEach(element => {
    element.hidden = element.id !== 'v-' + view;
  });

  $$('.side nav button').forEach(button => {
    button.classList.toggle(
      'on',
      button.dataset.view === view
    );
  });

  $('#title').textContent = {
    overview: 'Overview',
    readings: 'Monthly Readings',
    rates: 'Rate Guide'
  }[view];

  closeMenu();

  if (view === 'overview') {
    renderOverview();
  }
}


function closeMenu() {
  $('#side').classList.remove('open');
  $('#scrim').classList.remove('open');
}


/* ---------- 11. ENTER APP ---------- */

async function enterApp(name) {
  user = name;

  try {
    data = JSON.parse(
      localStorage.getItem(dataKey()) || '{}'
    );
  } catch {
    data = {};
  }

  $('#auth').hidden = true;
  $('#app').hidden = false;

  $('#whoName').textContent = name;
  $('#avatar').textContent = name[0].toUpperCase();

  const select = $('#year');
  const now = new Date().getFullYear();

  year = now;

  select.innerHTML = Array.from(
    { length: 6 },
    (_, index) => now - 4 + index
  ).map(selectedYear => `
    <option value="${selectedYear}" ${
      selectedYear === now ? 'selected' : ''
    }>
      ${selectedYear}
    </option>
  `).join('');

  await loadYearFromBackend(year);

  // A failed authentication check may sign the user out.
  if (!user) return;

  renderMonths();
  renderRates();
  showView('overview');
}


/* ---------- 12. SIGN OUT ---------- */

function signOut() {
  localStorage.removeItem(SESSION);
  sessionStorage.removeItem(TOKEN_KEY);

  user = null;
  data = {};

  $('#app').hidden = true;
  $('#auth').hidden = false;

  [
    '#lUser',
    '#lPass',
    '#rUser',
    '#rPass',
    '#rPass2'
  ].forEach(selector => {
    const element = $(selector);
    if (element) element.value = '';
  });

  $('#lErr').textContent = '';
  $('#rErr').textContent = '';
}


/* ---------- 13. AUTH TABS AND FORMS ---------- */

$$('.tabs button').forEach(button => {
  button.onclick = () => {
    $$('.tabs button').forEach(tab => {
      tab.classList.toggle('on', tab === button);
    });

    $('#loginForm').hidden =
      button.dataset.tab !== 'login';

    $('#registerForm').hidden =
      button.dataset.tab !== 'register';
  };
});


$('#showRegister').onclick = () => {
  $('[data-tab="register"]').click();
};


$('#showLogin').onclick = () => {
  $('[data-tab="login"]').click();
};


// Login form.

$('#loginForm').onsubmit = async event => {
  event.preventDefault();

  const error = await login(
    $('#lUser').value,
    $('#lPass').value
  );

  $('#lErr').textContent = error;

  if (!error) {
    await enterApp(
      localStorage.getItem(SESSION)
    );
  }
};


// Registration form.

$('#registerForm').onsubmit = async event => {
  event.preventDefault();

  const error = await register(
    $('#rUser').value,
    $('#rPass').value,
    $('#rPass2').value
  );

  $('#rErr').textContent = error;

  if (!error) {
    await enterApp(
      localStorage.getItem(SESSION)
    );
  }
};


/* ---------- 14. NAVIGATION EVENTS ---------- */

$$('.side nav button').forEach(button => {
  button.onclick = () => showView(button.dataset.view);
});


$('#signOut').onclick = signOut;


$('#burger').onclick = () => {
  $('#side').classList.add('open');
  $('#scrim').classList.add('open');
};


$('#scrim').onclick = closeMenu;


// Load readings when the selected year changes.

$('#year').onchange = async event => {
  year = Number(event.target.value);

  await loadYearFromBackend(year);

  if (!user) return;

  renderMonths();
  renderOverview();
};


$('#sample').oninput = renderSample;


/* ---------- 15. MONTH CARD EVENTS ---------- */

$('#monthGrid').addEventListener('input', event => {
  const card = event.target.closest('.m');

  if (card) {
    refreshCard(card);
  }
});


$('#monthGrid').addEventListener('click', event => {
  const card = event.target.closest('.m');

  if (!card) return;

  if (event.target.closest('.save')) {
    saveReading(card);
  }

  if (event.target.closest('.del')) {
    deleteReading(card);
  }
});


$('#monthGrid').addEventListener('keydown', event => {
  if (
    event.key === 'Enter' &&
    event.target.tagName === 'INPUT'
  ) {
    event.preventDefault();
    saveReading(event.target.closest('.m'));
  }
});


/* ---------- 16. TRACKER NAVIGATION ---------- */

$('#tracker').addEventListener('click', event => {
  const chip = event.target.closest('[data-go]');

  if (!chip) return;

  showView('readings');

  const card = $('#m' + chip.dataset.go);

  if (card) {
    card.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });

    card.querySelector('input').focus();
  }
});


/* ---------- 17. RESUME SESSION ---------- */

// A token is required to resume a previous login.
// Tokens are kept in sessionStorage, not localStorage.

const current = localStorage.getItem(SESSION);
const savedToken = sessionStorage.getItem(TOKEN_KEY);

if (current && savedToken) {
  enterApp(current);
} else {
  localStorage.removeItem(SESSION);
  sessionStorage.removeItem(TOKEN_KEY);
}
