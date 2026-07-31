-- สคีมาฐานข้อมูลสำหรับระบบติดตามรายการบิลที่ต้องจ่าย
-- รันไฟล์นี้ผ่าน D1 Console บน dash.cloudflare.com หรือคำสั่ง:
--   wrangler d1 execute bill-tracker-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- แต่ละแถวคือ "บิล" หนึ่งใบ พร้อมข้อมูลรอบการจ่ายปัจจุบันที่ยังไม่จบ (outstanding cycle)
CREATE TABLE IF NOT EXISTS bills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  full_amount REAL NOT NULL,
  min_amount REAL NOT NULL,
  due_day INTEGER NOT NULL,                 -- วันที่ของเดือน (1-31) ใช้คำนวณรอบถัดไป
  recurrence TEXT NOT NULL DEFAULT 'monthly', -- 'monthly' | 'once'
  next_due_date TEXT NOT NULL,               -- วันครบกำหนดของรอบปัจจุบัน (YYYY-MM-DD)
  payment_option TEXT,                       -- 'full' | 'min' | 'custom' (ที่เลือกไว้ล่วงหน้า ยังไม่จ่าย)
  custom_amount REAL,                        -- ใช้เมื่อ payment_option = 'custom'
  is_paid INTEGER NOT NULL DEFAULT 0,        -- รอบปัจจุบันจ่ายแล้วหรือยัง
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ประวัติการจ่ายแต่ละรอบ (append-only log)
CREATE TABLE IF NOT EXISTS payment_history (
  id TEXT PRIMARY KEY,
  bill_id TEXT NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  payment_option TEXT NOT NULL,              -- 'full' | 'min' | 'custom'
  amount_paid REAL NOT NULL,
  paid_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bills_user ON bills(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_history_bill ON payment_history(bill_id);
CREATE INDEX IF NOT EXISTS idx_history_user ON payment_history(user_id);
