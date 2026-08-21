# SUPABASE.md

เอกสารอ้างอิงฐานข้อมูล Supabase จริงที่ใช้งานอยู่ (ไม่ใช่แผน — schema/policy ทั้งหมดด้านล่างรันบนโปรเจกต์จริงแล้ว) อ่านไฟล์นี้ก่อนแก้โค้ดส่วนที่เกี่ยวกับข้อมูลใดๆ

## ค่าเชื่อมต่อโปรเจกต์

| ค่า | สำหรับใช้ | ค่า |
|---|---|---|
| Project URL | ใช้ในโค้ดฝั่ง client ได้ปกติ | `https://jwmtvhebqblchbdahzhe.supabase.co` |
| Publishable (anon) key | ใช้ในโค้ดฝั่ง client ได้ปกติ — ออกแบบมาให้ฝังในหน้าเว็บได้ ปลอดภัยตราบใดที่เปิด RLS | `sb_publishable_rgN7JnGE64k8V80E3ky-3g_XopWo8dK` |
| Database password / direct connection string | **ไม่เก็บในไฟล์นี้** — เป็นรหัสระดับ superuser ต่างจาก anon key ที่ออกแบบมาให้เปิดเผยได้ เก็บไว้ใน password manager แทน | — |

## Schema ปัจจุบัน

```sql
-- บ่อเลี้ยง: ข้อมูล identity/สถานะ/คุณภาพน้ำ "ล่าสุด" เท่านั้น — ข้อมูลผลผลิตย้ายไป production_cycles แล้ว
create table ponds (
  id                bigint generated always as identity primary key,
  code              text not null unique,
  status            text not null check (status in ('empty','growing','prep','harvested')),
  size              numeric,
  depth             numeric,
  species           text,
  ph                numeric,             -- ค่าน้ำล่าสุด ถูกอัปเดตทุกครั้งที่บันทึกรายวันมีค่าน้ำ
  do_level          numeric,
  temp              numeric,
  salinity          numeric,
  assigned_user_id  uuid references auth.users(id) on delete set null,  -- พนักงานที่รับผิดชอบ (1 คนได้หลายบ่อ)
  -- คอลัมน์เดิม (ก่อนมี production_cycles) เหลือไว้เฉยๆ ไม่ใช้แล้ว ไม่ลบเพื่อความปลอดภัยของข้อมูล:
  release_date date, yield_kg numeric, survival numeric, fcr numeric, harvest_date date, grade text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ประวัติรุ่นการเลี้ยงทุกรอบ ต่อบ่อ (เก็บย้อนหลังได้ไม่จำกัด)
create table production_cycles (
  id           bigint generated always as identity primary key,
  pond_id      bigint not null references ponds(id) on delete restrict,  -- restrict: กันลบบ่อที่มีประวัติ
  cycle_no     int not null,
  release_date date,
  species      text,
  status       text not null default 'growing' check (status in ('growing','harvested')),
  harvest_date date,
  yield_kg     numeric default 0,
  survival     numeric,
  fcr          numeric,
  grade        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (pond_id, cycle_no)
);

-- รายการค่าใช้จ่าย ผูกได้ทั้งบ่อและรุ่นการเลี้ยง (cycle_id ไว้คำนวณกำไร/ขาดทุนต่อรุ่นแม่นยำ)
create table cost_items (
  id          bigint generated always as identity primary key,
  pond_id     bigint not null references ponds(id) on delete cascade,
  cycle_id    bigint references production_cycles(id) on delete set null,
  category    text not null check (category in ('seed','feed','utility','chem','labor')),
  description text,
  amount      numeric not null check (amount > 0),
  created_at  timestamptz not null default now()
);

-- บันทึกรายวัน: ปริมาณอาหาร + คุณภาพน้ำ (แยกคอลัมน์ ไม่ใช่ช่องค่าตัวเลขทั่วไปแล้ว)
create table daily_logs (
  id           bigint generated always as identity primary key,
  pond_id      bigint references ponds(id) on delete set null,
  log_date     date not null,
  feed_amount  numeric,
  ph           numeric,
  do_level     numeric,
  temp         numeric,
  salinity     numeric,
  value        numeric,  -- คอลัมน์เดิมก่อนแยกฟิลด์ เหลือไว้เฉยๆ ไม่ใช้แล้ว
  note         text,
  created_at   timestamptz not null default now()
);

-- ค่าตั้งต้นของฟาร์ม
create table farm_settings (
  id         int primary key default 1,
  farm_name  text not null default 'มนัสฟาร์ม',
  owner_name text not null default 'คุณอัญมณี',
  address    text,
  sell_price numeric not null default 180,  -- บาท/กก. ใช้คำนวณรายได้ในหน้ารายงาน
  constraint single_row check (id = 1)
);

-- สิทธิ์ผู้ใช้งาน (admin เห็น/แก้ทุกบ่อ, user เห็นเฉพาะบ่อที่ ponds.assigned_user_id ชี้มาที่ตัวเอง)
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'user' check (role in ('admin','user')),
  full_name  text,
  email      text,  -- denormalized ไว้แสดงผล ไม่ query auth.users ตรงจาก client
  created_at timestamptz not null default now()
);
```

หมายเหตุ:
- แนวโน้มรายเดือนในหน้ารายงานคำนวณจาก `production_cycles.harvest_date` + `cost_items.created_at` โดยตรง (ดู `buildTrend()` ใน `index.html`) ไม่มีตารางแยก
- `daily_logs` ที่มีค่าน้ำ จะ mirror ไปอัปเดต `ponds.ph/do_level/temp/salinity` ด้วยเสมอ (ฝั่ง client ใน `app.js`) เพื่อให้หน้าบ่อเลี้ยง/ระบบแจ้งเตือนเห็นค่าล่าสุดโดยไม่ต้อง query ย้อน `daily_logs`

## Row Level Security — สิทธิ์ 2 ระดับ (Admin / User)

ทุกตารางเปิด RLS ทั้งหมด ไม่มี anon access เลย ต้อง login ผ่าน Supabase Auth เสมอ และแยกสิทธิ์ตาม role ใน `profiles`:

- **Admin**: อ่าน/เขียนทุกบ่อ, สร้าง/ลบบ่อได้, เปลี่ยน role ผู้ใช้อื่นได้, แก้ `farm_settings` ได้
- **User (พนักงาน)**: อ่าน/เขียนได้เฉพาะบ่อที่ `ponds.assigned_user_id` ชี้มาที่ตัวเอง (รวมถึง `production_cycles`/`cost_items`/`daily_logs` ของบ่อนั้น) — สร้าง/ลบบ่อไม่ได้

### Helper functions (ต้อง `security definer` + pin `search_path` — ไม่งั้นวนลูปพัง)

```sql
create or replace function is_admin() returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function has_pond_access(p_pond_id bigint) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select is_admin() or exists (
    select 1 from public.ponds where id = p_pond_id and assigned_user_id = auth.uid()
  );
$$;
```

**ทำไมต้อง `security definer`:** ฟังก์ชันเหล่านี้ query ตาราง `profiles`/`ponds` ซึ่งตัวมันเองมี RLS policy ที่เรียกฟังก์ชันนี้กลับมาอีกที ถ้าไม่ใส่ `security definer` (ให้ฟังก์ชันรันด้วยสิทธิ์เจ้าของฟังก์ชัน ข้าม RLS ของ query ภายในตัวมันเอง) จะเกิด infinite recursion จนพังทั้งระบบ (`stack depth limit exceeded`) — เจอบั๊กนี้จริงตอนออกแบบ แก้แล้ว

### Policy matrix

| ตาราง | select | insert | update | delete |
|---|---|---|---|---|
| `ponds` | `has_pond_access(id)` | `is_admin()` | `has_pond_access(id)` | `is_admin()` |
| `production_cycles` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `is_admin()` |
| `cost_items` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` |
| `daily_logs` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` | `has_pond_access(pond_id)` |
| `farm_settings` | `true` (ทุกคน login แล้วอ่านได้) | – | `is_admin()` | – |
| `profiles` | `is_admin() or id = auth.uid()` | `is_admin()` | `is_admin()` | `is_admin()` |

Trigger เสริม:
- `check_cost_item_cycle_pond` — กัน `cost_items.cycle_id` ผูกกับ `production_cycles` ของบ่ออื่น (ข้อมูลเพี้ยนแบบเงียบๆ)
- `handle_new_user` — สร้างแถว `profiles` (role='user') อัตโนมัติทุกครั้งที่มีผู้ใช้ Auth ใหม่ กันแอดมินลืมตั้งค่าแล้วผู้ใช้ใหม่เข้าระบบไม่ได้

**Bootstrap แอดมินคนแรก** (ต้องทำครั้งเดียวหลังสร้าง auth user ผ่าน dashboard — รันเองผ่าน SQL Editor เท่านั้น เพราะ policy insert ของ `profiles` เช็ค `is_admin()` ซึ่งยังไม่มีใครเป็นตอนเริ่ม):

```sql
insert into profiles (id, role, full_name, email)
select id, 'admin', '<ชื่อ>', email from auth.users where email = '<อีเมล>'
on conflict (id) do update set role = 'admin';
```

## Client setup (`index.html`)

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const supabaseClient = supabase.createClient(
    'https://jwmtvhebqblchbdahzhe.supabase.co',
    'sb_publishable_rgN7JnGE64k8V80E3ky-3g_XopWo8dK'
  );
</script>
```

ทุกหน้าโหลดข้อมูลผ่าน `loadPonds()`/`loadCycles()`/`loadCostItems()`/`loadProfiles()`/`loadFarmSettings()` (ใน `index.html`) หลัง login เสร็จ แล้ว re-load ใหม่ทุกครั้งหลัง insert/update/delete แทนการแก้ array ในหน่วยความจำตรงๆ — ดูรายละเอียด pattern เต็มใน `CLAUDE.md`
