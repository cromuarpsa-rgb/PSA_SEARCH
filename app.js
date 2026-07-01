/* PSA Search System — client application
 * Works both as a static site (GitHub Pages) and served locally by app.py.
 * All search/sort/pagination happens in the browser against data/psa-data.json.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);

  const loginScreen = $("loginScreen");
  const loginForm = $("loginForm");
  const loginError = $("loginError");
  const togglePassword = $("togglePassword");
  const loginStats = $("loginStats");

  const appShell = $("appShell");
  const themeToggle = $("themeToggle");

  const devMenuWrapper = $("devMenuWrapper");
  const adminMenuWrapper = $("adminMenuWrapper");
  const adminMenuButton = $("adminMenuButton");
  const adminMenu = $("adminMenu");
  const adminAddUser = $("adminAddUser");
  const adminManageUsers = $("adminManageUsers");

  const userAvatar = $("userAvatar");
  const currentUserLabel = $("currentUserLabel");
  const logoutButton = $("logoutButton");

  const searchInput = $("searchInput");
  const sheetSelect = $("sheetSelect");
  const pageSizeSelect = $("pageSizeSelect");
  const exportCsvButton = $("exportCsvButton");
  const clearButton = $("clearButton");

  const fileName = $("fileName");
  const totalCount = $("totalCount");
  const resultCount = $("resultCount");
  const pageIndicator = $("pageIndicator");
  const sheetPills = $("sheetPills");

  const statusText = $("statusText");
  const table = $("resultsTable");
  const tableFooter = $("tableFooter");
  const prevPageButton = $("prevPageButton");
  const nextPageButton = $("nextPageButton");
  const paginationSummary = $("paginationSummary");

  const rowModal = $("rowModal");
  const rowModalBody = $("rowModalBody");
  const userModal = $("userModal");
  const userForm = $("userForm");
  const newUsername = $("newUsername");
  const newPassword = $("newPassword");
  const userError = $("userError");
  const userSuccess = $("userSuccess");
  const manageUsersModal = $("manageUsersModal");
  const userList = $("userList");

  const toast = $("toast");

  // ---------------------------------------------------------------------
  // Constants / state
  // ---------------------------------------------------------------------
  const ADMIN_USERNAME = "admin";
  // SHA-256("admin123"). The default account should be changed after first
  // login via "Manage local users"; this is a lightweight local-access
  // gate, not a hardened identity system.
  const ADMIN_PASSWORD_HASH = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";
  const LOCAL_USERS_KEY = "psa_search_users_v2";
  const THEME_KEY = "psa_search_theme";
  const SESSION_KEY = "psa_search_session";

  let workbook = null;
  let activeSheet = "all";
  let currentUser = null;
  let currentPage = 1;
  let pageSize = 50;
  let sortColumn = null;
  let sortDirection = 1;
  let filteredCache = { columns: [], rows: [], total: 0 };

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(value, terms) {
    const text = escapeHtml(value ?? "");
    if (!terms.length) return text;
    let result = text;
    terms.forEach((term) => {
      if (!term) return;
      const re = new RegExp("(" + escapeRegExp(term) + ")", "ig");
      result = result.replace(re, "<mark>$1</mark>");
    });
    return result;
  }

  function looksLikeCode(column, value) {
    return /code|c1[46]|c07(_grade)?$/i.test(column) && /^\d+$/.test(String(value || "").trim());
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Best-effort activity log. When running under app.py (local server) this
  // records login/search/logout events to logs/activity.log. On GitHub
  // Pages there is no backend at /api/log, so the request 404s and is
  // silently ignored — the rest of the app is unaffected either way.
  function logEvent(event, details) {
    try {
      fetch("/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, username: currentUser || "-", details: details || "-" }),
      }).catch(() => {});
    } catch {
      /* static hosting: no backend, ignore */
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove("visible"), 2600);
  }

  function closeAllModals() {
    [rowModal, userModal, manageUsersModal].forEach((m) => m.classList.add("hidden"));
  }

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", closeAllModals);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAllModals();
  });

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.textContent = theme === "dark" ? "\u2600" : "\u263D";
    themeToggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }

  function initTheme() {
    const stored = localStorage.getItem(THEME_KEY);
    const preferred = stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    applyTheme(preferred);
  }

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(THEME_KEY, next);
  });

  // ---------------------------------------------------------------------
  // Local user store (browser-only accounts, hashed passwords)
  // ---------------------------------------------------------------------
  function loadStoredUsers() {
    try {
      const raw = localStorage.getItem(LOCAL_USERS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveStoredUsers(users) {
    localStorage.setItem(LOCAL_USERS_KEY, JSON.stringify(users));
  }

  async function verifyLogin(username, password) {
    if (username === ADMIN_USERNAME) {
      return (await sha256(password)) === ADMIN_PASSWORD_HASH;
    }
    const users = loadStoredUsers();
    const record = users[username];
    if (!record) return false;
    return (await sha256(password)) === record.hash;
  }

  // ---------------------------------------------------------------------
  // Auth flow
  // ---------------------------------------------------------------------
  function showApp(username) {
    currentUser = username;
    sessionStorage.setItem(SESSION_KEY, username);
    loginScreen.classList.add("hidden");
    appShell.classList.remove("hidden");
    currentUserLabel.textContent = username;
    userAvatar.textContent = username.slice(0, 2).toUpperCase();
    adminMenuWrapper.classList.toggle("hidden", username !== ADMIN_USERNAME);
    if (!workbook) loadWorkbook();
  }

  function showLogin(message) {
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
    loginScreen.classList.remove("hidden");
    appShell.classList.add("hidden");
    loginError.textContent = message || "";
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = $("username").value.trim();
    const password = $("password").value;
    const ok = await verifyLogin(username, password);
    if (ok) {
      loginError.textContent = "";
      showApp(username);
      logEvent("login_success", username);
    } else {
      loginError.textContent = "Invalid username or password.";
      logEvent("login_failed", username);
    }
  });

  togglePassword.addEventListener("click", () => {
    const field = $("password");
    const show = field.type === "password";
    field.type = show ? "text" : "password";
    togglePassword.textContent = show ? "\u{1F648}" : "\u{1F441}";
  });

  logoutButton.addEventListener("click", () => {
    logEvent("logout", currentUser);
    showLogin();
    showToast("Logged out.");
  });

  // ---------------------------------------------------------------------
  // Admin menu + user management
  // ---------------------------------------------------------------------
  adminMenuButton.addEventListener("click", () => {
    const expanded = adminMenuButton.getAttribute("aria-expanded") === "true";
    adminMenuButton.setAttribute("aria-expanded", String(!expanded));
    adminMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", (event) => {
    if (!adminMenuWrapper.contains(event.target)) {
      adminMenu.classList.add("hidden");
      adminMenuButton.setAttribute("aria-expanded", "false");
    }
  });

  adminAddUser.addEventListener("click", () => {
    adminMenu.classList.add("hidden");
    userError.textContent = "";
    userSuccess.textContent = "";
    newUsername.value = "";
    newPassword.value = "";
    userModal.classList.remove("hidden");
    newUsername.focus();
  });

  adminManageUsers.addEventListener("click", () => {
    adminMenu.classList.add("hidden");
    renderUserList();
    manageUsersModal.classList.remove("hidden");
  });

  function renderUserList() {
    const users = loadStoredUsers();
    const names = Object.keys(users);
    userList.innerHTML =
      '<li><span><strong>admin</strong> &mdash; built-in</span></li>' +
      (names.length
        ? names.map((name) => `<li><span>${escapeHtml(name)}</span><button class="remove-user" data-user="${escapeHtml(name)}">Remove</button></li>`).join("")
        : '<li><span>No local users yet.</span></li>');
    userList.querySelectorAll(".remove-user").forEach((btn) => {
      btn.addEventListener("click", () => {
        const users2 = loadStoredUsers();
        delete users2[btn.dataset.user];
        saveStoredUsers(users2);
        renderUserList();
        showToast(`Removed "${btn.dataset.user}".`);
      });
    });
  }

  userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    userError.textContent = "";
    userSuccess.textContent = "";
    const username = newUsername.value.trim();
    const password = newPassword.value;

    if (!username || !password) {
      userError.textContent = "Both username and password are required.";
      return;
    }
    if (username === ADMIN_USERNAME) {
      userError.textContent = "That username is reserved.";
      return;
    }
    const users = loadStoredUsers();
    if (users[username]) {
      userError.textContent = "This username already exists.";
      return;
    }
    users[username] = { hash: await sha256(password), created: new Date().toISOString() };
    saveStoredUsers(users);
    userSuccess.textContent = `User "${username}" created.`;
    newUsername.value = "";
    newPassword.value = "";
    showToast(`User "${username}" created.`);
  });

  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------
  async function loadWorkbook() {
    statusText.textContent = "Loading records\u2026";
    try {
      const response = await fetch("data/psa-data.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load workbook data.");
      workbook = await response.json();
      if (!workbook.sheets || !workbook.sheets.length) {
        statusText.textContent = "Workbook loaded, but it has no sheets. Run scripts/export_workbook.py to refresh data.";
        fileName.textContent = workbook.file || "Unknown workbook";
        renderEmptyState("No sheets available.");
        return;
      }
      fileName.textContent = workbook.file || "Unknown workbook";
      const totalRows = workbook.sheets.reduce((sum, s) => sum + (s.count || 0), 0);
      loginStats.querySelectorAll("dd")[0].textContent = String(workbook.sheets.length);
      loginStats.querySelectorAll("dd")[1].textContent = totalRows.toLocaleString();
      renderSheetControls();
      runSearch();
    } catch (error) {
      statusText.textContent = error.message;
      fileName.textContent = "Workbook unavailable";
      renderEmptyState(error.message);
    }
  }

  function renderEmptyState(message) {
    table.querySelector("thead").innerHTML = "";
    table.querySelector("tbody").innerHTML = `<tr><td class="empty-state"><strong>No data to show</strong>${escapeHtml(message)}</td></tr>`;
    resultCount.textContent = "0";
    totalCount.textContent = "0";
    pageIndicator.textContent = "Page 0 of 0";
    tableFooter.style.display = "none";
  }

  // ---------------------------------------------------------------------
  // Sheet tabs
  // ---------------------------------------------------------------------
  function renderSheetControls() {
    const sheets = workbook.sheets;
    const optionValues = ["all", ...sheets.map((s) => s.name)];
    sheetSelect.innerHTML = '<option value="all">All sheets</option>' + sheets.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join("");
    if (!optionValues.includes(activeSheet)) activeSheet = "all";
    sheetSelect.value = activeSheet;

    const totalRows = sheets.reduce((sum, s) => sum + s.count, 0);
    const pills = [{ name: "all", label: "All sheets", count: totalRows }].concat(
      sheets.map((s) => ({ name: s.name, label: s.name, count: s.count }))
    );
    sheetPills.innerHTML = pills
      .map((p) => `<button type="button" data-sheet="${escapeHtml(p.name)}" class="${p.name === activeSheet ? "active" : ""}">${escapeHtml(p.label)} <span class="count">${p.count.toLocaleString()}</span></button>`)
      .join("");
    sheetPills.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeSheet = btn.dataset.sheet;
        sheetSelect.value = activeSheet;
        currentPage = 1;
        sortColumn = null;
        renderSheetControls();
        runSearch();
      });
    });
  }

  sheetSelect.addEventListener("change", () => {
    activeSheet = sheetSelect.value;
    currentPage = 1;
    sortColumn = null;
    renderSheetControls();
    runSearch();
  });

  // ---------------------------------------------------------------------
  // Search / sort / pagination
  // ---------------------------------------------------------------------
  function getSelectedSheets() {
    if (!workbook) return [];
    return activeSheet === "all" ? workbook.sheets : workbook.sheets.filter((s) => s.name === activeSheet);
  }

  function buildLabels(sheets) {
    const labels = {};
    sheets.forEach((s) => Object.assign(labels, s.labels || {}));
    return labels;
  }

  function filterAndCollect(terms) {
    const sheets = getSelectedSheets();
    const showSheetColumn = activeSheet === "all";
    let columns = showSheetColumn ? ["Sheet"] : [];
    const labels = showSheetColumn ? { Sheet: "Sheet" } : {};
    Object.assign(labels, buildLabels(sheets));

    let rows = [];
    sheets.forEach((sheet) => {
      (sheet.columns || []).forEach((col) => {
        if (!columns.includes(col)) columns.push(col);
      });
      sheet.rows.forEach((row) => {
        if (terms.length) {
          const haystack = Object.values(row).join(" ").toLowerCase();
          if (!terms.every((term) => haystack.includes(term))) return;
        }
        rows.push(showSheetColumn ? { Sheet: sheet.name, ...row } : row);
      });
    });

    return { columns, labels, rows };
  }

  function sortRows(rows) {
    if (!sortColumn) return rows;
    const col = sortColumn;
    const dir = sortDirection;
    return [...rows].sort((a, b) => {
      const av = (a[col] ?? "").toString();
      const bv = (b[col] ?? "").toString();
      const an = parseFloat(av);
      const bn = parseFloat(bv);
      let cmp;
      if (!isNaN(an) && !isNaN(bn) && String(an) === av.trim() && String(bn) === bv.trim()) {
        cmp = an - bn;
      } else {
        cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      }
      return cmp * dir;
    });
  }

  function runSearch() {
    if (!workbook) return;
    const terms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const { columns, labels, rows } = filterAndCollect(terms);
    const sorted = sortRows(rows);
    filteredCache = { columns, labels, rows: sorted, terms };
    currentPage = Math.min(Math.max(1, currentPage), Math.max(1, Math.ceil(sorted.length / pageSize)));
    renderTable();
    renderSummary();
  }

  function renderSummary() {
    const total = filteredCache.rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    totalCount.textContent = total.toLocaleString();
    const start = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const end = Math.min(total, currentPage * pageSize);
    resultCount.textContent = (end - start + (total ? 1 : 0)).toLocaleString();
    pageIndicator.textContent = `Page ${total ? currentPage : 0} of ${total ? totalPages : 0}`;
    paginationSummary.textContent = total ? `Showing ${start.toLocaleString()}\u2013${end.toLocaleString()} of ${total.toLocaleString()}` : "No records";
    prevPageButton.disabled = currentPage <= 1;
    nextPageButton.disabled = currentPage >= totalPages;
    statusText.textContent = total
      ? `${total.toLocaleString()} matching record${total === 1 ? "" : "s"} across ${getSelectedSheets().length} sheet${getSelectedSheets().length === 1 ? "" : "s"}`
      : "No matching records found. Try different keywords or clear filters.";
    tableFooter.style.display = total ? "flex" : "none";
  }

  function renderTable() {
    const { columns, labels, rows, terms } = filteredCache;
    const thead = table.querySelector("thead");
    const tbody = table.querySelector("tbody");

    thead.innerHTML = columns.length
      ? "<tr>" + columns.map((col) => {
          const sorted = sortColumn === col;
          const arrow = sorted ? (sortDirection === 1 ? "\u25B2" : "\u25BC") : "\u21C5";
          return `<th data-col="${escapeHtml(col)}" class="${sorted ? "sorted" : ""}">${escapeHtml(labels[col] || col)} <span class="sort-arrow">${arrow}</span></th>`;
        }).join("") + "</tr>"
      : "";

    thead.querySelectorAll("th").forEach((th) => {
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (sortColumn === col) {
          sortDirection *= -1;
        } else {
          sortColumn = col;
          sortDirection = 1;
        }
        filteredCache.rows = sortRows(filteredCache.rows);
        currentPage = 1;
        renderTable();
        renderSummary();
      });
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="empty-state" colspan="${Math.max(columns.length, 1)}"><strong>No matching records</strong>Try a shorter search term or switch sheets.</td></tr>`;
      return;
    }

    const start = (currentPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    tbody.innerHTML = pageRows.map((row, i) => {
      const cells = columns.map((col) => {
        const raw = row[col] ?? "";
        const content = highlight(raw, terms);
        return looksLikeCode(col, raw) ? `<td><span class="code-chip">${content}</span></td>` : `<td>${content}</td>`;
      }).join("");
      return `<tr data-index="${start + i}">${cells}</tr>`;
    }).join("");

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => openRowModal(rows[Number(tr.dataset.index)], columns, labels));
    });
  }

  function openRowModal(row, columns, labels) {
    rowModalBody.innerHTML = columns.map((col) => `<div><dt>${escapeHtml(labels[col] || col)}</dt><dd>${escapeHtml(row[col] || "\u2014")}</dd></div>`).join("");
    rowModal.classList.remove("hidden");
  }

  // ---------------------------------------------------------------------
  // Pagination controls
  // ---------------------------------------------------------------------
  prevPageButton.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage -= 1;
      renderTable();
      renderSummary();
    }
  });
  nextPageButton.addEventListener("click", () => {
    const totalPages = Math.max(1, Math.ceil(filteredCache.rows.length / pageSize));
    if (currentPage < totalPages) {
      currentPage += 1;
      renderTable();
      renderSummary();
    }
  });
  pageSizeSelect.addEventListener("change", () => {
    pageSize = Number(pageSizeSelect.value) || 50;
    currentPage = 1;
    renderTable();
    renderSummary();
  });

  // ---------------------------------------------------------------------
  // Search input + clear + CSV export
  // ---------------------------------------------------------------------
  let searchTimer = null;
  let searchLogTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentPage = 1;
      runSearch();
    }, 150);
    clearTimeout(searchLogTimer);
    searchLogTimer = setTimeout(() => {
      const q = searchInput.value.trim();
      if (q) logEvent("search", `sheet=${activeSheet}; query=${q}; matches=${filteredCache.rows.length}`);
    }, 900);
  });

  clearButton.addEventListener("click", () => {
    searchInput.value = "";
    activeSheet = "all";
    sortColumn = null;
    currentPage = 1;
    renderSheetControls();
    runSearch();
    searchInput.focus();
  });

  exportCsvButton.addEventListener("click", () => {
    const { columns, labels, rows } = filteredCache;
    if (!rows.length) {
      showToast("Nothing to export yet.");
      return;
    }
    const header = columns.map((c) => csvEscape(labels[c] || c)).join(",");
    const body = rows.map((row) => columns.map((c) => csvEscape(row[c] ?? "")).join(",")).join("\n");
    const csv = header + "\n" + body;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `psa-search-export-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length.toLocaleString()} rows.`);
  });

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  // ---------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------
  document.addEventListener("keydown", (event) => {
    if (appShell.classList.contains("hidden")) return;
    const tag = (event.target.tagName || "").toLowerCase();
    if (event.key === "/" && tag !== "input" && tag !== "textarea") {
      event.preventDefault();
      searchInput.focus();
    }
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  initTheme();
  pageSize = Number(pageSizeSelect.value) || 50;

  const existingSession = sessionStorage.getItem(SESSION_KEY);
  if (existingSession) {
    showApp(existingSession);
  } else {
    showLogin();
  }
})();
