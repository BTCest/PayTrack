import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession } from "./lib/auth.js";

const COOKIE_NAME = "session";
const PAYMENT_OPTIONS = ["full", "min", "custom"];

const app = new Hono().basePath("/api");

function setSessionCookie(c, session) {
  setCookie(c, COOKIE_NAME, session.id, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(session.expiresAt),
  });
}

async function currentUser(c) {
  const sessionId = getCookie(c, COOKIE_NAME);
  return getSessionUser(c.env.DB, sessionId);
}

function addOneMonth(dateStr, dueDay) {
  const d = new Date(dateStr + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const targetMonth0 = d.getUTCMonth() + 1; // 0-based index ของเดือนถัดไป (ล้นปีได้อัตโนมัติ)
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth0 + 1, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDayOfTarget);
  return new Date(Date.UTC(year, targetMonth0, day)).toISOString().slice(0, 10);
}

function amountForOption(bill) {
  if (bill.payment_option === "full") return bill.full_amount;
  if (bill.payment_option === "min") return bill.min_amount;
  if (bill.payment_option === "custom") return bill.custom_amount;
  return null;
}

// ---------- Auth ----------

app.post("/auth/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password || password.length < 8) {
    return c.json({ error: "กรอกอีเมลและรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)" }, 400);
  }
  const existing = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existing) return c.json({ error: "อีเมลนี้ถูกใช้ไปแล้ว" }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();
  await c.env.DB.prepare("INSERT INTO users (id, email, password_hash, salt) VALUES (?, ?, ?, ?)")
    .bind(id, email, hash, salt)
    .run();

  const session = await createSession(c.env.DB, id);
  setSessionCookie(c, session);
  return c.json({ user: { id, email } });
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const user = await c.env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user || !(await verifyPassword(password, user.password_hash, user.salt))) {
    return c.json({ error: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" }, 401);
  }
  const session = await createSession(c.env.DB, user.id);
  setSessionCookie(c, session);
  return c.json({ user: { id: user.id, email: user.email } });
});

app.post("/auth/logout", async (c) => {
  const sessionId = getCookie(c, COOKIE_NAME);
  if (sessionId) await deleteSession(c.env.DB, sessionId);
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const user = await currentUser(c);
  return c.json({ user });
});

// ---------- Auth guard สำหรับทุก endpoint ของ bills/history ----------

app.use("/bills/*", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

app.use("/history", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

app.use("/loans/*", async (c, next) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
});

// ---------- Bills ----------

app.get("/bills", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM bills WHERE user_id = ? ORDER BY next_due_date ASC"
  )
    .bind(user.id)
    .all();
  return c.json({ bills: results });
});

app.post("/bills", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const { name, full_amount, min_amount, next_due_date } = body;
  const recurrence = body.recurrence === "once" ? "once" : "monthly";

  if (!name || typeof full_amount !== "number" || typeof min_amount !== "number" || !next_due_date) {
    return c.json({ error: "กรอกข้อมูลให้ครบ: ชื่อ, ยอดเต็ม, ยอดขั้นต่ำ, วันครบกำหนด" }, 400);
  }
  if (full_amount < 0 || min_amount < 0 || min_amount > full_amount) {
    return c.json({ error: "ยอดขั้นต่ำต้องไม่ติดลบ และไม่เกินยอดเต็ม" }, 400);
  }

  const dueDay = new Date(next_due_date + "T00:00:00Z").getUTCDate();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO bills (id, user_id, name, full_amount, min_amount, due_day, recurrence, next_due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, name, full_amount, min_amount, dueDay, recurrence, next_due_date)
    .run();

  const bill = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first();
  return c.json({ bill }, 201);
});

app.put("/bills/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body.name ?? existing.name;
  const full_amount = typeof body.full_amount === "number" ? body.full_amount : existing.full_amount;
  const min_amount = typeof body.min_amount === "number" ? body.min_amount : existing.min_amount;
  const next_due_date = body.next_due_date ?? existing.next_due_date;
  const recurrence = body.recurrence === "once" || body.recurrence === "monthly" ? body.recurrence : existing.recurrence;

  if (full_amount < 0 || min_amount < 0 || min_amount > full_amount) {
    return c.json({ error: "ยอดขั้นต่ำต้องไม่ติดลบ และไม่เกินยอดเต็ม" }, 400);
  }

  const dueDay = new Date(next_due_date + "T00:00:00Z").getUTCDate();
  await c.env.DB.prepare(
    `UPDATE bills SET name=?, full_amount=?, min_amount=?, next_due_date=?, due_day=?, recurrence=?, updated_at=datetime('now')
     WHERE id=?`
  )
    .bind(name, full_amount, min_amount, next_due_date, dueDay, recurrence, id)
    .run();

  const bill = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first();
  return c.json({ bill });
});

app.delete("/bills/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await c.env.DB.prepare("DELETE FROM payment_history WHERE bill_id = ? AND user_id = ?").bind(id, user.id).run();
  const result = await c.env.DB.prepare("DELETE FROM bills WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  if (!result.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// เลือก/แก้ไขวิธีจ่ายของรอบปัจจุบัน โดยยังไม่ทำเครื่องหมายว่าจ่ายแล้ว
app.patch("/bills/:id/select", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const { payment_option, custom_amount } = body;

  if (!PAYMENT_OPTIONS.includes(payment_option)) {
    return c.json({ error: "payment_option ต้องเป็น full, min หรือ custom" }, 400);
  }
  if (payment_option === "custom" && !(typeof custom_amount === "number" && custom_amount > 0)) {
    return c.json({ error: "ระบุจำนวนเงินที่ต้องการจ่าย" }, 400);
  }

  const existing = await c.env.DB.prepare("SELECT id FROM bills WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE bills SET payment_option=?, custom_amount=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(payment_option, payment_option === "custom" ? custom_amount : null, id)
    .run();

  const bill = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first();
  return c.json({ bill });
});

// ทำเครื่องหมายว่าจ่ายแล้วตามวิธีที่เลือกไว้ และเลื่อนรอบถัดไปให้อัตโนมัติ (ถ้าเป็นบิลรายเดือน)
app.post("/bills/:id/pay", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const bill = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!bill) return c.json({ error: "not found" }, 404);
  if (!bill.payment_option) {
    return c.json({ error: "กรุณาเลือกวิธีจ่ายก่อน (เต็มจำนวน/ขั้นต่ำ/กำหนดเอง)" }, 400);
  }

  const amount = amountForOption(bill);
  const historyId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO payment_history (id, bill_id, user_id, due_date, payment_option, amount_paid)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(historyId, bill.id, user.id, bill.next_due_date, bill.payment_option, amount)
    .run();

  if (bill.recurrence === "monthly") {
    const nextDate = addOneMonth(bill.next_due_date, bill.due_day);
    await c.env.DB.prepare(
      `UPDATE bills SET next_due_date=?, is_paid=0, payment_option=NULL, custom_amount=NULL, updated_at=datetime('now')
       WHERE id=?`
    )
      .bind(nextDate, bill.id)
      .run();
  } else {
    await c.env.DB.prepare(`UPDATE bills SET is_paid=1, updated_at=datetime('now') WHERE id=?`).bind(bill.id).run();
  }

  const updated = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first();
  return c.json({ bill: updated });
});

// ยกเลิกการจ่ายล่าสุด (แก้ไขกรณีกดผิด) — ย้อนกลับไปยังรอบก่อนหน้า
app.post("/bills/:id/undo", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const bill = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!bill) return c.json({ error: "not found" }, 404);

  const last = await c.env.DB.prepare(
    "SELECT * FROM payment_history WHERE bill_id = ? ORDER BY paid_at DESC LIMIT 1"
  )
    .bind(id)
    .first();
  if (!last) return c.json({ error: "ไม่มีประวัติการจ่ายให้ยกเลิก" }, 400);

  await c.env.DB.prepare("DELETE FROM payment_history WHERE id = ?").bind(last.id).run();
  await c.env.DB.prepare(
    `UPDATE bills SET next_due_date=?, is_paid=0, payment_option=?, custom_amount=?, updated_at=datetime('now')
     WHERE id=?`
  )
    .bind(
      last.due_date,
      last.payment_option,
      last.payment_option === "custom" ? last.amount_paid : null,
      id
    )
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM bills WHERE id = ?").bind(id).first();
  return c.json({ bill: updated });
});

app.get("/bills/:id/history", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const bill = await c.env.DB.prepare("SELECT id FROM bills WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!bill) return c.json({ error: "not found" }, 404);

  const { results } = await c.env.DB.prepare(
    "SELECT * FROM payment_history WHERE bill_id = ? ORDER BY due_date DESC"
  )
    .bind(id)
    .all();
  return c.json({ history: results });
});

// ---------- ยืม/คืน ----------

const LOAN_DIRECTIONS = ["lend", "borrow"];

app.get("/loans", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM loans WHERE user_id = ? ORDER BY is_returned ASC, (due_date IS NULL), due_date ASC, borrowed_date DESC"
  )
    .bind(user.id)
    .all();
  return c.json({ loans: results });
});

app.post("/loans", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const person_name = (body.person_name || "").trim();
  const direction = body.direction;
  const amount = body.amount;
  const note = (body.note || "").trim() || null;
  const borrowed_date = body.borrowed_date;
  const due_date = body.due_date || null;

  if (!person_name || !LOAN_DIRECTIONS.includes(direction) || typeof amount !== "number" || !borrowed_date) {
    return c.json({ error: "กรอกข้อมูลให้ครบ: ชื่อ, ทิศทาง, จำนวนเงิน, วันที่ยืม" }, 400);
  }
  if (amount <= 0) {
    return c.json({ error: "จำนวนเงินต้องมากกว่า 0" }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO loans (id, user_id, person_name, direction, amount, note, borrowed_date, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, user.id, person_name, direction, amount, note, borrowed_date, due_date)
    .run();

  const loan = await c.env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(id).first();
  return c.json({ loan }, 201);
});

app.put("/loans/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT * FROM loans WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const person_name = body.person_name !== undefined ? String(body.person_name).trim() : existing.person_name;
  const direction = LOAN_DIRECTIONS.includes(body.direction) ? body.direction : existing.direction;
  const amount = typeof body.amount === "number" ? body.amount : existing.amount;
  const note = body.note !== undefined ? (String(body.note).trim() || null) : existing.note;
  const borrowed_date = body.borrowed_date || existing.borrowed_date;
  const due_date = body.due_date !== undefined ? (body.due_date || null) : existing.due_date;

  if (!person_name || amount <= 0) {
    return c.json({ error: "กรอกข้อมูลให้ครบและจำนวนเงินต้องมากกว่า 0" }, 400);
  }

  await c.env.DB.prepare(
    `UPDATE loans SET person_name=?, direction=?, amount=?, note=?, borrowed_date=?, due_date=?, updated_at=datetime('now')
     WHERE id=?`
  )
    .bind(person_name, direction, amount, note, borrowed_date, due_date, id)
    .run();

  const loan = await c.env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(id).first();
  return c.json({ loan });
});

app.delete("/loans/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const result = await c.env.DB.prepare("DELETE FROM loans WHERE id = ? AND user_id = ?").bind(id, user.id).run();
  if (!result.meta.changes) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

app.post("/loans/:id/return", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM loans WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE loans SET is_returned=1, returned_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
  )
    .bind(id)
    .run();

  const loan = await c.env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(id).first();
  return c.json({ loan });
});

app.post("/loans/:id/undo-return", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare("SELECT id FROM loans WHERE id = ? AND user_id = ?")
    .bind(id, user.id)
    .first();
  if (!existing) return c.json({ error: "not found" }, 404);

  await c.env.DB.prepare(
    `UPDATE loans SET is_returned=0, returned_at=NULL, updated_at=datetime('now') WHERE id=?`
  )
    .bind(id)
    .run();

  const loan = await c.env.DB.prepare("SELECT * FROM loans WHERE id = ?").bind(id).first();
  return c.json({ loan });
});

// ---------- History (รวมทุกบิล) ----------

app.get("/history", async (c) => {
  const user = c.get("user");
  const { results } = await c.env.DB.prepare(
    `SELECT ph.*, b.name AS bill_name
     FROM payment_history ph
     JOIN bills b ON b.id = ph.bill_id
     WHERE ph.user_id = ?
     ORDER BY ph.paid_at DESC
     LIMIT 200`
  )
    .bind(user.id)
    .all();
  return c.json({ history: results });
});

app.notFound((c) => c.json({ error: "not found" }, 404));

export default app;
