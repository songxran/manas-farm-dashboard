# SUPABASE.md

แผนย้ายข้อมูลของมนัสฟาร์มจากการเก็บแบบ in-memory (array ใน `index.html`) และ `localStorage` (ใน `app.js`) ไปเป็นฐานข้อมูลจริงบน [Supabase](https://supabase.com) เอกสารนี้เป็น**แผน**สำหรับใช้เป็นข้อมูลอ้างอิงเมื่อจะเริ่มเชื่อมต่อจริง ยังไม่ได้แก้โค้ดใดๆ

## ค่าเชื่อมต่อโปรเจกต์

| ค่า | สำหรับใช้ | ค่า |
|---|---|---|
| Project URL | ใช้ในโค้ดฝั่ง client ได้ปกติ | `https://jwmtvhebqblchbdahzhe.supabase.co` |
| Publishable (anon) key | ใช้ในโค้ดฝั่ง client ได้ปกติ — ออกแบบมาให้ฝังในหน้าเว็บได้ ปลอดภัยตราบใดที่เปิด RLS (ดูหัวข้อด้านล่าง) | `sb_publishable_rgN7JnGE64k8V80E3ky-3g_XopWo8dK` |
| Database password / direct connection string | **ไม่เก็บในไฟล์นี้** — ดูเหตุผลด้านล่าง | — |

**เรื่อง password ที่ส่งมาในแชท:** ไม่ได้ใส่ไว้ในไฟล์นี้ เพราะ connection string แบบ `postgresql://postgres:[password]@db...` คือรหัสผ่านระดับ superuser ของฐานข้อมูลทั้งหมด (ต่างจาก anon key ที่ถูกออกแบบมาให้เปิดเผยได้) ถ้าเก็บไว้เป็น plaintext ในไฟล์โปรเจกต์ แล้ววันหนึ่งโฟลเดอร์นี้ถูก commit ขึ้น git, sync ขึ้น cloud, หรือส่งให้คนอื่นดู รหัสผ่านนี้จะรั่วไปด้วยทันที เก็บไว้ใน password manager แทน หรือถ้าจำเป็นต้องใช้ในโค้ด (เช่น สคริปต์ migration ฝั่ง server) ให้ใส่ผ่าน environment variable ที่ไม่ commit เข้า git (เช่นไฟล์ `.env` ที่อยู่ใน `.gitignore`)

**คำแนะนำ:** เนื่องจากรหัสผ่านนี้ถูกพิมพ์ลงในแชทไปแล้ว ควรพิจารณา reset รหัสผ่านใหม่ที่ Supabase dashboard → Project Settings → Database → Reset database password เพื่อความปลอดภัย เพราะแชทไม่ใช่ที่เก็บ secret ที่ปลอดภัย

## สถานะข้อมูลปัจจุบัน (ก่อนย้าย)

| ข้อมูล | เก็บอยู่ที่ | คงอยู่ข้ามการโหลดหน้าไหม |
|---|---|---|
| บ่อเลี้ยง + ผลผลิต (`PONDS`) | ตัวแปร JS ใน `index.html` (~บรรทัด 953) | ❌ หายเมื่อ reload |
| รายการค่าใช้จ่าย (`COST_ITEMS`) | ตัวแปร JS ใน `index.html` (~บรรทัด 992) | ❌ หายเมื่อ reload |
| แนวโน้มรายเดือน (`TREND`) | ตัวแปร JS คงที่ (mock) | ไม่เกี่ยวข้อง (ข้อมูลสมมติ) |
| บันทึกรายวัน | `localStorage` key `manasFarmDailyLogs` (ใน `app.js`) | ✅ อยู่ในเครื่อง/เบราว์เซอร์เดียวเท่านั้น |

เป้าหมายของการย้าย: ให้ข้อมูลทั้งหมดเก็บอยู่ที่เดียว (Supabase) เข้าถึงได้จากทุกอุปกรณ์ และไม่หายเมื่อ reload หรือเปลี่ยนเครื่อง

## ทำไมต้อง Supabase

- มี Postgres จริงให้ฟรี พร้อม REST/JS client ใช้ตรงจากฝั่ง browser ได้โดยไม่ต้องมี backend ของตัวเอง (เข้ากับสไตล์โปรเจกต์นี้ที่เป็น static file ไม่มี build step)
- มี Row Level Security (RLS) และ Auth ในตัว ซึ่งจำเป็น เพราะไฟล์นี้เป็น static HTML — คีย์ที่ฝังในหน้าเว็บจะถูกมองเห็นได้จากทุกคนที่เปิดไฟล์

## Schema ที่เสนอ

แมปมาจากโครงสร้างข้อมูลเดิมใน `index.html` ตรงๆ

```sql
-- บ่อเลี้ยง (รวมข้อมูลผลผลิตไว้ในเรคคอร์ดเดียวกัน เหมือนโครงสร้างเดิมใน PONDS)
create table ponds (
  id           bigint generated always as identity primary key,
  code         text not null unique,               -- เช่น 'บ่อ 1'
  status       text not null check (status in ('empty','growing','prep','harvested')),
  size         numeric,                             -- ไร่
  depth        numeric,                             -- เมตร
  species      text,
  release_date date,                                 -- วันที่ปล่อยลูกพันธุ์
  ph           numeric,
  do_level     numeric,                              -- 'do' เป็นคำสงวนใน SQL จึงใช้ do_level
  temp         numeric,
  salinity     numeric,
  yield_kg     numeric default 0,
  survival     numeric,                              -- %
  fcr          numeric,
  harvest_date date,
  grade        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- รายการค่าใช้จ่าย (แทน COST_ITEMS)
create table cost_items (
  id          bigint generated always as identity primary key,
  pond_id     bigint not null references ponds(id) on delete cascade,
  category    text not null check (category in ('seed','feed','utility','chem','labor')),
  description text,
  amount      numeric not null check (amount > 0),
  created_at  timestamptz not null default now()
);

-- บันทึกรายวัน (แทน localStorage manasFarmDailyLogs)
create table daily_logs (
  id         bigint generated always as identity primary key,
  pond_id    bigint references ponds(id) on delete set null,
  log_date   date not null,
  value      numeric not null,
  note       text,
  created_at timestamptz not null default now()
);

-- ค่าตั้งต้นของฟาร์ม (แทนค่าคงที่ SELL_PRICE และข้อมูลหน้า "ภาพรวม"/"ตั้งค่า")
create table farm_settings (
  id          int primary key default 1,
  farm_name   text not null default 'มนัสฟาร์ม',
  owner_name  text not null default 'คุณอัญมณี',
  address     text,
  sell_price  numeric not null default 180,          -- บาท/กก.
  constraint single_row check (id = 1)
);
```

หมายเหตุ:
- `TREND` (กราฟแนวโน้มรายเดือนในหน้ารายงาน) ไม่จำเป็นต้องมีตารางแยก — คำนวณจาก `cost_items` + `ponds` ด้วย SQL view หรือ query แบบ `group by date_trunc('month', ...)` ได้เมื่อมีข้อมูลจริงมากพอ ให้คงเป็น mock ไปก่อนจนกว่าจะมีข้อมูลอย่างน้อย 2-3 เดือน
- คอลัมน์ `status`/`category` ใช้ `check` constraint แทน enum type เพื่อแก้ไขค่าที่อนุญาตได้ง่ายโดยไม่ต้อง migrate type

## Row Level Security (สำคัญ — อย่าข้าม)

ไฟล์นี้เป็น static HTML ไม่มี backend ของตัวเอง ดังนั้น `anon key` ของ Supabase จะถูกฝังอยู่ในหน้าเว็บและมองเห็นได้จาก view-source ทุกคนที่เปิดไฟล์ (หรือ URL ที่ deploy) จะยิง request ตรงไปที่ Supabase ได้ทันที **ต้องเปิด RLS ทุกตารางก่อนใช้งานจริง**

ตัวเลือกตามระดับความปลอดภัยที่ต้องการ:

1. ~~ใช้ในเครื่องคนเดียว/ไม่ deploy ขึ้นเว็บสาธารณะ~~ — เปิด RLS + policy อนุญาต `anon` role อ่าน/เขียนได้ทั้งหมด (ไม่ได้เลือกใช้)
2. **จะ deploy ให้เข้าถึงได้จากอินเทอร์เน็ต — เลือกใช้ทางนี้** — สร้างบัญชีผู้ใช้ผ่าน Authentication → Users ใน Supabase dashboard แล้วเขียน policy ให้อ่าน/เขียนได้เฉพาะผู้ใช้ที่ login แล้วเท่านั้น (ทั้ง select/insert/update/delete)

สถานะปัจจุบัน: รันตาราง (`schema.sql`) และ policy ชุดนี้แล้วในโปรเจกต์จริง — ดู `policies.sql` ที่ scratchpad ของ session ที่ตั้งค่า หรือคัดลอกจากด้านล่าง:

```sql
create policy "authenticated read" on ponds for select
  using (auth.role() = 'authenticated');
create policy "authenticated write" on ponds for insert
  with check (auth.role() = 'authenticated');
create policy "authenticated update" on ponds for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated delete" on ponds for delete
  using (auth.role() = 'authenticated');
-- ทำซ้ำรูปแบบเดียวกันกับ cost_items, daily_logs (select/insert/update/delete)
-- farm_settings มีแค่ select/update (ไม่มี insert/delete เพราะมีแถวเดียวตายตัว)
```

ผลคือ **ทั้ง publishable key เฉยๆ และผู้ใช้ที่ยังไม่ login จะอ่าน/เขียนอะไรไม่ได้เลย** ต้อง login ผ่าน Supabase Auth ก่อนเสมอ — ดังนั้นเมื่อจะต่อ `index.html`/`app.js` เข้ากับฐานข้อมูลจริง จำเป็นต้องมีหน้า login ในแอปด้วย

## ขั้นตอนการเชื่อมต่อ (เมื่อพร้อมลงมือ)

1. สร้างโปรเจกต์ใหม่ที่ [supabase.com](https://supabase.com) รันสคริปต์ SQL ด้านบนใน SQL editor
2. เปิด RLS และตั้ง policy ตามระดับความปลอดภัยที่เลือก
3. เพิ่ม Supabase JS client ผ่าน CDN ใน `index.html` (แบบเดียวกับที่ทำกับ Leaflet ใน `app.js`):
   ```html
   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
   ```
4. สร้าง client instance ด้วย Project URL + publishable key จากหัวข้อ "ค่าเชื่อมต่อโปรเจกต์" ด้านบน:
   ```js
   const supabase = window.supabase.createClient(
     'https://jwmtvhebqblchbdahzhe.supabase.co',
     'sb_publishable_rgN7JnGE64k8V80E3ky-3g_XopWo8dK'
   );
   ```
5. ย้าย logic ทีละส่วน โดยแทนที่การอ่าน/เขียน array ในหน่วยความจำด้วยการเรียก Supabase:

   | ของเดิม | แทนที่ด้วย |
   |---|---|
   | `PONDS` array + `renderAll()` | โหลดด้วย `supabase.from('ponds').select('*')` ตอนเปิดหน้า แล้ว `renderAll()` เหมือนเดิมกับข้อมูลที่ได้ |
   | `openPondForm` save → `PONDS.push(...)` / `Object.assign(p, data)` | `supabase.from('ponds').insert(data)` หรือ `.update(data).eq('id', id)` |
   | `deletePond` → `PONDS.filter(...)` | `supabase.from('ponds').delete().eq('id', id)` (cascade ลบ cost_items ให้อัตโนมัติจาก `on delete cascade`) |
   | `COST_ITEMS` array | เหมือนรูปแบบ ponds แต่ใช้ตาราง `cost_items` |
   | `localStorage.getItem/setItem('manasFarmDailyLogs')` ใน `app.js` | `supabase.from('daily_logs').select('*')` / `.insert(entry)` |

6. ทดสอบทีละหน้า (บ่อเลี้ยง → ผลผลิต → ต้นทุน → บันทึกรายวัน → รายงาน) เพราะทุกหน้าพึ่งพา `PONDS`/`COST_ITEMS` ร่วมกัน การย้ายทีละตารางจะปลอดภัยกว่าย้ายทั้งหมดพร้อมกัน

## สิ่งที่ยังไม่ต้องทำตอนนี้

- ยังไม่ต้องสร้างโปรเจกต์ Supabase จริงจนกว่าจะตัดสินใจ deploy หรือให้หลายคนเข้าถึงข้อมูลพร้อมกัน
- ยังไม่ต้องย้าย `TREND` — รอมีข้อมูลจริงสะสมพอสมควรก่อน แล้วค่อยเปลี่ยนเป็น query จากข้อมูลจริง
