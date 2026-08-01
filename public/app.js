const app = document.getElementById("app");

const state = {
  user: null,
  view: "bills", // 'bills' | 'loans'
  bills: [],
  loans: [],
  authMode: "login", // 'login' | 'register'
  authError: null,
  busy: false,
  formModal: null, // { mode: 'create'|'edit', bill?: {...} }
  loanFormModal: null, // { mode: 'create'|'edit', loan?: {...} }
  historyModal: null, // { billId, billName, items: [] }
  allHistory: null, // array or null
  toast: null,
  filter: null, // null | 'unpaid' | 'overdue' | 'soon'
  loanFilter: null, // null | 'lend' | 'borrow' | 'overdue'
  expanded: new Set(), // bill ids currently showing full detail
  loanExpanded: new Set(), // loan ids currently showing full detail
  customEditing: new Set(), // bill ids currently showing the custom-amount input, unsaved
  loansLoaded: false,
};

// ---------- API helper ----------

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    throw new Error((data && data.error) || `เกิดข้อผิดพลาด (${res.status})`);
  }
  return data;
}

function showToast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    state.toast = null;
    render();
  }, 2500);
}

// ---------- Alerts (SweetAlert2, themed) ----------

function themedSwal(options) {
  const isDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return Swal.fire({
    background: isDark ? "#1a1c26" : "#ffffff",
    color: isDark ? "#eef0f8" : "#1a1c29",
    confirmButtonColor: "#5b5fef",
    cancelButtonColor: isDark ? "#2c2f3d" : "#e4e6f0",
    buttonsStyling: true,
    ...options,
  });
}

function showError(message) {
  return themedSwal({
    icon: "error",
    title: "เกิดข้อผิดพลาด",
    text: message,
    confirmButtonText: "ตกลง",
  });
}

async function confirmDanger(message, confirmText) {
  const result = await themedSwal({
    icon: "warning",
    title: "ยืนยันการทำรายการ",
    text: message,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "ยกเลิก",
    confirmButtonColor: "#e0433f",
  });
  return result.isConfirmed;
}

// ---------- Formatting ----------

const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", { day: "numeric", month: "short", year: "numeric" });

function fmtMoney(n) {
  return `฿${money.format(Number(n))}`;
}

function fmtDate(isoDate) {
  return dateFmt.format(new Date(isoDate + "T00:00:00"));
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysUntil(isoDate) {
  const today = new Date(todayStr() + "T00:00:00");
  const target = new Date(isoDate + "T00:00:00");
  return Math.round((target - today) / 86400000);
}

function billStatus(bill) {
  if (bill.recurrence === "once" && bill.is_paid) {
    return { key: "paid", label: "จ่ายแล้ว" };
  }
  const diff = daysUntil(bill.next_due_date);
  if (diff < 0) return { key: "overdue", label: `เลยกำหนด ${Math.abs(diff)} วัน` };
  if (diff <= 5) return { key: "soon", label: diff === 0 ? "ครบกำหนดวันนี้" : `อีก ${diff} วัน` };
  return { key: "upcoming", label: fmtDate(bill.next_due_date) };
}

function loanStatus(loan) {
  if (loan.is_returned) {
    return { key: "returned", label: "คืนแล้ว" };
  }
  if (!loan.due_date) {
    return { key: "pending", label: "ยังไม่คืน" };
  }
  const diff = daysUntil(loan.due_date);
  if (diff < 0) return { key: "overdue", label: `เลยกำหนดคืน ${Math.abs(diff)} วัน` };
  if (diff <= 5) return { key: "soon", label: diff === 0 ? "ครบกำหนดคืนวันนี้" : `อีก ${diff} วัน` };
  return { key: "pending", label: `นัดคืน ${fmtDate(loan.due_date)}` };
}

// ---------- Init ----------

async function init() {
  try {
    const { user } = await api("/auth/me");
    state.user = user;
    if (user) await loadBills();
  } catch (_) {
    state.user = null;
  }
  render();
}

async function loadBills() {
  const { bills } = await api("/bills");
  state.bills = bills;
}

async function loadLoans() {
  const { loans } = await api("/loans");
  state.loans = loans;
  state.loansLoaded = true;
}

async function switchView(view) {
  state.view = view;
  if (view === "loans" && !state.loansLoaded) {
    await loadLoans();
  }
  render();
}

// ---------- Actions ----------

async function handleAuthSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const email = form.email.value.trim();
  const password = form.password.value;
  state.authError = null;
  state.busy = true;
  render();
  try {
    const endpoint = state.authMode === "login" ? "/auth/login" : "/auth/register";
    const { user } = await api(endpoint, { method: "POST", body: { email, password } });
    state.user = user;
    await loadBills();
  } catch (err) {
    state.authError = err.message;
  } finally {
    state.busy = false;
    render();
  }
}

async function handleLogout() {
  await api("/auth/logout", { method: "POST" });
  state.user = null;
  state.bills = [];
  state.loans = [];
  state.loansLoaded = false;
  state.view = "bills";
  render();
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    name: form.name.value.trim(),
    full_amount: parseFloat(form.full_amount.value),
    min_amount: parseFloat(form.min_amount.value),
    next_due_date: form.next_due_date.value,
    recurrence: form.recurrence.value,
  };
  try {
    if (state.formModal.mode === "edit") {
      await api(`/bills/${state.formModal.bill.id}`, { method: "PUT", body: payload });
    } else {
      await api("/bills", { method: "POST", body: payload });
    }
    state.formModal = null;
    await loadBills();
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function selectPaymentOption(billId, option, customAmount) {
  try {
    await api(`/bills/${billId}/select`, {
      method: "PATCH",
      body: { payment_option: option, custom_amount: customAmount ?? null },
    });
    await loadBills();
    render();
    showToast("บันทึกวิธีจ่ายแล้ว กดปุ่ม \"ทำเครื่องหมายว่าจ่ายแล้ว\" เพื่อยืนยันการจ่ายจริง");
  } catch (err) {
    showError(err.message);
  }
}

async function markPaid(billId) {
  try {
    await api(`/bills/${billId}/pay`, { method: "POST" });
    await loadBills();
    render();
    showToast("บันทึกการจ่ายแล้ว");
  } catch (err) {
    showError(err.message);
  }
}

async function undoPaid(billId) {
  try {
    await api(`/bills/${billId}/undo`, { method: "POST" });
    await loadBills();
    render();
    showToast("ยกเลิกการจ่ายล่าสุดแล้ว");
  } catch (err) {
    showError(err.message);
  }
}

async function deleteBill(billId) {
  const ok = await confirmDanger("ลบรายการบิลนี้และประวัติทั้งหมดของบิลนี้?", "ลบ");
  if (!ok) return;
  try {
    await api(`/bills/${billId}`, { method: "DELETE" });
    await loadBills();
    render();
  } catch (err) {
    showError(err.message);
  }
}

// ---------- Actions: ยืม/คืน ----------

async function handleLoanFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const payload = {
    person_name: form.person_name.value.trim(),
    direction: form.direction.value,
    amount: parseFloat(form.amount.value),
    note: form.note.value.trim(),
    borrowed_date: form.borrowed_date.value,
    due_date: form.due_date.value || null,
  };
  try {
    if (state.loanFormModal.mode === "edit") {
      await api(`/loans/${state.loanFormModal.loan.id}`, { method: "PUT", body: payload });
    } else {
      await api("/loans", { method: "POST", body: payload });
    }
    state.loanFormModal = null;
    await loadLoans();
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function markReturned(loanId) {
  try {
    await api(`/loans/${loanId}/return`, { method: "POST" });
    await loadLoans();
    render();
    showToast("บันทึกว่าคืนแล้ว");
  } catch (err) {
    showError(err.message);
  }
}

async function undoReturn(loanId) {
  try {
    await api(`/loans/${loanId}/undo-return`, { method: "POST" });
    await loadLoans();
    render();
    showToast("ยกเลิกการคืนล่าสุดแล้ว");
  } catch (err) {
    showError(err.message);
  }
}

async function deleteLoan(loanId) {
  const ok = await confirmDanger("ลบรายการยืม/คืนนี้?", "ลบ");
  if (!ok) return;
  try {
    await api(`/loans/${loanId}`, { method: "DELETE" });
    await loadLoans();
    render();
  } catch (err) {
    showError(err.message);
  }
}

async function openHistory(bill) {
  const { history } = await api(`/bills/${bill.id}/history`);
  state.historyModal = { billId: bill.id, billName: bill.name, items: history };
  render();
}

async function openAllHistory() {
  const { history } = await api("/history");
  state.allHistory = history;
  render();
}

// ---------- Render: Auth ----------

function renderAuth() {
  const isLogin = state.authMode === "login";
  app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-mark">฿</div>
        <h1>ตัวจัดการบิลที่ต้องจ่าย</h1>
        <p class="sub">${isLogin ? "เข้าสู่ระบบเพื่อดูรายการบิลของคุณ" : "สมัครสมาชิกใหม่"}</p>
        ${state.authError ? `<div class="error-msg">${escapeHtml(state.authError)}</div>` : ""}
        <form id="auth-form">
          <div class="field">
            <label>อีเมล</label>
            <input type="email" name="email" required autocomplete="email" />
          </div>
          <div class="field">
            <label>รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label>
            <input type="password" name="password" required minlength="8" autocomplete="${isLogin ? "current-password" : "new-password"}" />
          </div>
          <button class="btn btn-primary" type="submit" ${state.busy ? "disabled" : ""}>
            ${isLogin ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
          </button>
        </form>
        <div class="auth-switch">
          ${isLogin ? "ยังไม่มีบัญชี?" : "มีบัญชีอยู่แล้ว?"}
          <button id="switch-mode">${isLogin ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}</button>
        </div>
      </div>
      <p class="auth-footer">พัฒนาด้วย JavaScript (Hono) · ทำงานบน Cloudflare Workers + D1</p>
    </div>
  `;
  document.getElementById("auth-form").addEventListener("submit", handleAuthSubmit);
  document.getElementById("switch-mode").addEventListener("click", () => {
    state.authMode = isLogin ? "register" : "login";
    state.authError = null;
    render();
  });
}

// ---------- Render: Dashboard ----------

function summarize(bills) {
  const unpaidActive = bills.filter((b) => !(b.recurrence === "once" && b.is_paid));
  const overdue = unpaidActive.filter((b) => daysUntil(b.next_due_date) < 0).length;
  const soon = unpaidActive.filter((b) => {
    const d = daysUntil(b.next_due_date);
    return d >= 0 && d <= 5;
  }).length;
  const totalDue = unpaidActive.reduce((sum, b) => {
    const amt = b.payment_option === "full" ? b.full_amount : b.payment_option === "min" ? b.min_amount : b.payment_option === "custom" ? b.custom_amount : b.full_amount;
    return sum + Number(amt || 0);
  }, 0);
  return { overdue, soon, totalDue, count: unpaidActive.length };
}

function billCardHtml(bill) {
  const status = billStatus(bill);
  const isDone = bill.recurrence === "once" && bill.is_paid;
  const option = bill.payment_option;
  const isExpanded = state.expanded.has(bill.id);
  return `
    <div class="bill-card status-${status.key} ${isDone ? "paid" : ""} ${isExpanded ? "expanded" : "compact"}" data-bill-id="${bill.id}">
      <div class="bill-top" data-action="toggle-expand">
        <div>
          <div class="bill-name">${escapeHtml(bill.name)}</div>
          <div class="bill-due">ครบกำหนด ${fmtDate(bill.next_due_date)} · ${bill.recurrence === "monthly" ? "รายเดือน" : "ครั้งเดียว"}${!isExpanded ? ` · ${fmtMoney(bill.full_amount)}` : ""}</div>
        </div>
        <div class="bill-top-right">
          <span class="badge badge-${status.key}">${status.label}</span>
          <span class="chevron">›</span>
        </div>
      </div>

      ${isExpanded ? `
      <div class="amounts">
        <div class="amount-block">
          <div class="label">ยอดเต็ม</div>
          <div class="value">${fmtMoney(bill.full_amount)}</div>
        </div>
        <div class="amount-block">
          <div class="label">ขั้นต่ำ</div>
          <div class="value">${fmtMoney(bill.min_amount)}</div>
        </div>
      </div>

      ${!isDone ? `
      <div class="option-row">
        <button class="option-pill ${option === "full" ? "active" : ""}" data-action="select-option" data-option="full">จ่ายเต็มจำนวน</button>
        <button class="option-pill ${option === "min" ? "active" : ""}" data-action="select-option" data-option="min">จ่ายขั้นต่ำ</button>
        <button class="option-pill ${option === "custom" ? "active" : ""}" data-action="select-option" data-option="custom">กำหนดเอง</button>
        ${option === "custom" || state.customEditing.has(bill.id) ? `
        <input class="custom-amount-input" type="number" min="0.01" step="0.01" placeholder="ระบุจำนวนเงิน" data-role="custom-amount" value="${bill.custom_amount ?? ""}" />
        <button class="btn btn-primary btn-sm" data-action="confirm-custom">ยืนยัน</button>
        ` : ""}
      </div>
      ` : ""}

      <div class="bill-actions">
        <div class="left">
          ${!isDone ? `<button class="btn btn-primary btn-sm" data-action="pay">ทำเครื่องหมายว่าจ่ายแล้ว</button>` : ""}
          <button class="btn btn-outline btn-sm" data-action="undo">ยกเลิกการจ่ายล่าสุด</button>
          <button class="btn btn-ghost btn-sm" data-action="history">ประวัติ</button>
        </div>
        <div class="right">
          <button class="btn btn-ghost btn-sm" data-action="edit">แก้ไข</button>
          <button class="btn btn-danger btn-sm" data-action="delete">ลบ</button>
        </div>
      </div>
      ` : ""}
    </div>
  `;
}

function matchesFilter(bill, filter) {
  if (!filter) return true;
  const status = billStatus(bill).key;
  if (filter === "unpaid") return status !== "paid";
  return status === filter;
}

function matchesLoanFilter(loan, filter) {
  if (!filter) return true;
  if (filter === "lend") return loan.direction === "lend";
  if (filter === "borrow") return loan.direction === "borrow";
  if (filter === "overdue") return loanStatus(loan).key === "overdue";
  return true;
}

function loanCardHtml(loan) {
  const status = loanStatus(loan);
  const isExpanded = state.loanExpanded.has(loan.id);
  const directionLabel = loan.direction === "lend" ? "ให้ยืม" : "ยืมมา";
  return `
    <div class="bill-card loan-card status-${status.key} ${status.key === "returned" ? "paid" : ""} ${isExpanded ? "expanded" : "compact"}" data-loan-id="${loan.id}">
      <div class="bill-top" data-action="toggle-expand">
        <div>
          <div class="bill-name">
            <span class="direction-tag direction-${loan.direction}">${directionLabel}</span>
            ${escapeHtml(loan.person_name)}
          </div>
          <div class="bill-due">ยืมเมื่อ ${fmtDate(loan.borrowed_date)}${!isExpanded ? ` · ${fmtMoney(loan.amount)}` : ""}</div>
        </div>
        <div class="bill-top-right">
          <span class="badge badge-${status.key}">${status.label}</span>
          <span class="chevron">›</span>
        </div>
      </div>

      ${isExpanded ? `
      <div class="amounts">
        <div class="amount-block">
          <div class="label">จำนวนเงิน</div>
          <div class="value">${fmtMoney(loan.amount)}</div>
        </div>
        ${loan.due_date ? `
        <div class="amount-block">
          <div class="label">นัดคืน</div>
          <div class="value">${fmtDate(loan.due_date)}</div>
        </div>
        ` : ""}
      </div>
      ${loan.note ? `<p style="color:var(--text-muted); font-size:0.85rem; margin: 0 0 14px;">${escapeHtml(loan.note)}</p>` : ""}

      <div class="bill-actions">
        <div class="left">
          ${!loan.is_returned ? `<button class="btn btn-primary btn-sm" data-action="return">ทำเครื่องหมายว่าคืนแล้ว</button>` : `<button class="btn btn-outline btn-sm" data-action="undo-return">ยกเลิกการคืน</button>`}
        </div>
        <div class="right">
          <button class="btn btn-ghost btn-sm" data-action="edit">แก้ไข</button>
          <button class="btn btn-danger btn-sm" data-action="delete">ลบ</button>
        </div>
      </div>
      ` : ""}
    </div>
  `;
}

function topbarHtml() {
  return `
    <div class="topbar">
      <div class="topbar-left">
        <h1>ตัวจัดการบิลที่ต้องจ่าย</h1>
        <div class="tab-switch">
          <button class="tab-btn ${state.view === "bills" ? "active" : ""}" data-view="bills">บิล</button>
          <button class="tab-btn ${state.view === "loans" ? "active" : ""}" data-view="loans">ยืม/คืน</button>
        </div>
      </div>
      <div class="topbar-right">
        <span class="who">${escapeHtml(state.user.email)}</span>
        <button class="btn btn-ghost btn-sm" id="btn-history-all">ประวัติทั้งหมด</button>
        <button class="btn btn-outline btn-sm" id="btn-logout">ออกจากระบบ</button>
      </div>
    </div>
  `;
}

function bindTopbarHandlers() {
  document.getElementById("btn-logout").addEventListener("click", handleLogout);
  document.getElementById("btn-history-all").addEventListener("click", openAllHistory);
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function renderDashboard() {
  const summary = summarize(state.bills);
  const sorted = [...state.bills].sort((a, b) => {
    const aDone = a.recurrence === "once" && a.is_paid;
    const bDone = b.recurrence === "once" && b.is_paid;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return a.next_due_date.localeCompare(b.next_due_date);
  });
  const filtered = sorted.filter((b) => matchesFilter(b, state.filter));
  const filterLabel = { unpaid: "รายการค้างจ่าย", overdue: "เลยกำหนดแล้ว", soon: "ใกล้ครบกำหนด" }[state.filter];

  app.innerHTML = `
    ${topbarHtml()}
    <div class="container">
      <div class="summary-row">
        <div class="summary-card accent-neutral filterable ${state.filter === "unpaid" ? "active" : ""}" data-filter="unpaid">
          <div class="label">รายการค้างจ่าย</div>
          <div class="value">${summary.count}</div>
        </div>
        <div class="summary-card accent-danger filterable ${state.filter === "overdue" ? "active" : ""}" data-filter="overdue">
          <div class="label">เลยกำหนดแล้ว</div>
          <div class="value" style="color:var(--danger)">${summary.overdue}</div>
        </div>
        <div class="summary-card accent-warn filterable ${state.filter === "soon" ? "active" : ""}" data-filter="soon">
          <div class="label">ใกล้ครบกำหนด (≤5 วัน)</div>
          <div class="value" style="color:var(--warn)">${summary.soon}</div>
        </div>
        <div class="summary-card accent-primary">
          <div class="label">ยอดรวมที่ต้องจ่าย (ตามที่เลือก)</div>
          <div class="value">${fmtMoney(summary.totalDue)}</div>
        </div>
      </div>

      <div class="section-head">
        <h2>รายการบิล${filterLabel ? ` · ${filterLabel}` : ""}</h2>
        <div style="display:flex; gap:8px;">
          ${state.filter ? `<button class="btn btn-ghost btn-sm" id="btn-clear-filter">ล้างตัวกรอง</button>` : ""}
          <button class="btn btn-primary btn-sm" id="btn-add-bill">+ เพิ่มบิล</button>
        </div>
      </div>

      <div class="bill-list">
        ${filtered.length ? filtered.map(billCardHtml).join("") : sorted.length ? `
        <div class="empty-state">
          <div class="empty-icon">฿</div>
          <h3>ไม่มีรายการที่ตรงกับตัวกรองนี้</h3>
          <p>ลองเลือกตัวกรองอื่น หรือล้างตัวกรองเพื่อดูรายการทั้งหมด</p>
          <button class="btn btn-primary" id="btn-clear-filter-empty">ล้างตัวกรอง</button>
        </div>
        ` : `
        <div class="empty-state">
          <div class="empty-icon">฿</div>
          <h3>ยังไม่มีรายการบิล</h3>
          <p>เริ่มติดตามบิลที่ต้องจ่าย เพื่อไม่พลาดวันครบกำหนดอีกต่อไป</p>
          <button class="btn btn-primary" id="btn-add-bill-empty">+ เพิ่มบิลแรกของคุณ</button>
        </div>
        `}
      </div>
    </div>
    ${state.formModal ? formModalHtml() : ""}
    ${state.historyModal ? historyModalHtml() : ""}
    ${state.allHistory ? allHistoryModalHtml() : ""}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindTopbarHandlers();
  document.getElementById("btn-add-bill").addEventListener("click", () => {
    state.formModal = { mode: "create" };
    render();
  });
  const btnAddBillEmpty = document.getElementById("btn-add-bill-empty");
  if (btnAddBillEmpty) {
    btnAddBillEmpty.addEventListener("click", () => {
      state.formModal = { mode: "create" };
      render();
    });
  }

  document.querySelectorAll(".summary-card.filterable").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.filter;
      state.filter = state.filter === key ? null : key;
      render();
    });
  });
  const btnClearFilter = document.getElementById("btn-clear-filter");
  if (btnClearFilter) btnClearFilter.addEventListener("click", () => { state.filter = null; render(); });
  const btnClearFilterEmpty = document.getElementById("btn-clear-filter-empty");
  if (btnClearFilterEmpty) btnClearFilterEmpty.addEventListener("click", () => { state.filter = null; render(); });

  document.querySelectorAll(".bill-card").forEach((card) => {
    const billId = card.dataset.billId;
    const bill = state.bills.find((b) => b.id === billId);

    card.querySelector('[data-action="toggle-expand"]').addEventListener("click", () => {
      if (state.expanded.has(billId)) state.expanded.delete(billId);
      else state.expanded.add(billId);
      render();
    });

    card.querySelectorAll('[data-action="select-option"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const option = btn.dataset.option;
        if (option === "custom") {
          state.customEditing.add(billId);
          render();
          const el = document.querySelector(`.bill-card[data-bill-id="${billId}"] [data-role="custom-amount"]`);
          if (el) el.focus();
        } else {
          state.customEditing.delete(billId);
          selectPaymentOption(billId, option);
        }
      });
    });

    const submitCustomAmount = () => {
      const input = card.querySelector('[data-role="custom-amount"]');
      const val = input ? parseFloat(input.value) : NaN;
      if (Number.isNaN(val) || val <= 0) {
        showError("กรุณาระบุจำนวนเงินที่มากกว่า 0");
        return;
      }
      state.customEditing.delete(billId);
      selectPaymentOption(billId, "custom", val);
    };

    const confirmCustomBtn = card.querySelector('[data-action="confirm-custom"]');
    if (confirmCustomBtn) confirmCustomBtn.addEventListener("click", submitCustomAmount);

    const customInput = card.querySelector('[data-role="custom-amount"]');
    if (customInput) {
      customInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCustomAmount();
        }
      });
    }

    const payBtn = card.querySelector('[data-action="pay"]');
    if (payBtn) payBtn.addEventListener("click", () => markPaid(billId));

    const undoBtn = card.querySelector('[data-action="undo"]');
    if (undoBtn) undoBtn.addEventListener("click", () => undoPaid(billId));

    const historyBtn = card.querySelector('[data-action="history"]');
    if (historyBtn) historyBtn.addEventListener("click", () => openHistory(bill));

    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => {
      state.formModal = { mode: "edit", bill };
      render();
    });

    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteBill(billId));
  });

  bindModalCloseHandlers();
}

function summarizeLoans(loans) {
  const outstanding = loans.filter((l) => !l.is_returned);
  const lendTotal = outstanding
    .filter((l) => l.direction === "lend")
    .reduce((sum, l) => sum + Number(l.amount || 0), 0);
  const borrowTotal = outstanding
    .filter((l) => l.direction === "borrow")
    .reduce((sum, l) => sum + Number(l.amount || 0), 0);
  const overdue = outstanding.filter((l) => loanStatus(l).key === "overdue").length;
  return { lendTotal, borrowTotal, overdue, count: outstanding.length };
}

function renderLoansView() {
  const summary = summarizeLoans(state.loans);
  const sorted = [...state.loans].sort((a, b) => {
    if (a.is_returned !== b.is_returned) return a.is_returned ? 1 : -1;
    const ad = a.due_date || "9999-99-99";
    const bd = b.due_date || "9999-99-99";
    return ad.localeCompare(bd);
  });
  const filtered = sorted.filter((l) => matchesLoanFilter(l, state.loanFilter));
  const filterLabel = { lend: "ให้ยืม", borrow: "ยืมมา", overdue: "เลยกำหนดคืน" }[state.loanFilter];

  app.innerHTML = `
    ${topbarHtml()}
    <div class="container">
      <div class="summary-row">
        <div class="summary-card accent-ok filterable ${state.loanFilter === "lend" ? "active" : ""}" data-loan-filter="lend">
          <div class="label">ให้คนอื่นยืม (ค้างคืน)</div>
          <div class="value" style="color:var(--ok)">${fmtMoney(summary.lendTotal)}</div>
        </div>
        <div class="summary-card accent-danger filterable ${state.loanFilter === "borrow" ? "active" : ""}" data-loan-filter="borrow">
          <div class="label">ยืมคนอื่น (ค้างคืน)</div>
          <div class="value" style="color:var(--danger)">${fmtMoney(summary.borrowTotal)}</div>
        </div>
        <div class="summary-card accent-warn filterable ${state.loanFilter === "overdue" ? "active" : ""}" data-loan-filter="overdue">
          <div class="label">เลยกำหนดคืนแล้ว</div>
          <div class="value" style="color:var(--warn)">${summary.overdue}</div>
        </div>
      </div>

      <div class="section-head">
        <h2>รายการยืม/คืน${filterLabel ? ` · ${filterLabel}` : ""}</h2>
        <div style="display:flex; gap:8px;">
          ${state.loanFilter ? `<button class="btn btn-ghost btn-sm" id="btn-clear-loan-filter">ล้างตัวกรอง</button>` : ""}
          <button class="btn btn-primary btn-sm" id="btn-add-loan">+ เพิ่มรายการ</button>
        </div>
      </div>

      <div class="bill-list">
        ${filtered.length ? filtered.map(loanCardHtml).join("") : sorted.length ? `
        <div class="empty-state">
          <div class="empty-icon">฿</div>
          <h3>ไม่มีรายการที่ตรงกับตัวกรองนี้</h3>
          <p>ลองเลือกตัวกรองอื่น หรือล้างตัวกรองเพื่อดูรายการทั้งหมด</p>
          <button class="btn btn-primary" id="btn-clear-loan-filter-empty">ล้างตัวกรอง</button>
        </div>
        ` : `
        <div class="empty-state">
          <div class="empty-icon">฿</div>
          <h3>ยังไม่มีรายการยืม/คืน</h3>
          <p>บันทึกเงินที่ให้คนอื่นยืม หรือเงินที่คุณยืมคนอื่นมา จะได้ไม่ลืมทวงหรือลืมคืน</p>
          <button class="btn btn-primary" id="btn-add-loan-empty">+ เพิ่มรายการแรก</button>
        </div>
        `}
      </div>
    </div>
    ${state.loanFormModal ? loanFormModalHtml() : ""}
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;

  bindTopbarHandlers();
  document.getElementById("btn-add-loan").addEventListener("click", () => {
    state.loanFormModal = { mode: "create" };
    render();
  });
  const btnAddLoanEmpty = document.getElementById("btn-add-loan-empty");
  if (btnAddLoanEmpty) {
    btnAddLoanEmpty.addEventListener("click", () => {
      state.loanFormModal = { mode: "create" };
      render();
    });
  }

  document.querySelectorAll(".summary-card.filterable[data-loan-filter]").forEach((card) => {
    card.addEventListener("click", () => {
      const key = card.dataset.loanFilter;
      state.loanFilter = state.loanFilter === key ? null : key;
      render();
    });
  });
  const btnClearLoanFilter = document.getElementById("btn-clear-loan-filter");
  if (btnClearLoanFilter) btnClearLoanFilter.addEventListener("click", () => { state.loanFilter = null; render(); });
  const btnClearLoanFilterEmpty = document.getElementById("btn-clear-loan-filter-empty");
  if (btnClearLoanFilterEmpty) btnClearLoanFilterEmpty.addEventListener("click", () => { state.loanFilter = null; render(); });

  document.querySelectorAll(".loan-card").forEach((card) => {
    const loanId = card.dataset.loanId;
    const loan = state.loans.find((l) => l.id === loanId);

    card.querySelector('[data-action="toggle-expand"]').addEventListener("click", () => {
      if (state.loanExpanded.has(loanId)) state.loanExpanded.delete(loanId);
      else state.loanExpanded.add(loanId);
      render();
    });

    const returnBtn = card.querySelector('[data-action="return"]');
    if (returnBtn) returnBtn.addEventListener("click", () => markReturned(loanId));

    const undoReturnBtn = card.querySelector('[data-action="undo-return"]');
    if (undoReturnBtn) undoReturnBtn.addEventListener("click", () => undoReturn(loanId));

    const editBtn = card.querySelector('[data-action="edit"]');
    if (editBtn) editBtn.addEventListener("click", () => {
      state.loanFormModal = { mode: "edit", loan };
      render();
    });

    const deleteBtn = card.querySelector('[data-action="delete"]');
    if (deleteBtn) deleteBtn.addEventListener("click", () => deleteLoan(loanId));
  });

  bindModalCloseHandlers();
}

// ---------- Modals ----------

function formModalHtml() {
  const { mode, bill } = state.formModal;
  const isEdit = mode === "edit";
  return `
    <div class="modal-backdrop" data-close="form">
      <div class="modal" data-stop>
        <h2>${isEdit ? "แก้ไขบิล" : "เพิ่มบิลใหม่"}</h2>
        <form id="bill-form">
          <div class="field">
            <label>ชื่อบิล</label>
            <input name="name" required value="${isEdit ? escapeHtml(bill.name) : ""}" placeholder="เช่น บัตรเครดิต KBank" />
          </div>
          <div class="field">
            <label>ยอดเต็ม (บาท)</label>
            <input name="full_amount" type="number" min="0" step="0.01" required value="${isEdit ? bill.full_amount : ""}" />
          </div>
          <div class="field">
            <label>ยอดขั้นต่ำ (บาท)</label>
            <input name="min_amount" type="number" min="0" step="0.01" required value="${isEdit ? bill.min_amount : ""}" />
          </div>
          <div class="field">
            <label>วันครบกำหนดชำระ (รอบปัจจุบัน)</label>
            <input name="next_due_date" type="date" required value="${isEdit ? bill.next_due_date : todayStr()}" />
          </div>
          <div class="field">
            <label>ความถี่</label>
            <select name="recurrence">
              <option value="monthly" ${!isEdit || bill.recurrence === "monthly" ? "selected" : ""}>รายเดือน (เลื่อนวันครบกำหนดอัตโนมัติหลังจ่าย)</option>
              <option value="once" ${isEdit && bill.recurrence === "once" ? "selected" : ""}>ครั้งเดียว</option>
            </select>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close="form">ยกเลิก</button>
            <button type="submit" class="btn btn-primary">${isEdit ? "บันทึก" : "เพิ่มบิล"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function loanFormModalHtml() {
  const { mode, loan } = state.loanFormModal;
  const isEdit = mode === "edit";
  return `
    <div class="modal-backdrop" data-close="loanForm">
      <div class="modal" data-stop>
        <h2>${isEdit ? "แก้ไขรายการยืม/คืน" : "เพิ่มรายการยืม/คืน"}</h2>
        <form id="loan-form">
          <div class="field">
            <label>ทิศทาง</label>
            <div class="radio-row">
              <label><input type="radio" name="direction" value="lend" ${!isEdit || loan.direction === "lend" ? "checked" : ""} /> ให้คนอื่นยืม</label>
              <label><input type="radio" name="direction" value="borrow" ${isEdit && loan.direction === "borrow" ? "checked" : ""} /> ยืมคนอื่นมา</label>
            </div>
          </div>
          <div class="field">
            <label>ชื่อคน</label>
            <input name="person_name" required value="${isEdit ? escapeHtml(loan.person_name) : ""}" placeholder="เช่น เพื่อนต้น" />
          </div>
          <div class="field">
            <label>จำนวนเงิน (บาท)</label>
            <input name="amount" type="number" min="0.01" step="0.01" required value="${isEdit ? loan.amount : ""}" />
          </div>
          <div class="field">
            <label>วันที่ยืม</label>
            <input name="borrowed_date" type="date" required value="${isEdit ? loan.borrowed_date : todayStr()}" />
          </div>
          <div class="field">
            <label>นัดคืนวันที่ (ถ้ามี)</label>
            <input name="due_date" type="date" value="${isEdit && loan.due_date ? loan.due_date : ""}" />
          </div>
          <div class="field">
            <label>โน้ต (ถ้ามี)</label>
            <input name="note" value="${isEdit && loan.note ? escapeHtml(loan.note) : ""}" placeholder="เช่น ยืมค่าไปกินข้าว" />
          </div>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-close="loanForm">ยกเลิก</button>
            <button type="submit" class="btn btn-primary">${isEdit ? "บันทึก" : "เพิ่มรายการ"}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function historyModalHtml() {
  const { billName, items } = state.historyModal;
  return `
    <div class="modal-backdrop" data-close="history">
      <div class="modal" data-stop>
        <h2>ประวัติการจ่าย · ${escapeHtml(billName)}</h2>
        <div class="history-list">
          ${items.length ? items.map(historyItemHtml).join("") : `<div class="empty-state">ยังไม่มีประวัติการจ่าย</div>`}
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" data-close="history">ปิด</button>
        </div>
      </div>
    </div>
  `;
}

function allHistoryModalHtml() {
  const items = state.allHistory;
  return `
    <div class="modal-backdrop" data-close="allHistory">
      <div class="modal" data-stop>
        <h2>ประวัติการจ่ายทั้งหมด</h2>
        <div class="history-list">
          ${items.length ? items.map((h) => historyItemHtml(h, true)).join("") : `<div class="empty-state">ยังไม่มีประวัติการจ่าย</div>`}
        </div>
        <div class="modal-actions">
          <button class="btn btn-outline" data-close="allHistory">ปิด</button>
        </div>
      </div>
    </div>
  `;
}

function historyItemHtml(h, showName = false) {
  const optionLabel = { full: "จ่ายเต็มจำนวน", min: "จ่ายขั้นต่ำ", custom: "จ่ายกำหนดเอง" }[h.payment_option] || h.payment_option;
  return `
    <div class="history-item">
      <div>
        <div>${showName ? `<strong>${escapeHtml(h.bill_name)}</strong> · ` : ""}${optionLabel}</div>
        <div class="hi-date">ครบกำหนด ${fmtDate(h.due_date)}</div>
      </div>
      <div style="text-align:right">
        <div><strong>${fmtMoney(h.amount_paid)}</strong></div>
        <div class="hi-date">จ่ายเมื่อ ${new Date(h.paid_at.replace(" ", "T") + "Z").toLocaleString("th-TH")}</div>
      </div>
    </div>
  `;
}

function bindModalCloseHandlers() {
  document.querySelectorAll("[data-close]").forEach((el) => {
    el.addEventListener("click", (e) => {
      // สำหรับ backdrop element ให้ปิดเฉพาะตอนคลิกที่ตัว backdrop เอง ไม่ใช่คลิกใน .modal ที่ซ้อนอยู่ข้างใน
      if (e.target !== el) return;
      const key = el.dataset.close;
      if (key === "form") state.formModal = null;
      if (key === "loanForm") state.loanFormModal = null;
      if (key === "history") state.historyModal = null;
      if (key === "allHistory") state.allHistory = null;
      render();
    });
  });
  const form = document.getElementById("bill-form");
  if (form) form.addEventListener("submit", handleFormSubmit);
  const loanForm = document.getElementById("loan-form");
  if (loanForm) loanForm.addEventListener("submit", handleLoanFormSubmit);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Root render ----------

function render() {
  if (!state.user) {
    renderAuth();
  } else if (state.view === "loans") {
    renderLoansView();
  } else {
    renderDashboard();
  }
}

init();
