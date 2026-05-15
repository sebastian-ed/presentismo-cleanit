(function () {
  const CONFIG = window.APP_CONFIG || {};
  const store = window.StoreFactory.create();

  const state = {
    loginMode: "operator",
    currentUser: null,
    currentProfile: null,
    sites: [],
    profiles: [],
    shifts: [],
    events: [],
    activeTab: "live"
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const byId = (items, id) => items.find(item => item.id === id);
  const formatDateTime = (value) => value ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const formatTime = (value) => value ? String(value).slice(0, 5) : "—";
  const toNumber = (value) => Number.parseFloat(value || 0);
  const normalizePhone = (raw) => String(raw || "").replace(/[^0-9]/g, "");
  const escapeHtml = (str) => String(str ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));

  function toast(message, type = "default") {
    const el = $("#toast");
    el.textContent = message;
    el.className = `toast show ${type}`;
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => el.classList.remove("show"), 3600);
  }

  function setView(viewId) {
    $$(".view").forEach(view => view.classList.remove("active"));
    $(viewId).classList.add("active");
  }

  function getScheduledDateTime(shift, field = "scheduled_start") {
    const time = shift[field] || "00:00";
    return new Date(`${shift.shift_date}T${time.length === 5 ? `${time}:00` : time}`);
  }

  function diffMinutes(dateA, dateB) {
    return Math.round((dateA.getTime() - dateB.getTime()) / 60000);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function latestEventForShift(shiftId) {
    return state.events
      .filter(event => event.shift_id === shiftId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
  }

  function getShiftStatus(shift, event = latestEventForShift(shift.id), at = new Date()) {
    const start = getScheduledDateTime(shift, "scheduled_start");
    const grace = Number(shift.grace_minutes ?? 10);
    const absentAfter = Number(shift.absence_after_minutes ?? 30);

    if (event) {
      if (event.event_type === "absent") return { key: "absent", label: "Ausente informado", className: "status-absent" };
      if (event.event_type === "late") return { key: "late", label: "Demora informada", className: "status-late" };
      if (event.event_type === "present") {
        if (event.is_inside_site === false) return { key: "outside", label: "Presente fuera de radio", className: "status-outside" };
        if (event.observed_status === "late") return { key: "late", label: "Presente tarde", className: "status-late" };
        return { key: "present", label: "Presente", className: "status-present" };
      }
    }

    const elapsed = diffMinutes(at, start);
    if (elapsed < 0) return { key: "scheduled", label: "Pendiente", className: "status-ok" };
    if (elapsed <= grace) return { key: "on_window", label: "En ventana horaria", className: "status-ok" };
    if (elapsed <= absentAfter) return { key: "late", label: "Demorado", className: "status-late" };
    return { key: "absent", label: "Ausente", className: "status-absent" };
  }

  function buildWhatsAppMessage(shift, status) {
    const operator = byId(state.profiles, shift.operator_id);
    const site = byId(state.sites, shift.site_id);
    const company = CONFIG.COMPANY_NAME || "Clean It";
    const base = `Buen día. Les informamos desde ${company} el estado del servicio de hoy en ${site?.name || "el consorcio"}.`;
    const name = operator?.full_name || "el operario asignado";

    if (["present", "outside"].includes(status.key)) {
      return `${base}\n\nEl operario ${name} ya registró presencia para el horario de ${formatTime(shift.scheduled_start)}.\n\nCualquier novedad quedamos atentos.`;
    }
    if (status.key === "late") {
      return `${base}\n\nEl operario ${name} figura demorado para el horario de ingreso previsto (${formatTime(shift.scheduled_start)}). Estamos haciendo seguimiento operativo y les avisaremos cualquier actualización.\n\nDisculpen las molestias.`;
    }
    if (status.key === "absent") {
      return `${base}\n\nEl operario ${name} aún no registró presencia para el horario previsto (${formatTime(shift.scheduled_start)}). Estamos gestionando la situación de forma prioritaria para resolverlo cuanto antes.\n\nDisculpen las molestias.`;
    }
    return `${base}\n\nEl servicio está programado para las ${formatTime(shift.scheduled_start)}. Ante cualquier novedad, les informamos por este medio.`;
  }

  function whatsappUrl(phone, message) {
    const normalized = normalizePhone(phone);
    if (!normalized) return "#";
    return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  }

  async function refreshBaseData(date = $("#dashboardDate")?.value || todayISO()) {
    const [profiles, sites, shifts, events] = await Promise.all([
      store.listProfiles(),
      store.listSites(),
      store.listShifts(date),
      store.listEvents()
    ]);
    state.profiles = profiles;
    state.sites = sites;
    state.shifts = shifts;
    state.events = events;
  }

  function renderConnectionMode() {
    const pill = $("#connectionPill");
    const isSupabase = store.mode === "supabase";
    pill.textContent = isSupabase ? "Supabase conectado" : "Modo local";
    pill.classList.toggle("status-present", isSupabase);
    pill.classList.toggle("status-pending", !isSupabase);
    $("#localLoginForm").classList.toggle("hidden", isSupabase);
    $("#supabaseLoginForm").classList.toggle("hidden", !isSupabase);
  }

  function renderLoginMode() {
    $$("[data-login-mode]").forEach(btn => btn.classList.toggle("active", btn.dataset.loginMode === state.loginMode));
  }

  async function handleLocalLogin(event) {
    event.preventDefault();
    try {
      const pin = $("#localPin").value.trim();
      const { user, profile } = await store.loginWithPin(pin, state.loginMode);
      state.currentUser = user;
      state.currentProfile = profile;
      await afterLogin();
    } catch (error) {
      toast(error.message || "No se pudo ingresar.");
    }
  }

  async function handleSupabaseLogin(event) {
    event.preventDefault();
    try {
      const email = $("#email").value.trim();
      const password = $("#password").value;
      const { user, profile } = await store.loginWithEmail(email, password, state.loginMode);
      state.currentUser = user;
      state.currentProfile = profile;
      await afterLogin();
    } catch (error) {
      toast(error.message || "No se pudo ingresar con Supabase.");
    }
  }

  async function afterLogin() {
    if (state.currentProfile.role === "operator") {
      setView("#operatorView");
      await renderOperatorView();
    } else {
      setView("#supervisorView");
      $("#dashboardDate").value = todayISO();
      $("#shiftDate").value = todayISO();
      await renderSupervisorView();
    }
  }

  async function logout() {
    await store.signOut();
    state.currentUser = null;
    state.currentProfile = null;
    setView("#loginView");
  }

  async function renderOperatorView() {
    const today = todayISO();
    await refreshBaseData(today);
    $("#operatorTitle").textContent = `Hola, ${state.currentProfile.full_name}`;
    const shifts = state.shifts.filter(shift => shift.operator_id === state.currentProfile.id);
    const container = $("#operatorShiftContainer");

    if (!shifts.length) {
      container.innerHTML = `
        <div class="operator-card">
          <h3>No tenés servicios cargados para hoy</h3>
          <p class="muted">Si esto es incorrecto, avisá al supervisor. La app no puede registrar presencia sobre un servicio no asignado.</p>
        </div>`;
      return;
    }

    container.innerHTML = shifts.map(shift => renderOperatorShiftCard(shift)).join("");

    container.querySelectorAll("[data-checkin]").forEach(btn => btn.addEventListener("click", () => handleCheckin(btn.dataset.checkin)));
    container.querySelectorAll("[data-late]").forEach(btn => btn.addEventListener("click", () => handleManualStatus(btn.dataset.late, "late")));
    container.querySelectorAll("[data-absent]").forEach(btn => btn.addEventListener("click", () => handleManualStatus(btn.dataset.absent, "absent")));
  }

  function renderOperatorShiftCard(shift) {
    const site = byId(state.sites, shift.site_id);
    const event = latestEventForShift(shift.id);
    const status = getShiftStatus(shift, event);
    const start = formatTime(shift.scheduled_start);
    const end = formatTime(shift.scheduled_end);
    const last = event ? `Último registro: ${formatDateTime(event.created_at)}` : "Sin marcación registrada";

    return `
      <article class="operator-card main-checkin">
        <div class="card-title-row">
          <div>
            <p class="eyebrow">${escapeHtml(start)} a ${escapeHtml(end)}</p>
            <h3 class="service-title">${escapeHtml(site?.name || "Servicio sin nombre")}</h3>
            <p class="muted">${escapeHtml(site?.address || "Sin dirección cargada")}</p>
          </div>
          <span class="status-pill ${status.className}">${status.label}</span>
        </div>

        <div class="meta-grid">
          <div class="meta-item"><strong>Radio permitido</strong><span>${site?.gps_radius_m || 0} m</span></div>
          <div class="meta-item"><strong>Registro</strong><span>${escapeHtml(last)}</span></div>
          ${event ? `<div class="meta-item"><strong>Precisión GPS</strong><span>${event.gps_accuracy_m ? `${Math.round(event.gps_accuracy_m)} m` : "—"}</span></div>` : ""}
          ${event ? `<div class="meta-item"><strong>Distancia al servicio</strong><span>${event.distance_m ? `${Math.round(event.distance_m)} m` : "—"}</span></div>` : ""}
        </div>

        <div class="checkin-box">
          <label class="checkbox-row">
            <input type="checkbox" id="confirm-${shift.id}" />
            <span>
              <strong>Confirmo que estoy presente en el servicio</strong><br />
              <span class="muted small">Al tocar el botón se registra hora, ubicación GPS, precisión y distancia contra el punto cargado.</span>
            </span>
          </label>
          <label>
            <span>Observación opcional</span>
            <textarea id="notes-${shift.id}" placeholder="Ej. Ingreso normal / Demora por transporte / Encargado no abrió..."></textarea>
          </label>
          <button class="primary-btn big-action" data-checkin="${shift.id}" type="button">Marcar presencia con GPS</button>
          <div class="quick-actions">
            <button class="secondary-btn" data-late="${shift.id}" type="button">Informar demora</button>
            <button class="danger-btn" data-absent="${shift.id}" type="button">Informar ausencia</button>
          </div>
        </div>
      </article>`;
  }

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Este dispositivo no permite geolocalización."));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0
      });
    });
  }

  async function handleCheckin(shiftId) {
    const shift = state.shifts.find(s => s.id === shiftId);
    const site = byId(state.sites, shift.site_id);
    const checkbox = $(`#confirm-${CSS.escape(shiftId)}`);
    const notes = $(`#notes-${CSS.escape(shiftId)}`)?.value || "";

    if (!checkbox?.checked) {
      toast("Primero marcá el checkbox de confirmación.");
      return;
    }

    try {
      toast("Solicitando GPS de alta precisión...");
      const position = await getPosition();
      const { latitude, longitude, accuracy } = position.coords;
      const distance = haversineMeters(latitude, longitude, Number(site.lat), Number(site.lng));
      const isInside = distance <= Number(site.gps_radius_m || 100);
      const start = getScheduledDateTime(shift);
      const elapsed = diffMinutes(new Date(), start);
      const observedStatus = elapsed > Number(shift.grace_minutes || 10) ? "late" : "present";

      await store.createEvent({
        shift_id: shift.id,
        operator_id: shift.operator_id,
        site_id: shift.site_id,
        event_type: "present",
        observed_status: observedStatus,
        notes,
        lat: latitude,
        lng: longitude,
        gps_accuracy_m: accuracy,
        distance_m: distance,
        is_inside_site: isInside,
        client_time: new Date().toISOString()
      });

      toast(isInside ? "Presencia registrada correctamente." : "Presencia registrada, pero fuera del radio permitido.");
      await renderOperatorView();
    } catch (error) {
      toast(error.message || "No se pudo obtener ubicación GPS.");
    }
  }

  async function handleManualStatus(shiftId, eventType) {
    const shift = state.shifts.find(s => s.id === shiftId);
    const notes = $(`#notes-${CSS.escape(shiftId)}`)?.value || "";
    const label = eventType === "late" ? "demora" : "ausencia";
    try {
      await store.createEvent({
        shift_id: shift.id,
        operator_id: shift.operator_id,
        site_id: shift.site_id,
        event_type: eventType,
        observed_status: eventType,
        notes,
        client_time: new Date().toISOString()
      });
      toast(`Se informó ${label}.`);
      await renderOperatorView();
    } catch (error) {
      toast(error.message || `No se pudo informar ${label}.`);
    }
  }

  async function renderSupervisorView() {
    const date = $("#dashboardDate").value || todayISO();
    await refreshBaseData(date);
    renderTab(state.activeTab);
    renderDashboard();
    renderSites();
    renderShiftSelectors();
    renderShifts();
    renderOperators();
    renderRecords();
  }

  function renderTab(tab) {
    state.activeTab = tab;
    $$(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
    $(`#${tab}Tab`).classList.add("active");
  }

  function renderDashboard() {
    const rows = state.shifts.map(shift => {
      const event = latestEventForShift(shift.id);
      return { shift, event, status: getShiftStatus(shift, event) };
    });
    const counts = rows.reduce((acc, row) => {
      acc.total++;
      if (["present"].includes(row.status.key)) acc.present++;
      else if (["late", "outside"].includes(row.status.key)) acc.late++;
      else if (row.status.key === "absent") acc.absent++;
      else acc.pending++;
      return acc;
    }, { total: 0, present: 0, late: 0, absent: 0, pending: 0 });

    $("#kpiGrid").innerHTML = `
      ${kpi("Turnos", counts.total)}
      ${kpi("Presentes", counts.present, "status-present")}
      ${kpi("Demorados / fuera de radio", counts.late, "status-late")}
      ${kpi("Ausentes", counts.absent, "status-absent")}
    `;

    const tableRows = rows.map(({ shift, event, status }) => {
      const operator = byId(state.profiles, shift.operator_id);
      const site = byId(state.sites, shift.site_id);
      const message = buildWhatsAppMessage(shift, status);
      const url = whatsappUrl(site?.whatsapp_phone, message);
      return `
        <tr>
          <td><strong>${escapeHtml(operator?.full_name || "—")}</strong><br><span class="muted small">${escapeHtml(operator?.phone || "")}</span></td>
          <td><strong>${escapeHtml(site?.name || "—")}</strong><br><span class="muted small">${escapeHtml(site?.address || "")}</span></td>
          <td>${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span></td>
          <td>${event ? formatDateTime(event.created_at) : "—"}</td>
          <td>${event?.gps_accuracy_m ? `${Math.round(event.gps_accuracy_m)} m` : "—"}</td>
          <td>${event?.distance_m ? `${Math.round(event.distance_m)} m` : "—"}</td>
          <td class="row-actions">
            <a class="wa-btn" href="${url}" target="_blank" rel="noopener">WhatsApp consorcio</a>
          </td>
        </tr>`;
    }).join("");

    $("#liveTable").innerHTML = `
      <table>
        <thead>
          <tr><th>Operario</th><th>Servicio</th><th>Horario</th><th>Estado</th><th>Último registro</th><th>Precisión</th><th>Distancia</th><th>Acción</th></tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="8">No hay turnos cargados para esta fecha.</td></tr>`}</tbody>
      </table>`;
    $("#lastRefreshLabel").textContent = `Actualizado ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function kpi(label, value, className = "") {
    return `<div class="summary-card ${className}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
  }

  function renderSites() {
    const list = $("#sitesList");
    list.innerHTML = state.sites.map(site => `
      <div class="list-item">
        <div class="list-item-head">
          <div>
            <div class="list-item-title">${escapeHtml(site.name)}</div>
            <div class="muted small">${escapeHtml(site.address)}</div>
            <div class="muted small">GPS: ${site.lat}, ${site.lng} · Radio ${site.gps_radius_m} m</div>
            <div class="muted small">WhatsApp: ${escapeHtml(site.whatsapp_name || "—")} · ${escapeHtml(site.whatsapp_phone || "—")}</div>
          </div>
        </div>
        <div class="list-item-actions">
          <button class="secondary-btn small-btn" data-edit-site="${site.id}" type="button">Editar</button>
          <button class="danger-btn small-btn" data-delete-site="${site.id}" type="button">Eliminar</button>
        </div>
      </div>`).join("") || `<p class="muted">No hay servicios cargados.</p>`;

    list.querySelectorAll("[data-edit-site]").forEach(btn => btn.addEventListener("click", () => editSite(btn.dataset.editSite)));
    list.querySelectorAll("[data-delete-site]").forEach(btn => btn.addEventListener("click", () => deleteSite(btn.dataset.deleteSite)));
  }

  function sitePayloadFromForm() {
    const id = $("#siteId").value || undefined;
    return {
      ...(id ? { id } : {}),
      name: $("#siteName").value.trim(),
      address: $("#siteAddress").value.trim(),
      lat: toNumber($("#siteLat").value),
      lng: toNumber($("#siteLng").value),
      gps_radius_m: Number($("#siteRadius").value || 120),
      whatsapp_name: $("#siteContactName").value.trim(),
      whatsapp_phone: $("#siteWhatsapp").value.trim(),
      is_active: true
    };
  }

  function resetSiteForm() {
    $("#siteForm").reset();
    $("#siteId").value = "";
    $("#siteRadius").value = 120;
    $("#siteFormTitle").textContent = "Nuevo servicio / consorcio";
    $("#cancelSiteEditBtn").classList.add("hidden");
  }

  function editSite(id) {
    const site = byId(state.sites, id);
    if (!site) return;
    $("#siteId").value = site.id;
    $("#siteName").value = site.name || "";
    $("#siteAddress").value = site.address || "";
    $("#siteLat").value = site.lat || "";
    $("#siteLng").value = site.lng || "";
    $("#siteRadius").value = site.gps_radius_m || 120;
    $("#siteContactName").value = site.whatsapp_name || "";
    $("#siteWhatsapp").value = site.whatsapp_phone || "";
    $("#siteFormTitle").textContent = "Editar servicio / consorcio";
    $("#cancelSiteEditBtn").classList.remove("hidden");
  }

  async function deleteSite(id) {
    if (!window.confirm("¿Eliminar este servicio?")) return;
    await store.deleteSite(id);
    toast("Servicio eliminado.");
    await renderSupervisorView();
  }

  function renderShiftSelectors() {
    const operators = state.profiles.filter(p => p.role === "operator");
    $("#shiftOperator").innerHTML = operators.map(op => `<option value="${op.id}">${escapeHtml(op.full_name)}</option>`).join("");
    $("#shiftSite").innerHTML = state.sites.map(site => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join("");
  }

  function renderShifts() {
    const list = $("#shiftsList");
    const allVisibleShifts = state.shifts.slice().sort((a, b) => `${a.shift_date} ${a.scheduled_start}`.localeCompare(`${b.shift_date} ${b.scheduled_start}`));
    list.innerHTML = allVisibleShifts.map(shift => {
      const op = byId(state.profiles, shift.operator_id);
      const site = byId(state.sites, shift.site_id);
      return `
        <div class="list-item">
          <div class="list-item-title">${escapeHtml(op?.full_name || "—")}</div>
          <div class="muted small">${escapeHtml(site?.name || "—")} · ${shift.shift_date} · ${formatTime(shift.scheduled_start)} a ${formatTime(shift.scheduled_end)}</div>
          <div class="muted small">Tolerancia: ${shift.grace_minutes} min · Ausente desde: ${shift.absence_after_minutes} min</div>
          <div class="list-item-actions">
            <button class="secondary-btn small-btn" data-edit-shift="${shift.id}" type="button">Editar</button>
            <button class="danger-btn small-btn" data-delete-shift="${shift.id}" type="button">Eliminar</button>
          </div>
        </div>`;
    }).join("") || `<p class="muted">No hay turnos para la fecha seleccionada.</p>`;

    list.querySelectorAll("[data-edit-shift]").forEach(btn => btn.addEventListener("click", () => editShift(btn.dataset.editShift)));
    list.querySelectorAll("[data-delete-shift]").forEach(btn => btn.addEventListener("click", () => deleteShift(btn.dataset.deleteShift)));
  }

  function shiftPayloadFromForm() {
    const id = $("#shiftId").value || undefined;
    return {
      ...(id ? { id } : {}),
      shift_date: $("#shiftDate").value,
      operator_id: $("#shiftOperator").value,
      site_id: $("#shiftSite").value,
      scheduled_start: $("#shiftStart").value,
      scheduled_end: $("#shiftEnd").value,
      grace_minutes: Number($("#shiftGrace").value || 10),
      absence_after_minutes: Number($("#shiftAbsentAfter").value || 30),
      is_active: true
    };
  }

  function resetShiftForm() {
    $("#shiftForm").reset();
    $("#shiftId").value = "";
    $("#shiftDate").value = $("#dashboardDate").value || todayISO();
    $("#shiftGrace").value = 10;
    $("#shiftAbsentAfter").value = 30;
    $("#shiftFormTitle").textContent = "Nuevo turno";
    $("#cancelShiftEditBtn").classList.add("hidden");
  }

  function editShift(id) {
    const shift = byId(state.shifts, id);
    if (!shift) return;
    $("#shiftId").value = shift.id;
    $("#shiftDate").value = shift.shift_date || todayISO();
    $("#shiftOperator").value = shift.operator_id;
    $("#shiftSite").value = shift.site_id;
    $("#shiftStart").value = formatTime(shift.scheduled_start);
    $("#shiftEnd").value = formatTime(shift.scheduled_end);
    $("#shiftGrace").value = shift.grace_minutes || 10;
    $("#shiftAbsentAfter").value = shift.absence_after_minutes || 30;
    $("#shiftFormTitle").textContent = "Editar turno";
    $("#cancelShiftEditBtn").classList.remove("hidden");
  }

  async function deleteShift(id) {
    if (!window.confirm("¿Eliminar este turno?")) return;
    await store.deleteShift(id);
    toast("Turno eliminado.");
    await renderSupervisorView();
  }

  function renderOperators() {
    const list = $("#operatorsList");
    const operators = state.profiles.filter(p => p.role === "operator");
    list.innerHTML = operators.map(op => `
      <div class="list-item">
        <div class="list-item-title">${escapeHtml(op.full_name)}</div>
        <div class="muted small">${escapeHtml(op.phone || "Sin teléfono")}</div>
        <div class="muted small">ID: ${escapeHtml(op.id)}</div>
        <div class="list-item-actions">
          <button class="secondary-btn small-btn" data-edit-operator="${op.id}" type="button">Editar</button>
          <button class="danger-btn small-btn" data-delete-operator="${op.id}" type="button">Eliminar</button>
        </div>
      </div>`).join("") || `<p class="muted">No hay operarios cargados.</p>`;

    list.querySelectorAll("[data-edit-operator]").forEach(btn => btn.addEventListener("click", () => editOperator(btn.dataset.editOperator)));
    list.querySelectorAll("[data-delete-operator]").forEach(btn => btn.addEventListener("click", () => deleteOperator(btn.dataset.deleteOperator)));
  }

  function operatorPayloadFromForm() {
    const id = $("#operatorId").value || $("#operatorAuthId").value.trim() || undefined;
    return {
      ...(id ? { id } : {}),
      full_name: $("#operatorName").value.trim(),
      phone: $("#operatorPhone").value.trim(),
      pin: $("#operatorPin").value.trim(),
      role: "operator",
      is_active: true
    };
  }

  function resetOperatorForm() {
    $("#operatorForm").reset();
    $("#operatorId").value = "";
    $("#operatorAuthId").value = "";
    $("#operatorFormTitle").textContent = "Operario demo/local";
    $("#cancelOperatorEditBtn").classList.add("hidden");
  }

  function editOperator(id) {
    const op = byId(state.profiles, id);
    if (!op) return;
    $("#operatorId").value = op.id;
    $("#operatorAuthId").value = op.id || "";
    $("#operatorName").value = op.full_name || "";
    $("#operatorPhone").value = op.phone || "";
    $("#operatorPin").value = op.pin || "";
    $("#operatorFormTitle").textContent = "Editar operario";
    $("#cancelOperatorEditBtn").classList.remove("hidden");
  }

  async function deleteOperator(id) {
    if (!window.confirm("¿Eliminar este operario?")) return;
    await store.deleteProfile(id);
    toast("Operario eliminado.");
    await renderSupervisorView();
  }

  function renderRecords() {
    const rows = state.events.map(event => {
      const op = byId(state.profiles, event.operator_id);
      const site = byId(state.sites, event.site_id);
      const shift = byId(state.shifts, event.shift_id) || {};
      return `
        <tr>
          <td>${formatDateTime(event.created_at)}</td>
          <td>${escapeHtml(op?.full_name || event.operator_id || "—")}</td>
          <td>${escapeHtml(site?.name || event.site_id || "—")}</td>
          <td>${escapeHtml(event.event_type || "—")}</td>
          <td>${event.lat ? `${Number(event.lat).toFixed(6)}, ${Number(event.lng).toFixed(6)}` : "—"}</td>
          <td>${event.gps_accuracy_m ? `${Math.round(event.gps_accuracy_m)} m` : "—"}</td>
          <td>${event.distance_m ? `${Math.round(event.distance_m)} m` : "—"}</td>
          <td>${event.is_inside_site === true ? "Sí" : event.is_inside_site === false ? "No" : "—"}</td>
          <td>${escapeHtml(event.notes || "")}</td>
        </tr>`;
    }).join("");

    $("#recordsTable").innerHTML = `
      <table>
        <thead><tr><th>Hora</th><th>Operario</th><th>Servicio</th><th>Tipo</th><th>GPS</th><th>Precisión</th><th>Distancia</th><th>Dentro radio</th><th>Obs.</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9">Todavía no hay marcaciones.</td></tr>`}</tbody>
      </table>`;
  }

  function exportCsv() {
    const header = ["fecha_hora", "operario", "servicio", "tipo", "estado", "lat", "lng", "precision_m", "distancia_m", "dentro_radio", "observacion"];
    const lines = state.events.map(event => {
      const op = byId(state.profiles, event.operator_id);
      const site = byId(state.sites, event.site_id);
      const values = [
        event.created_at,
        op?.full_name || event.operator_id || "",
        site?.name || event.site_id || "",
        event.event_type || "",
        event.observed_status || "",
        event.lat || "",
        event.lng || "",
        event.gps_accuracy_m || "",
        event.distance_m || "",
        event.is_inside_site === true ? "si" : event.is_inside_site === false ? "no" : "",
        event.notes || ""
      ];
      return values.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `presentismo-cleanit-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    $$("[data-login-mode]").forEach(btn => btn.addEventListener("click", () => {
      state.loginMode = btn.dataset.loginMode;
      renderLoginMode();
    }));
    $("#localLoginForm").addEventListener("submit", handleLocalLogin);
    $("#supabaseLoginForm").addEventListener("submit", handleSupabaseLogin);
    $("#operatorLogoutBtn").addEventListener("click", logout);
    $("#supervisorLogoutBtn").addEventListener("click", logout);
    $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => renderTab(btn.dataset.tab)));
    $("#refreshDashboardBtn").addEventListener("click", renderSupervisorView);
    $("#dashboardDate").addEventListener("change", renderSupervisorView);

    $("#siteForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await store.upsertSite(sitePayloadFromForm());
      resetSiteForm();
      toast("Servicio guardado.");
      await renderSupervisorView();
    });
    $("#cancelSiteEditBtn").addEventListener("click", resetSiteForm);

    $("#shiftForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await store.upsertShift(shiftPayloadFromForm());
      resetShiftForm();
      toast("Turno guardado.");
      await renderSupervisorView();
    });
    $("#cancelShiftEditBtn").addEventListener("click", resetShiftForm);

    $("#operatorForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await store.upsertProfile(operatorPayloadFromForm());
      resetOperatorForm();
      toast("Operario guardado.");
      await renderSupervisorView();
    });
    $("#cancelOperatorEditBtn").addEventListener("click", resetOperatorForm);
    $("#exportCsvBtn").addEventListener("click", exportCsv);
  }

  function init() {
    renderConnectionMode();
    renderLoginMode();
    $("#dashboardDate").value = todayISO();
    $("#shiftDate").value = todayISO();
    bindEvents();
  }

  init();
})();
