# ตัวจัดการบิลที่ต้องจ่าย (Paytrack)

เว็บแอปสำหรับติดตามรายการบิลที่ต้องจ่าย: กำหนดวันครบชำระ ยอดเต็ม ยอดขั้นต่ำ เลือกวิธีจ่าย (เต็ม/ขั้นต่ำ/กำหนดเอง) และสถานะจ่ายแล้วหรือยัง พร้อมประวัติการจ่ายย้อนหลัง

**สแตค:** Cloudflare Workers + Static Assets + D1 (SQLite) + [Hono](https://hono.dev) สำหรับ API + ล็อกอินแบบ email/password (session cookie, รหัสผ่านถูก hash ด้วย PBKDF2 ไม่มีการเก็บ plaintext)

เครื่องนี้ยังไม่ได้ติดตั้ง Node.js/npm ดังนั้นขั้นตอนด้านล่างเน้นการ deploy ผ่าน **GitHub + Cloudflare dashboard** ซึ่งไม่ต้องใช้ Node ในเครื่องเลย (Cloudflare จะ build ให้บนคลาวด์)

## โครงสร้างโปรเจกต์

```
paytrack/
├── public/              # ไฟล์หน้าเว็บ (static, serve ผ่าน [assets])
│   ├── index.html
│   ├── style.css
│   └── app.js
├── src/
│   ├── index.js          # Worker entry — API ทั้งหมด (Hono, ที่ /api/*)
│   └── lib/auth.js        # ฟังก์ชัน hash รหัสผ่าน + session
├── schema.sql            # สคีมาฐานข้อมูล D1
├── wrangler.toml          # ค่าคอนฟิกสำหรับ wrangler CLI (main + [assets] + D1 binding)
└── package.json
```

## ขั้นตอนที่ 1 — Push ขึ้น GitHub

```bash
cd ~/Projects/paytrack
git add -A
git commit -m "Initial bill tracker app"
```

จากนั้นสร้าง repo ใหม่บน GitHub (ผ่านเว็บ github.com หรือ `gh repo create`) แล้ว push:

```bash
git remote add origin https://github.com/<your-username>/paytrack.git
git branch -M main
git push -u origin main
```

## ขั้นตอนที่ 2 — สร้าง D1 database (ผ่าน dash.cloudflare.com)

1. เข้า **dash.cloudflare.com** → เลือกบัญชี → เมนูซ้าย **Storage & Databases → D1 SQL Database**
2. กด **Create database** ตั้งชื่อ เช่น `paytrack-db`
3. เข้าไปที่ database ที่สร้าง → แท็บ **Console**
4. คัดลอกเนื้อหาทั้งหมดจากไฟล์ `schema.sql` ในโปรเจกต์นี้ วางแล้วกด **Execute** เพื่อสร้างตาราง (`users`, `sessions`, `bills`, `payment_history`)
5. จดค่า **Database ID** ไว้ (จะใช้ตอนผูก binding ในขั้นตอนที่ 4)

## ขั้นตอนที่ 3 — สร้าง Workers project จาก GitHub repo

1. ใน dash.cloudflare.com → **Compute (Workers) → Workers & Pages → Create → Import a repository** (หรือ **Connect to Git** ใต้ Workers ไม่ใช่ Pages)
2. เลือก repo `paytrack` ที่ push ไปแล้ว
3. Cloudflare จะอ่านค่าจาก `wrangler.toml` เอง (`main = "src/index.js"`, `[assets] directory = "public"`) ไม่ต้องตั้ง build command เพิ่ม — deploy command เริ่มต้นคือ `npx wrangler deploy`
4. กด **Save and Deploy**

> ถ้าโปรเจกต์นี้เคย deploy fail ด้วย error `Missing entry-point to Worker script or to assets directory` แปลว่าตอนสร้างยังไม่มี `main`/`[assets]` ใน `wrangler.toml` — แก้แล้ว push ใหม่ แล้วกด **Retry deployment** ได้เลย

## ขั้นตอนที่ 4 — ผูก D1 database เข้ากับ Workers project

1. ไปที่ Workers project ที่เพิ่งสร้าง → แท็บ **Settings → Bindings**
2. กด **Add → D1 database**
   - **Variable name:** `DB` (ต้องตรงกับที่โค้ดใช้ `c.env.DB` เป๊ะๆ)
   - **D1 database:** เลือก `paytrack-db`
3. กด **Save** แล้ว **Retry deployment** ล่าสุดอีกครั้ง (การเพิ่ม binding จะมีผลกับ deployment ใหม่เท่านั้น)

หลังจากนี้เว็บของคุณจะพร้อมใช้งานที่โดเมน `*.workers.dev` ที่ Cloudflare ให้มา (หรือผูกโดเมนของคุณเองได้ในแท็บ Domains & Routes)

## การใช้งาน

1. เปิดเว็บ → สมัครสมาชิกด้วยอีเมล/รหัสผ่าน (อย่างน้อย 8 ตัวอักษร)
2. กด **+ เพิ่มบิล** กรอกชื่อ ยอดเต็ม ยอดขั้นต่ำ วันครบกำหนด และความถี่ (รายเดือน/ครั้งเดียว)
3. ในแต่ละการ์ดบิล เลือกวิธีจ่าย (เต็มจำนวน/ขั้นต่ำ/กำหนดเอง) แล้วกด **ทำเครื่องหมายว่าจ่ายแล้ว**
   - บิลรายเดือนจะเลื่อนไปวันครบกำหนดรอบถัดไปให้อัตโนมัติ และรีเซ็ตสถานะเป็นยังไม่จ่าย
   - กดผิดสามารถกด **ยกเลิกการจ่ายล่าสุด** เพื่อย้อนกลับได้
4. ดูประวัติการจ่ายย้อนหลังได้ทั้งรายบิล (ปุ่ม "ประวัติ" ในการ์ด) และภาพรวมทั้งหมด (ปุ่ม "ประวัติทั้งหมด" มุมบนขวา)

## พัฒนาในเครื่อง (ถ้าติดตั้ง Node.js ในอนาคต)

```bash
npm install
npx wrangler d1 execute paytrack-db --local --file=./schema.sql
npm run dev
```

จากนั้นแก้ `database_id` ใน `wrangler.toml` ให้ตรงกับ D1 database ID จริงของคุณ ก่อน deploy ผ่าน CLI ด้วย `npm run deploy`
