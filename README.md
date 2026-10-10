# VoltWise – Electricity Bill Calculator

A responsive, green-themed electricity bill tracker built with plain HTML, CSS and JavaScript.
No build tools, no installs, no paid services. All prices are shown in Indian rupees (₹).

> **Important:** The tariff rates in this project are **example rates only**. Always check them against
> your actual electricity provider's tariff and subsidy rules before relying on any bill estimate.

## What's in the folder

| File | What it does |
|---|---|
| `index.html` | Page structure: login, registration, sidebar, Overview, Monthly Readings, Rate Guide |
| `styles.css` | Green theme and responsive (mobile/tablet/desktop) layout |
| `app.js` | Login, bill calculation, saving to localStorage, charts, navigation |
| `README.md` | These instructions |

`index.html` loads `styles.css` and `app.js` from the same folder, so **keep all files together**.

## How to run it (beginner steps)

1. **Unzip** `VoltWise.zip`. You will get a `VoltWise` folder.
2. **Option A – quickest:** double-click `index.html` to open it in Chrome, Edge or Firefox.
3. **Option B – recommended** (login password hashing works most reliably on `localhost`):
   - *VS Code:* install the **Live Server** extension, right-click `index.html` → **Open with Live Server**.
   - *Terminal:* open a terminal inside the folder, run `python -m http.server 8000`, then visit <http://localhost:8000>.
4. Be online the first time: the chart library (Chart.js) and the Manrope font load from free CDNs.
   If you are offline the app still works, but charts and the custom font will not appear.

## How to use it

1. Click **Create account**, choose a username and password (6+ characters), confirm it, and you are signed in.
2. Open **Monthly Readings**, type the units for a month, and press **Save reading** (or Enter).
   The estimated bill updates as you type. Saved months show **Saved**; editing one shows **Unsaved changes**,
   and the button becomes **Update reading**. **Delete** removes a reading.
3. **Overview** shows total yearly units, estimated yearly bill, average monthly units and average monthly bill
   (averages count only months you saved), the monthly bill chart, a units chart, and a monthly tracker.
4. **Rate Guide** shows the tariff slabs and a calculator that explains every step.
5. Use the **Year** dropdown to keep separate records per year. **Sign Out** returns to the login page.

## How the bill is calculated

Rates are applied **progressively**: each rate applies only to the units inside its slab.

| Slab | Rate per unit |
|---|---|
| 0–100 | ₹0.00 |
| 101–200 | ₹4.70 |
| 201–400 | ₹4.95 |
| 401–500 | ₹6.65 |
| 501–600 | ₹8.40 |
| 601–800 | ₹9.45 |
| 801–1000 | ₹10.50 |
| Above 1000 | ₹11.55 |

Example, 250 units: 100 × ₹0 + 100 × ₹4.70 + 50 × ₹4.95 = **₹717.50**.

To change the rates, edit the `SLABS` list at the top of `app.js`.

## Data storage and login: DEMO ONLY

- Accounts and readings are saved in your **browser's localStorage**, separately for each user and year.
  They stay after a page refresh but live only in that browser on that computer. Clearing browser data erases them.
- The login is a **demo and is NOT secure authentication.** Passwords are salted and hashed rather than stored
  as plain text, but everything runs in the browser, so anyone with access to the browser can read or tamper with
  the stored data. Do not reuse a real password.
- For a real website, use a backend such as **Firebase Authentication + Cloud Firestore**: replace
  `register()` and `login()` in `app.js` with Firebase sign-in calls, and replace `saveData()` and the data load in
  `enterApp()` with Firestore reads and writes.

## Troubleshooting

- **Charts are empty or missing:** you are offline or the CDN is blocked. Connect to the internet and refresh.
- **Login message about localhost:** open the app with Live Server or `python -m http.server` (Option B).
- **Lost data:** it is tied to the browser and address you used. `localhost:8000` and a double-clicked file are different places.
