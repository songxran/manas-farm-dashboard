(function () {
  // supabaseClient / PONDS / findPond come from the inline <script> in index.html,
  // which loads before this file — classic <script> tags share the same global
  // scope, so these top-level identifiers are visible here without any import.

  function formatDate(dateStr) {
    if (!dateStr) return '-';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('th-TH', {
      year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  function todayStr() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  /* ---------------- Pond dropdown ---------------- */
  // Called after login + loadPonds() so PONDS reflects real data from Supabase.
  function populatePondSelect() {
    const select = document.getElementById('dlPond');
    if (!select) return;

    if (!PONDS || PONDS.length === 0) {
      select.innerHTML = '<option value="">ยังไม่มีบ่อ กรุณาเพิ่มบ่อก่อน</option>';
      return;
    }

    select.innerHTML = PONDS.map(p => `<option value="${p.id}">${p.code}</option>`).join('');
  }

  /* ---------------- Daily log form ---------------- */
  async function renderDailyLog() {
    const tbody = document.querySelector('#dailyLogTable tbody');
    if (!tbody) return;

    const { data, error } = await supabaseClient
      .from('daily_logs')
      .select('*')
      .order('log_date', { ascending: false });

    if (error) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="4">โหลดข้อมูลไม่สำเร็จ: ${error.message}</td></tr>`;
      return;
    }

    if (data.length === 0) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="4">ยังไม่มีข้อมูลบันทึก</td></tr>';
      return;
    }

    tbody.innerHTML = data
      .map(entry => {
        const pond = typeof findPond === 'function' ? findPond(entry.pond_id) : null;
        return `
        <tr>
          <td><strong>${pond ? pond.code : '-'}</strong></td>
          <td>${formatDate(entry.log_date)}</td>
          <td class="num">${entry.value}</td>
          <td>${entry.note ? entry.note : '-'}</td>
        </tr>`;
      })
      .join('');
  }

  function clearForm() {
    document.getElementById('dlDate').value = todayStr();
    document.getElementById('dlValue').value = '';
    document.getElementById('dlNote').value = '';
    populatePondSelect();
  }

  async function handleSave() {
    const pondSelect = document.getElementById('dlPond');
    const dateInput = document.getElementById('dlDate');
    const valueInput = document.getElementById('dlValue');
    const noteInput = document.getElementById('dlNote');

    const pondId = pondSelect.value;
    const date = dateInput.value.trim();
    const rawValue = valueInput.value.trim();
    const note = noteInput.value.trim();

    if (!pondId) {
      alert('กรุณาเลือกบ่อ');
      return;
    }
    if (!date) {
      alert('กรุณาเลือกหรือกรอกวันที่');
      return;
    }
    if (rawValue === '' || isNaN(parseFloat(rawValue))) {
      alert('กรุณากรอกค่าตัวเลขที่ต้องการบันทึก');
      return;
    }

    const entry = {
      pond_id: parseInt(pondId, 10),
      log_date: date,
      value: parseFloat(rawValue),
      note: note
    };

    const saveBtn = document.getElementById('dailyLogSaveBtn');
    saveBtn.disabled = true;
    const { error } = await supabaseClient.from('daily_logs').insert(entry);
    saveBtn.disabled = false;

    if (error) {
      alert('บันทึกไม่สำเร็จ: ' + error.message);
      return;
    }

    clearForm();
    await renderDailyLog();
  }

  /* ---------------- Farm map (Leaflet) ---------------- */
  // Must only run once the page is actually visible (after login) — the
  // dashboard is display:none behind the login screen, and Leaflet computes
  // a broken view if it initializes inside a zero-size container. Guarded so
  // repeat calls (e.g. logging out and back in) don't re-init the same div.
  let mapInitialized = false;
  function initFarmMap() {
    if (mapInitialized) return;
    const mapEl = document.getElementById('farmMap');
    if (!mapEl || typeof L === 'undefined') return;

    // Approximate coordinates for ต.ไสไทย อ.เมือง จ.กระบี่ (farm location)
    const farmLatLng = [8.0862, 98.9019];

    const map = L.map('farmMap').setView(farmLatLng, 14);
    mapInitialized = true;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    const marker = L.marker(farmLatLng, { draggable: true }).addTo(map);
    marker.bindPopup('มนัสฟาร์ม').openPopup();

    // Clicking anywhere on the map moves the pin to that point.
    map.on('click', function (e) {
      marker.setLatLng(e.latlng);
    });

    // Container had display:none up until just now, so Leaflet needs a nudge
    // to recompute its size correctly.
    setTimeout(() => map.invalidateSize(), 0);
  }

  // Exposed so index.html's auth flow can populate/render this page — and now
  // initialize the map — once the user is logged in and the dashboard (and
  // therefore #farmMap) is actually visible.
  window.populatePondSelect = populatePondSelect;
  window.renderDailyLog = renderDailyLog;
  window.initFarmMap = initFarmMap;

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('dlDate').value = todayStr();

    const saveBtn = document.getElementById('dailyLogSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', handleSave);
  });
})();
