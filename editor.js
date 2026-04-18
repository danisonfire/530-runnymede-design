/* =========================================================================
   530 Runnymede — Room Color Editor
   ------------------------------------------------------------------------
   • Edit Mode toggle (top-right)
   • Per-chip edit / delete buttons, per-room "+ add chip" button
   • Color picker modal: search (name/code), family filter, used-at-top
   • Editable surface label + designer note per room
   • Saves everything to localStorage (key: runnymede-edits-v1)
   • Top palette grid and per-room mood strip auto-update from current chips
   ========================================================================= */

(function () {
  const STORAGE_KEY = 'runnymede-edits-v2';
  const CUSTOM_COLORS_KEY = 'runnymede-custom-colors-v1';

  // Merge any user-added custom colors into the global library
  (function mergeCustom() {
    try {
      const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;
      const byCode = new Map((window.BM_COLORS || []).map(c => [c.code, c]));
      for (const c of arr) {
        if (!c || !c.code || !c.hex) continue;
        byCode.set(c.code, { code: c.code, name: c.name || c.code, hex: c.hex.toUpperCase(), family: c.family || 'gray', custom: true });
      }
      window.BM_COLORS = Array.from(byCode.values());
    } catch {}
  })();

  function saveCustomColor(c) {
    let arr = [];
    try {
      const raw = localStorage.getItem(CUSTOM_COLORS_KEY);
      if (raw) arr = JSON.parse(raw) || [];
    } catch {}
    arr = arr.filter(x => x.code !== c.code);
    arr.push(c);
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(arr));
    // also merge into in-memory library
    const byCode = new Map(window.BM_COLORS.map(x => [x.code, x]));
    byCode.set(c.code, { ...c, custom: true });
    window.BM_COLORS = Array.from(byCode.values());
  }

  /* ----------------------------------------------------------------------
     1.  Load or init state
     ---------------------------------------------------------------------- */

  // Read room data out of the DOM and build the initial state object.
  // State shape:
  //   { rooms: { [roomId]: { chips:[{id,surface,name,code,hex,isWallpaper?,bgImage?}], note:string } },
  //     _version: 1 }
  function snapshotFromDOM() {
    const rooms = {};
    document.querySelectorAll('section.room').forEach((section, idx) => {
      const id = section.dataset.roomId || ('room-' + idx);
      section.dataset.roomId = id;
      const chips = [];
      section.querySelectorAll('.color-chip').forEach((chipEl, cIdx) => {
        const swatch = chipEl.querySelector('.chip-swatch');
        const surface = chipEl.querySelector('.chip-surface')?.textContent.trim() || '';
        const name = chipEl.querySelector('.chip-name')?.textContent.trim() || '';
        const code = chipEl.querySelector('.chip-code')?.textContent.trim() || '';
        const bgStyle = swatch?.getAttribute('style') || '';
        const hexMatch = bgStyle.match(/#([0-9A-Fa-f]{6})/);
        const varMatch = bgStyle.match(/var\(--([a-z-]+)\)/);
        let hex = null;
        if (hexMatch) hex = '#' + hexMatch[1].toUpperCase();
        else if (varMatch) {
          const css = getComputedStyle(document.documentElement).getPropertyValue('--' + varMatch[1]);
          if (css) hex = css.trim().toUpperCase();
        }
        const isWallpaper = /url\(/.test(bgStyle);
        const bgImage = isWallpaper ? bgStyle.match(/url\([^)]+\)/)?.[0] : null;
        chips.push({
          id: id + '-chip-' + cIdx,
          surface, name, code,
          hex: hex || '#CCCCCC',
          isWallpaper: !!isWallpaper,
          bgImage: bgImage || null,
        });
      });
      const noteEl = section.querySelector('.designer-note');
      const note = noteEl ? noteEl.innerHTML.trim() : '';
      rooms[id] = { chips, note };
    });
    return { _version: 1, rooms };
  }

  let baseline = snapshotFromDOM();
  let state = loadState() || JSON.parse(JSON.stringify(baseline));
  // Merge baseline with saved state so new rooms added in HTML are picked up.
  for (const roomId of Object.keys(baseline.rooms)) {
    if (!state.rooms[roomId]) state.rooms[roomId] = baseline.rooms[roomId];
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && obj._version === 1) return obj;
    } catch {}
    return null;
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  /* ----------------------------------------------------------------------
     2.  Render
     ---------------------------------------------------------------------- */

  function renderRooms() {
    for (const [roomId, room] of Object.entries(state.rooms)) {
      const section = document.querySelector(`section.room[data-room-id="${roomId}"]`);
      if (!section) continue;
      const specBox = section.querySelector('.room-spec');
      if (!specBox) continue;

      // --- chips ---
      const chipsWrap = specBox.querySelector('.color-chips');
      chipsWrap.innerHTML = '';
      room.chips.forEach(chip => chipsWrap.appendChild(buildChip(roomId, chip)));

      // --- add-chip button (edit mode only) ---
      let addBtn = specBox.querySelector('.add-chip-btn');
      if (!addBtn) {
        addBtn = document.createElement('button');
        addBtn.className = 'add-chip-btn edit-only';
        addBtn.type = 'button';
        addBtn.innerHTML = '<span>+</span> Add color';
        addBtn.addEventListener('click', () => {
          openPicker({ roomId, mode: 'add' });
        });
        chipsWrap.after(addBtn);
      }

      // --- designer note ---
      const noteEl = specBox.querySelector('.designer-note');
      if (noteEl) {
        noteEl.innerHTML = room.note;
        noteEl.setAttribute('data-note-for', roomId);
      }

      // --- mood strip (above photos, first time only) ---
      ensureMoodStrip(section, room);
    }
    renderTopPalette();
    applyEditModeClass();
  }

  function buildChip(roomId, chip) {
    const wrap = document.createElement('div');
    wrap.className = 'color-chip';
    wrap.dataset.chipId = chip.id;

    const swatch = document.createElement('div');
    swatch.className = 'chip-swatch';
    if (chip.isWallpaper && chip.bgImage) {
      swatch.style.background = chip.bgImage + ' center/cover';
      swatch.style.border = '1px solid rgba(0,0,0,0.1)';
    } else {
      swatch.style.background = chip.hex;
    }
    wrap.appendChild(swatch);

    const info = document.createElement('div');
    info.className = 'chip-info';
    info.innerHTML = `
      <div class="chip-surface" data-field="surface">${escapeHTML(chip.surface)}</div>
      <div class="chip-name">${escapeHTML(chip.name)}</div>
      <div class="chip-code">${escapeHTML(chip.code)}</div>
    `;
    wrap.appendChild(info);

    // --- edit mode controls ---
    const actions = document.createElement('div');
    actions.className = 'chip-actions edit-only';
    actions.innerHTML = `
      <button type="button" class="chip-act chip-act-edit" title="Change color">Edit</button>
      <button type="button" class="chip-act chip-act-del" title="Remove chip">&times;</button>
    `;
    wrap.appendChild(actions);

    actions.querySelector('.chip-act-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openPicker({ roomId, mode: 'replace', chipId: chip.id });
    });
    actions.querySelector('.chip-act-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Remove this color chip?')) {
        const room = state.rooms[roomId];
        room.chips = room.chips.filter(c => c.id !== chip.id);
        saveState();
        renderRooms();
      }
    });

    // Surface label edit
    const surfaceEl = info.querySelector('.chip-surface');
    surfaceEl.addEventListener('click', (e) => {
      if (!document.body.classList.contains('edit-mode')) return;
      e.stopPropagation();
      inlineEdit(surfaceEl, chip.surface, (newVal) => {
        const c = state.rooms[roomId].chips.find(x => x.id === chip.id);
        if (!c) return;
        c.surface = newVal;
        saveState();
        renderRooms();
      });
    });

    return wrap;
  }

  function ensureMoodStrip(section, room) {
    const photoBox = section.querySelector('.room-photos');
    if (!photoBox) return;
    let strip = section.querySelector('.room-mood');
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'room-mood';
      strip.setAttribute('aria-label', 'Room color mood strip');
      photoBox.prepend(strip);
    }
    strip.innerHTML = '';
    const chips = room.chips.slice(0, 8);
    chips.forEach(c => {
      const seg = document.createElement('div');
      seg.className = 'mood-seg';
      if (c.isWallpaper && c.bgImage) {
        seg.style.background = c.bgImage + ' center/cover';
      } else {
        seg.style.background = c.hex;
      }
      seg.title = c.name + (c.code ? ' · ' + c.code : '');
      strip.appendChild(seg);
    });
  }

  /* ----- designer note editing ----- */
  function initNoteEditing() {
    document.querySelectorAll('.designer-note').forEach(noteEl => {
      noteEl.addEventListener('click', (e) => {
        if (!document.body.classList.contains('edit-mode')) return;
        if (noteEl.classList.contains('editing')) return;
        const roomId = noteEl.getAttribute('data-note-for');
        if (!roomId) return;
        const original = state.rooms[roomId]?.note || '';
        startNoteEdit(noteEl, original, (newVal) => {
          state.rooms[roomId].note = newVal;
          saveState();
          renderRooms();
        });
      });
    });
  }

  function startNoteEdit(el, originalHTML, onSave) {
    el.classList.add('editing');
    const ta = document.createElement('textarea');
    ta.className = 'note-editor';
    // Strip HTML tags for raw edit; preserve <strong> markers as ** for simplicity
    const plain = originalHTML
      .replace(/<strong>/gi, '**')
      .replace(/<\/strong>/gi, '**')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
    ta.value = plain.trim();
    const controls = document.createElement('div');
    controls.className = 'note-editor-controls';
    controls.innerHTML = `
      <span class="note-hint">**bold** · click Save when done</span>
      <div>
        <button type="button" class="note-cancel">Cancel</button>
        <button type="button" class="note-save">Save</button>
      </div>
    `;
    el.innerHTML = '';
    el.appendChild(ta);
    el.appendChild(controls);
    ta.focus();

    controls.querySelector('.note-cancel').onclick = () => {
      el.classList.remove('editing');
      el.innerHTML = originalHTML;
    };
    controls.querySelector('.note-save').onclick = () => {
      const v = ta.value
        .replace(/</g,'&lt;')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
      el.classList.remove('editing');
      onSave(v);
    };
  }

  function inlineEdit(el, original, onSave) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.className = 'inline-edit-input';
    el.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const commit = () => {
      if (done) return;
      done = true;
      onSave(input.value.trim() || original);
    };
    const cancel = () => {
      if (done) return;
      done = true;
      el.textContent = original;
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { cancel(); }
    });
  }

  /* ----------------------------------------------------------------------
     3.  Top palette auto-update
     ---------------------------------------------------------------------- */

  function renderTopPalette() {
    const wrap = document.querySelector('.full-palette .palette-grid');
    if (!wrap) return;
    // gather unique used colors across rooms
    const seen = new Map(); // key: hex or wallpaper-id
    const usage = new Map();
    for (const [roomId, room] of Object.entries(state.rooms)) {
      const roomName = roomLabel(roomId);
      for (const c of room.chips) {
        const key = c.isWallpaper ? ('wp:' + (c.bgImage || c.name)) : c.hex.toUpperCase();
        if (!seen.has(key)) seen.set(key, c);
        const arr = usage.get(key) || [];
        if (!arr.includes(roomName)) arr.push(roomName);
        usage.set(key, arr);
      }
    }
    // Rebuild
    wrap.innerHTML = '';
    for (const [key, chip] of seen) {
      const card = document.createElement('div');
      card.className = 'palette-card';
      const swatch = document.createElement('div');
      swatch.className = 'palette-swatch';
      if (chip.isWallpaper && chip.bgImage) {
        swatch.style.background = chip.bgImage + ' center/cover';
        swatch.style.border = '1px solid rgba(0,0,0,0.1)';
      } else {
        swatch.style.background = chip.hex;
      }
      card.appendChild(swatch);
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = chip.name || '—';
      card.appendChild(name);
      const code = document.createElement('div');
      code.className = 'code';
      code.textContent = chip.code || '';
      card.appendChild(code);
      const roomsEl = document.createElement('div');
      roomsEl.className = 'rooms';
      roomsEl.textContent = (usage.get(key) || []).join(' · ');
      card.appendChild(roomsEl);

      // Click on a palette card to open BM page for that color (if it's a BM color)
      if (chip.code && /^[A-Z]{1,4}-?\d+|^\d{3,4}(-\d+)?$/i.test(chip.code.split(' ')[0])) {
        const codeClean = chip.code.split(' ')[0];
        const bmUrl = bmUrlFor(codeClean, chip.name);
        if (bmUrl) {
          card.style.cursor = 'pointer';
          card.addEventListener('click', () => window.open(bmUrl, '_blank'));
        }
      }
      wrap.appendChild(card);
    }
  }

  function roomLabel(roomId) {
    const section = document.querySelector(`section.room[data-room-id="${roomId}"]`);
    if (!section) return roomId;
    return section.querySelector('.room-header h2')?.textContent.trim().replace(/&/g, '&') || roomId;
  }

  function bmUrlFor(code, name) {
    const slugName = (name || '').toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (!slugName) return null;
    const codeSlug = code.toLowerCase();
    return `https://www.benjaminmoore.com/en-us/paint-colors/color/${codeSlug}/${slugName}`;
  }

  /* ----------------------------------------------------------------------
     4.  Color picker modal
     ---------------------------------------------------------------------- */

  let pickerCtx = null; // { roomId, mode:'add'|'replace', chipId? }

  function openPicker(ctx) {
    pickerCtx = ctx;
    const modal = document.getElementById('bm-picker');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('bm-search').value = '';
    document.getElementById('bm-search').focus();
    renderPickerGrid();
  }
  function closePicker() {
    pickerCtx = null;
    document.getElementById('bm-picker').classList.remove('open');
    document.body.style.overflow = '';
  }

  function currentFamily() {
    const active = document.querySelector('.fam-pill.active');
    return active ? active.dataset.family : 'all';
  }

  function renderPickerGrid() {
    const grid = document.getElementById('bm-grid');
    const q = document.getElementById('bm-search').value.trim().toLowerCase();
    const fam = currentFamily();

    // "Used in this design" shortcut row
    const usedKeys = new Set();
    const used = [];
    for (const room of Object.values(state.rooms)) {
      for (const c of room.chips) {
        if (c.isWallpaper) continue;
        const k = c.hex.toUpperCase();
        if (usedKeys.has(k)) continue;
        usedKeys.add(k);
        used.push({ code: c.code.split(' · ')[0] || c.code, name: c.name, hex: c.hex, family: 'used' });
      }
    }

    const list = (window.BM_COLORS || []).filter(c => {
      if (fam !== 'all' && c.family !== fam) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) ||
             c.code.toLowerCase().includes(q) ||
             c.code.toLowerCase().replace(/[-\s]/g,'').includes(q.replace(/[-\s]/g,''));
    });

    const resultsNote = document.getElementById('bm-count');
    resultsNote.textContent = list.length + ' color' + (list.length===1?'':'s');

    grid.innerHTML = '';

    if (!q && fam === 'all' && used.length) {
      const header = document.createElement('div');
      header.className = 'grid-section';
      header.textContent = 'Used in this design';
      grid.appendChild(header);
      const row = document.createElement('div');
      row.className = 'grid-row';
      used.forEach(c => row.appendChild(buildPickerTile(c)));
      grid.appendChild(row);

      const header2 = document.createElement('div');
      header2.className = 'grid-section';
      header2.textContent = 'Benjamin Moore library';
      grid.appendChild(header2);
    }

    const row = document.createElement('div');
    row.className = 'grid-row';
    // Progressive render: first 300 immediately, then the rest in chunks.
    const first = 300;
    const frag = document.createDocumentFragment();
    list.slice(0, first).forEach(c => frag.appendChild(buildPickerTile(c)));
    row.appendChild(frag);
    grid.appendChild(row);
    if (list.length > first) {
      let i = first;
      const chunk = 250;
      const step = () => {
        if (!document.getElementById('bm-picker').classList.contains('open')) return;
        if (i >= list.length) return;
        const f = document.createDocumentFragment();
        const end = Math.min(i + chunk, list.length);
        for (let j = i; j < end; j++) f.appendChild(buildPickerTile(list[j]));
        row.appendChild(f);
        i = end;
        if (i < list.length) requestIdleCallback ? requestIdleCallback(step, {timeout: 120}) : setTimeout(step, 30);
      };
      requestIdleCallback ? requestIdleCallback(step, {timeout: 120}) : setTimeout(step, 30);
    }
  }

  function buildPickerTile(c) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'bm-tile' + (c.name ? '' : ' bm-tile-unnamed');
    const displayName = c.name || c.code;
    const displaySub = c.name ? c.code : 'Look up on benjaminmoore.com';
    tile.innerHTML = `
      <div class="bm-tile-swatch" style="background:${c.hex}"></div>
      <div class="bm-tile-meta">
        <div class="bm-tile-name">${escapeHTML(displayName)}</div>
        <div class="bm-tile-code">${escapeHTML(displaySub)}</div>
      </div>
    `;
    tile.addEventListener('click', () => applyPick(c));
    return tile;
  }

  function applyPick(c) {
    if (!pickerCtx) return;
    const room = state.rooms[pickerCtx.roomId];
    if (!room) return;
    if (pickerCtx.mode === 'add') {
      const newChip = {
        id: pickerCtx.roomId + '-chip-' + Date.now(),
        surface: 'Accent',
        name: c.name || c.code,
        code: c.code,
        hex: c.hex,
        isWallpaper: false,
      };
      room.chips.push(newChip);
    } else if (pickerCtx.mode === 'replace' && pickerCtx.chipId) {
      const chip = room.chips.find(x => x.id === pickerCtx.chipId);
      if (chip) {
        chip.name = c.name || c.code;
        chip.code = c.code;
        chip.hex = c.hex;
        chip.isWallpaper = false;
        chip.bgImage = null;
      }
    }
    saveState();
    closePicker();
    renderRooms();
  }

  /* ----------------------------------------------------------------------
     5.  Edit mode toggle + reset
     ---------------------------------------------------------------------- */

  function applyEditModeClass() {
    // nothing — toggle button flips body.edit-mode directly
  }

  function initToolbar() {
    const bar = document.getElementById('editor-toolbar');
    bar.querySelector('#btn-edit').addEventListener('click', (e) => {
      const on = document.body.classList.toggle('edit-mode');
      e.currentTarget.classList.toggle('on', on);
      e.currentTarget.textContent = on ? '✓ Editing' : 'Edit mode';
    });
    bar.querySelector('#btn-reset').addEventListener('click', () => {
      if (!confirm('Reset all rooms to their original colors and notes? This clears your saved edits.')) return;
      localStorage.removeItem(STORAGE_KEY);
      state = JSON.parse(JSON.stringify(baseline));
      renderRooms();
    });
    bar.querySelector('#btn-export').addEventListener('click', () => {
      const data = JSON.stringify(state, null, 2);
      navigator.clipboard?.writeText(data).then(() => {
        alert('Your edits have been copied to the clipboard as JSON. Paste somewhere safe to archive them.');
      }, () => {
        // fallback: download
        const blob = new Blob([data], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'runnymede-edits.json';
        a.click();
      });
    });
  }

  function initPicker() {
    const modal = document.getElementById('bm-picker');
    modal.querySelector('#bm-close').addEventListener('click', closePicker);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closePicker();
    });
    document.getElementById('bm-search').addEventListener('input', debounce(renderPickerGrid, 120));
    // Family pills
    const famWrap = document.getElementById('bm-families');
    famWrap.innerHTML = '';
    (window.BM_FAMILIES || []).forEach((f, idx) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fam-pill' + (idx === 0 ? ' active' : '');
      b.textContent = f.label;
      b.dataset.family = f.id;
      b.addEventListener('click', () => {
        famWrap.querySelectorAll('.fam-pill').forEach(p => p.classList.remove('active'));
        b.classList.add('active');
        renderPickerGrid();
      });
      famWrap.appendChild(b);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) closePicker();
    });

    // ===== Add-from-URL =====
    const urlInput = document.getElementById('bm-url-input');
    const parsedEl = document.getElementById('bm-url-parsed');
    const hexInput = document.getElementById('bm-url-hex');
    const colorInput = document.getElementById('bm-url-color');
    const famSelect = document.getElementById('bm-url-family');
    const saveBtn = document.getElementById('bm-url-save');
    // populate family select
    (window.BM_FAMILIES || []).filter(f => f.id !== 'all').forEach(f => {
      const o = document.createElement('option');
      o.value = f.id;
      o.textContent = f.label;
      famSelect.appendChild(o);
    });
    famSelect.value = 'gray';

    let parsed = null; // {code, name}
    function parseBMUrl(u) {
      if (!u) return null;
      u = u.trim();
      // Tolerate missing protocol
      if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
      try {
        const url = new URL(u);
        const host = url.hostname.toLowerCase().replace(/^www\./, '');
        if (!/(^|\.)benjaminmoore\.(com|ca)$/.test(host)) return null;
        const path = url.pathname.replace(/\/+$/, ''); // strip trailing /
        // Accept anything like  .../color/<code>/<name>  OR  .../colour/<code>/<name>
        // Examples that work:
        //   /en-ca/paint-colors/color/hc-154/hale-navy
        //   /paint-color/color/hc-154/hale-navy
        //   /paint-colours/colour/hc-154/hale-navy/
        //   /en-us/color-gallery/colors/hc-154/hale-navy
        const m = path.match(/\/colou?r\/([^/]+)\/([^/]+)$/i)
               || path.match(/\/colors\/([^/]+)\/([^/]+)$/i);
        if (!m) return null;
        // Validate the code looks like a BM code: letters+digits with optional dash (e.g. HC-154, 2062-10, CC-90, AF-565, OC-17)
        const rawCode = m[1];
        if (!/^[A-Za-z]{0,4}-?\d{1,4}(-\d{1,4})?$/.test(rawCode) && !/^\d{3,4}-\d{1,3}$/.test(rawCode)) {
          // If it doesn't look like a code, bail — avoids matching unrelated paths
          return null;
        }
        const code = rawCode.toUpperCase();
        const name = m[2].replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
          .split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        return { code, name };
      } catch { return null; }
    }
    function updateParsed() {
      parsed = parseBMUrl(urlInput.value.trim());
      if (parsed) {
        parsedEl.textContent = parsed.code + ' · ' + parsed.name;
        parsedEl.style.color = 'var(--text)';
        saveBtn.disabled = false;
      } else {
        parsedEl.textContent = urlInput.value.trim() ? '⚠ Not a valid BM color link' : '—';
        parsedEl.style.color = 'var(--text-light)';
        saveBtn.disabled = true;
      }
    }
    saveBtn.disabled = true;
    urlInput.addEventListener('input', updateParsed);

    // Sync the color input and hex text
    function syncHex(val) {
      const v = val.startsWith('#') ? val : '#' + val;
      if (!/^#[0-9A-Fa-f]{6}$/.test(v)) return;
      hexInput.value = v.toUpperCase();
      colorInput.value = v.toLowerCase();
    }
    colorInput.addEventListener('input', () => syncHex(colorInput.value));
    hexInput.addEventListener('input', () => syncHex(hexInput.value));
    hexInput.addEventListener('blur', () => syncHex(hexInput.value));

    saveBtn.addEventListener('click', () => {
      if (!parsed) return;
      const hex = (hexInput.value || '').toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(hex)) {
        alert('Please sample the hex from a screenshot — or type a valid 6-digit hex.');
        return;
      }
      // auto-classify family from hue if user hasn't picked one explicitly
      const autoFam = classifyFamily(hex);
      if (autoFam) famSelect.value = autoFam;

      const custom = {
        code: parsed.code,
        name: parsed.name,
        hex,
        family: famSelect.value || 'gray',
      };
      saveCustomColor(custom);
      saveBtn.textContent = '✓ Added — ' + parsed.name;
      setTimeout(() => {
        saveBtn.textContent = 'Add to library';
        saveBtn.disabled = true;
      }, 2200);
      urlInput.value = '';
      parsedEl.textContent = '—';
      resetDropZone();
      renderPickerGrid();
    });

    // ===== Screenshot drop / paste / click sampler =====
    const dropZone = document.getElementById('bm-drop');
    const fileInput = document.getElementById('bm-file');
    const browseBtn = document.getElementById('bm-drop-browse');
    const canvas = document.getElementById('bm-canvas');
    const emptyEl = dropZone.querySelector('.bm-drop-empty');
    const previewEl = dropZone.querySelector('.bm-drop-preview');
    const captionEl = dropZone.querySelector('.bm-drop-caption');
    const hexSourceEl = document.getElementById('bm-hex-source');

    function resetDropZone() {
      const ctx = canvas.getContext('2d');
      ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.width = 0; canvas.height = 0;
      emptyEl.hidden = false;
      previewEl.hidden = true;
      captionEl.textContent = 'Click anywhere on the swatch to sample';
      hexSourceEl.textContent = 'manual';
      hexSourceEl.classList.remove('sampled');
    }

    function loadImageToCanvas(file) {
      if (!file || !file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        // Fit into a reasonable display size while keeping the source res for sampling
        const maxW = 520, maxH = 260;
        let w = img.naturalWidth, h = img.naturalHeight;
        const scale = Math.min(1, maxW / w, maxH / h);
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        emptyEl.hidden = true;
        previewEl.hidden = false;
        // Auto-sample the center as a first guess
        sampleAt(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), true);
        captionEl.textContent = 'Click the swatch to sample a different point · ⌥ avg 11×11';
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { alert('Could not load that image.'); URL.revokeObjectURL(url); };
      img.src = url;
    }

    function sampleAt(x, y, isAuto) {
      const ctx = canvas.getContext('2d');
      // Sample a small area for robustness against JPEG noise / AA
      const size = 11;
      const half = Math.floor(size / 2);
      const sx = Math.max(0, Math.min(canvas.width - size, x - half));
      const sy = Math.max(0, Math.min(canvas.height - size, y - half));
      const data = ctx.getImageData(sx, sy, size, size).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
      }
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
      hexInput.value = hex;
      colorInput.value = hex.toLowerCase();
      const fam = classifyFamily(hex);
      if (fam) famSelect.value = fam;
      hexSourceEl.textContent = isAuto ? 'auto (center)' : 'sampled';
      hexSourceEl.classList.add('sampled');
    }

    canvas.addEventListener('click', (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width));
      const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height));
      sampleAt(x, y, false);
    });

    // File input
    browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
    dropZone.addEventListener('click', (e) => {
      // Don't reopen picker when clicking the canvas (let canvas.click handle it)
      if (e.target === canvas) return;
      if (emptyEl.hidden) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) loadImageToCanvas(f);
      fileInput.value = '';
    });

    // Drag & drop
    ['dragenter','dragover'].forEach(ev =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('dragover'); }));
    ['dragleave','drop'].forEach(ev =>
      dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); }));
    dropZone.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadImageToCanvas(f);
    });

    // Paste support — only when the add-from-url panel is open and focused area
    document.addEventListener('paste', (e) => {
      const details = document.getElementById('bm-add-url');
      if (!details || !details.open) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) { loadImageToCanvas(f); e.preventDefault(); break; }
        }
      }
    });
  }

  function classifyFamily(hex) {
    const m = hex.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
    if (!m) return null;
    const r = parseInt(m[1],16)/255, g = parseInt(m[2],16)/255, b = parseInt(m[3],16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const L = (max+min)/2;
    const d = max-min;
    if (L > 0.85 && d < 0.08) return 'white';
    if (L < 0.18 && d < 0.08) return 'black';
    if (d < 0.06) return 'gray';
    let h = 0;
    if (max === r) h = ((g-b)/d) % 6;
    else if (max === g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    h = (h*60 + 360) % 360;
    if (r > 0.45 && g < 0.45 && b < 0.45 && L < 0.5 && h < 30 && max > g*1.4) return 'brown';
    if (h < 15 || h >= 345) return 'red';
    if (h < 45) return 'orange';
    if (h < 65) return (L < 0.45 ? 'brown' : 'yellow');
    if (h < 75) return 'yellow';
    if (h < 170) return 'green';
    if (h < 260) return 'blue';
    if (h < 320) return 'purple';
    return 'pink';
  }

  /* ----------------------------------------------------------------------
     6.  Utilities
     ---------------------------------------------------------------------- */

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[ch]));
  }
  function debounce(fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  /* ----------------------------------------------------------------------
     7.  Boot
     ---------------------------------------------------------------------- */

  document.addEventListener('DOMContentLoaded', () => {
    initToolbar();
    initPicker();
    initNoteEditing();
    renderRooms();
    // re-bind note editing after every render (renderRooms rewrites chip markup
    // but leaves note elements, so one bind at load is enough)
  });
})();
