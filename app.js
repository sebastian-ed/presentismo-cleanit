(function () {
  const CONFIG = window.APP_CONFIG || {};
  const store = window.StoreFactory.create();

  const DAYS = [
    { id: 1, short: "Lun", long: "Lunes" },
    { id: 2, short: "Mar", long: "Martes" },
    { id: 3, short: "Mié", long: "Miércoles" },
    { id: 4, short: "Jue", long: "Jueves" },
    { id: 5, short: "Vie", long: "Viernes" },
    { id: 6, short: "Sáb", long: "Sábado" },
    { id: 7, short: "Dom", long: "Domingo" }
  ];

  const state = {
    loginMode: "operator",
    currentUser: null,
    currentProfile: null,
    sites: [],
    profiles: [],
    assignments: [],
    shifts: [],
    events: [],
    dashboardRows: [],
    activeTab: "live"
  };

  let attendanceMapInstance = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const todayDayId = () => { const d = new Date().getDay(); return d === 0 ? 7 : d; };
  const byId = (items, id) => items.find(item => item.id === id);
  const formatDateTime = (value) => value ? new Date(value).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "—";
  const formatTime = (value) => value ? String(value).slice(0, 5) : "—";
  const toNumber = (value) => Number.parseFloat(value || 0);
  const normalizePhone = (raw) => String(raw || "").replace(/[^0-9]/g, "");
  const escapeHtml = (str) => String(str ?? "").replace(/[&<>'"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const dayLabel = (id, variant = "short") => DAYS.find(d => d.id === Number(id))?.[variant] || id;

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

  function shiftEvents(shiftId) {
    return state.events
      .filter(event => event.shift_id === shiftId)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  function latestEventForShift(shiftId, types = null) {
    const events = shiftEvents(shiftId);
    if (!types) return events[0];
    const allowed = Array.isArray(types) ? types : [types];
    return events.find(event => allowed.includes(event.event_type));
  }

  function getEntryEvent(shift) {
    return latestEventForShift(shift.id, "present");
  }

  function getExitEvent(shift) {
    return latestEventForShift(shift.id, "checkout");
  }

  function getManualEvent(shift) {
    return latestEventForShift(shift.id, ["late", "absent"]);
  }

  function getEntryStatus(shift, entryEvent = getEntryEvent(shift), manualEvent = getManualEvent(shift), at = new Date()) {
    const start = getScheduledDateTime(shift, "scheduled_start");
    const grace = Number(shift.grace_minutes ?? 10);
    const absentAfter = Number(shift.absence_after_minutes ?? 30);

    if (entryEvent) {
      if (entryEvent.is_inside_site === false) return { key: "outside", label: "Entrada fuera de radio", className: "status-outside" };
      if (entryEvent.observed_status === "late") return { key: "late", label: "Entrada tarde", className: "status-late" };
      return { key: "present", label: "Entrada registrada", className: "status-present" };
    }

    if (manualEvent?.event_type === "absent") return { key: "absent", label: "Ausente registrado", className: "status-absent" };

    const elapsed = diffMinutes(at, start);
    if (elapsed < 0) return { key: "scheduled", label: "Pendiente", className: "status-ok" };
    if (elapsed <= grace) return { key: "on_window", label: "En ventana horaria", className: "status-ok" };
    if (elapsed > absentAfter) {
      return {
        key: "absent",
        label: manualEvent?.event_type === "late" ? "Ausente tras demora" : "Ausente",
        className: "status-absent"
      };
    }
    if (manualEvent?.event_type === "late") return { key: "late", label: "Demora informada", className: "status-late" };
    return { key: "late", label: "Demorado", className: "status-late" };
  }

  function getAutomaticAbsenceTime(shift) {
    const start = getScheduledDateTime(shift, "scheduled_start");
    return new Date(start.getTime() + Number(shift.absence_after_minutes ?? 30) * 60000);
  }

  function shouldCreateAutomaticAbsence(shift, at = new Date()) {
    if (getEntryEvent(shift)) return false;
    if (latestEventForShift(shift.id, "absent")) return false;
    return at.getTime() > getAutomaticAbsenceTime(shift).getTime();
  }

  function getExitStatus(shift, entryEvent = getEntryEvent(shift), exitEvent = getExitEvent(shift), at = new Date()) {
    const end = getScheduledDateTime(shift, "scheduled_end");
    const grace = Number(shift.grace_minutes ?? 10);

    if (exitEvent) {
      if (exitEvent.is_inside_site === false) return { key: "exit_outside", label: "Salida fuera de radio", className: "status-outside" };
      if (exitEvent.observed_status === "early_exit") return { key: "early_exit", label: "Salida anticipada", className: "status-late" };
      return { key: "completed", label: "Salida registrada", className: "status-present" };
    }

    if (!entryEvent) return { key: "not_started", label: "Sin entrada", className: "status-pending" };

    const minutesAfterEnd = diffMinutes(at, end);
    if (minutesAfterEnd < 0) return { key: "in_service", label: "En servicio", className: "status-ok" };
    if (minutesAfterEnd <= grace) return { key: "exit_due", label: "Debe registrar salida", className: "status-late" };
    return { key: "missing_exit", label: "Salida no registrada", className: "status-absent" };
  }

  function getShiftStatus(shift, at = new Date()) {
    const entryEvent = getEntryEvent(shift);
    const exitEvent = getExitEvent(shift);
    const manualEvent = getManualEvent(shift);
    const entryStatus = getEntryStatus(shift, entryEvent, manualEvent, at);
    const exitStatus = getExitStatus(shift, entryEvent, exitEvent, at);

    if (["completed", "early_exit", "exit_outside", "missing_exit", "exit_due"].includes(exitStatus.key)) return exitStatus;
    if (entryEvent && exitStatus.key === "in_service") return { key: "in_service", label: "En servicio", className: "status-present" };
    return entryStatus;
  }

  function eventTypeLabel(type) {
    const labels = {
      present: "Entrada",
      checkout: "Salida",
      late: "Demora",
      absent: "Ausencia"
    };
    return labels[type] || type || "—";
  }

  function observedStatusLabel(status) {
    const labels = {
      present: "En horario",
      late: "Tarde",
      absent: "Ausente",
      on_time_exit: "Salida correcta",
      early_exit: "Salida anticipada"
    };
    return labels[status] || status || "—";
  }

  function gpsSummary(event) {
    if (!event) return "—";
    const precision = event.gps_accuracy_m ? `Prec. ${Math.round(event.gps_accuracy_m)} m` : "Prec. —";
    const distance = event.distance_m ? `Dist. ${Math.round(event.distance_m)} m` : "Dist. —";
    return `${precision} · ${distance}`;
  }

  function buildWhatsAppMessage(shift, status) {
    const operator = byId(state.profiles, shift.operator_id);
    const site = byId(state.sites, shift.site_id);
    const company = CONFIG.COMPANY_NAME || "Clean It";
    const base = `Buen día. Les informamos desde ${company} el estado del servicio de hoy en ${site?.name || "el consorcio"}.`;
    const name = operator?.full_name || "el operario asignado";

    if (["present", "in_service", "outside"].includes(status.key)) {
      return `${base}\n\nEl operario ${name} ya registró entrada para el horario de ${formatTime(shift.scheduled_start)} a ${formatTime(shift.scheduled_end)}.\n\nCualquier novedad quedamos atentos.`;
    }
    if (status.key === "completed") {
      return `${base}\n\nEl operario ${name} registró la salida del servicio correspondiente al horario de ${formatTime(shift.scheduled_start)} a ${formatTime(shift.scheduled_end)}.\n\nQuedamos atentos ante cualquier novedad.`;
    }
    if (status.key === "early_exit") {
      return `${base}\n\nDetectamos una salida anticipada del operario ${name} respecto del horario previsto de finalización (${formatTime(shift.scheduled_end)}). Estamos revisando la situación operativa.\n\nDisculpen las molestias.`;
    }
    if (status.key === "missing_exit") {
      return `${base}\n\nEl operario ${name} todavía no registró salida del servicio, cuyo horario de finalización previsto era ${formatTime(shift.scheduled_end)}. Estamos verificando el estado operativo.\n\nCualquier novedad la informamos por este medio.`;
    }
    if (status.key === "late") {
      return `${base}\n\nEl operario ${name} figura demorado para el horario de ingreso previsto (${formatTime(shift.scheduled_start)}). Estamos haciendo seguimiento operativo y les avisaremos cualquier actualización.\n\nDisculpen las molestias.`;
    }
    if (status.key === "absent") {
      return `${base}\n\nEl operario ${name} aún no registró entrada para el horario previsto (${formatTime(shift.scheduled_start)}). Estamos gestionando la situación de forma prioritaria para resolverlo cuanto antes.\n\nDisculpen las molestias.`;
    }
    return `${base}\n\nEl servicio está programado para las ${formatTime(shift.scheduled_start)}. Ante cualquier novedad, les informamos por este medio.`;
  }

  function whatsappUrl(phone, message) {
    const normalized = normalizePhone(phone);
    if (!normalized) return "#";
    return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  }

  async function refreshBaseData(date = $("#dashboardDate")?.value || todayISO()) {
    const [profiles, sites, assignments, shifts, events] = await Promise.all([
      store.listProfiles(),
      store.listSites(),
      store.listAssignments(),
      store.listShifts(date),
      store.listEvents()
    ]);
    state.profiles = profiles;
    state.sites = sites;
    state.assignments = assignments;
    state.shifts = shifts;
    state.events = events;
  }

  function renderConnectionMode() {
    // Connection pill removed — no technical UI exposed to users
  }

  function isManagementProfile(profile = state.currentProfile) {
    const role = String(profile?.role || "").toLowerCase();
    return role === "supervisor" || role === "admin";
  }

  function profileMatchesLoginType(profile, expectedRole) {
    const role = String(profile?.role || "").toLowerCase();
    if (expectedRole === "operator") return role === "operator";
    if (expectedRole === "supervisor") return role === "supervisor" || role === "admin";
    return true;
  }

  function roleLabel(role) {
    const normalized = String(role || "").toLowerCase();
    if (normalized === "operator") return "operario";
    if (normalized === "admin") return "administrador";
    return "supervisor";
  }

  function renderLoginMode() {
    $$('[data-login-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.loginMode === state.loginMode));
    const isSupervisor = state.loginMode === "supervisor";
    const copy = $("#loginModeCopy");
    const emailLabel = $("#loginEmailLabel");
    const email = $("#email");
    const submit = $("#loginSubmitBtn");
    if (!copy || !emailLabel || !email || !submit) return;

    copy.innerHTML = isSupervisor
      ? `<p class="eyebrow">Acceso supervisor</p><h3>Panel de control</h3><p class="muted small no-margin">Permite ver estado en vivo y administrar servicios, usuarios y asignaciones.</p>`
      : `<p class="eyebrow">Acceso operario</p><h3>Marcar presencia</h3><p class="muted small no-margin">Ingresá tu nombre de usuario y DNI para registrar entrada o salida con GPS.</p>`;
    emailLabel.textContent = isSupervisor ? "Email del supervisor" : "Nombre de usuario";
    email.placeholder = isSupervisor ? "supervisor@cleanit.com" : "ej: arielacevedo";
    submit.textContent = isSupervisor ? "Ingresar como supervisor" : "Ingresar como operario";
    submit.className = isSupervisor ? "secondary-btn" : "primary-btn";
  }

  async function handleSupabaseLogin(event) {
    event.preventDefault();
    const emailInput = $("#email");
    const passwordInput = $("#password");
    const submitButton = $("#loginSubmitBtn");

    try {
      submitButton.disabled = true;
      const rawInput = emailInput.value.trim().toLowerCase().replace(/\s+/g, '');
      const email = state.loginMode === "operator" && !rawInput.includes("@")
        ? `${rawInput}@cleanit.ar`
        : rawInput;
      const password = passwordInput.value;
      const { user, profile } = await store.loginWithPassword(email, password);

      if (!profileMatchesLoginType(profile, state.loginMode)) {
        await store.signOut();
        throw new Error(`Este acceso es para ${roleLabel(state.loginMode)}s. El usuario ingresado tiene rol ${roleLabel(profile.role)}.`);
      }

      state.currentUser = user;
      state.currentProfile = profile;
      passwordInput.value = "";
      await afterLogin();
    } catch (error) {
      passwordInput.value = "";
      toast(error.message || "No se pudo ingresar.");
    } finally {
      submitButton.disabled = false;
    }
  }

  async function afterLogin() {
    if (state.currentProfile.role === "operator") {
      setView("#operatorView");
      await renderOperatorView();
    } else {
      setView("#supervisorView");
      $("#dashboardDate").value = todayISO();
      $("#assignmentValidFrom").value = todayISO();
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
    const [sites, events, assignments] = await Promise.all([store.listSites(), store.listEvents(), store.listAssignments()]);
    state.sites = sites;
    state.events = events;
    state.assignments = assignments;

    $("#operatorTitle").textContent = `Hola, ${state.currentProfile.full_name}`;

    const todayId = todayDayId();
    const todaysAssignments = state.assignments
      .filter(a =>
        a.operator_id === state.currentProfile.id &&
        a.is_active !== false &&
        (a.days_of_week || []).map(Number).includes(todayId)
      )
      .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)));

    const container = $("#operatorShiftContainer");

    if (todaysAssignments.length === 0) {
      const shiftId = `${state.currentProfile.id}__${today}`;
      const entryEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "present");
      const exitEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "checkout");
      container.innerHTML = renderGpsOnlyCard(shiftId, entryEvent, exitEvent, null);
      container.querySelector("[data-gps-checkin]")?.addEventListener("click", () => handleGpsCheckin(shiftId, null));
      container.querySelector("[data-gps-checkout]")?.addEventListener("click", () => handleGpsCheckout(shiftId));
      return;
    }

    container.innerHTML = todaysAssignments
      .map(assignment => {
        const shiftId = `${assignment.id}__${today}`;
        const entryEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "present");
        const exitEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "checkout");
        const assignedSite = byId(state.sites, assignment.site_id);
        return renderGpsOnlyCard(shiftId, entryEvent, exitEvent, assignedSite);
      })
      .join("");

    todaysAssignments.forEach(assignment => {
      const shiftId = `${assignment.id}__${today}`;
      container.querySelector(`[data-gps-checkin="${shiftId}"]`)?.addEventListener("click", () => handleGpsCheckin(shiftId, assignment));
      container.querySelector(`[data-gps-checkout="${shiftId}"]`)?.addEventListener("click", () => handleGpsCheckout(shiftId));
    });
  }

  function renderGpsOnlyCard(shiftId, entryEvent, exitEvent, assignedSite = null) {
    const checkedIn = Boolean(entryEvent);
    const checkedOut = Boolean(exitEvent);
    const detectedSite = entryEvent ? byId(state.sites, entryEvent.site_id) : null;
    const displaySite = detectedSite || assignedSite;

    const entryDisabled = checkedIn ? "disabled" : "";
    const exitDisabled = !checkedIn || checkedOut ? "disabled" : "";

    const entryInfo = entryEvent
      ? `${formatDateTime(entryEvent.created_at)} · ${gpsSummary(entryEvent)}`
      : "Sin entrada registrada";
    const exitInfo = exitEvent
      ? `${formatDateTime(exitEvent.created_at)} · ${gpsSummary(exitEvent)}`
      : "Sin salida registrada";

    let statusLabel, statusClass;
    if (checkedOut) { statusLabel = "Servicio completado"; statusClass = "status-present"; }
    else if (checkedIn) { statusLabel = "En servicio"; statusClass = "status-ok"; }
    else { statusLabel = "Sin marcar"; statusClass = "status-pending"; }

    const dateLabel = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

    return `
      <article class="operator-card main-checkin">
        <div class="card-title-row">
          <div>
            <p class="eyebrow">Hoy · ${escapeHtml(dateLabel)}</p>
            <h3 class="service-title">${displaySite ? escapeHtml(displaySite.name) : "Sin servicio asignado para hoy"}</h3>
            <p class="muted">${displaySite ? escapeHtml(displaySite.address || "") : "Contactá al supervisor si creés que hay un error."}</p>
          </div>
          <span class="status-pill ${statusClass}">${statusLabel}</span>
        </div>

        <div class="meta-grid">
          <div class="meta-item"><strong>Entrada</strong><span class="meta-subline">${entryInfo}</span></div>
          <div class="meta-item"><strong>Salida</strong><span class="meta-subline">${exitInfo}</span></div>
        </div>

        <div class="checkin-box">
          <div class="checkpoint-title-row">
            <strong>Entrada al servicio</strong>
            <span class="status-pill ${checkedIn ? "status-present" : "status-pending"}">${checkedIn ? "Registrada" : "Pendiente"}</span>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="confirm-in-${escapeHtml(shiftId)}" ${entryDisabled} />
            <span>
              <strong>Confirmo que estoy en el servicio</strong><br />
              <span class="muted small">El GPS detecta automáticamente en qué servicio estás al registrar entrada.</span>
            </span>
          </label>
          <label>
            <span>Observación opcional</span>
            <textarea id="notes-in-${escapeHtml(shiftId)}" placeholder="Ej. Ingreso normal / Encargado no abrió..." ${entryDisabled}></textarea>
          </label>
          <button class="primary-btn big-action" data-gps-checkin="${escapeHtml(shiftId)}" type="button" ${entryDisabled}>Registrar entrada con GPS</button>
        </div>

        <div class="checkin-box exit-box">
          <div class="checkpoint-title-row">
            <strong>Salida del servicio</strong>
            <span class="status-pill ${checkedOut ? "status-present" : "status-pending"}">${checkedOut ? "Registrada" : "Pendiente"}</span>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="confirm-out-${escapeHtml(shiftId)}" ${exitDisabled} />
            <span>
              <strong>Confirmo que estoy saliendo del servicio</strong><br />
              <span class="muted small">${checkedOut ? "La salida ya fue registrada." : !checkedIn ? "Primero registrá la entrada." : "Se registra hora y ubicación GPS de salida."}</span>
            </span>
          </label>
          <label>
            <span>Observación opcional</span>
            <textarea id="notes-out-${escapeHtml(shiftId)}" placeholder="Ej. Finalizó normal / Edificio cerrado..." ${exitDisabled}></textarea>
          </label>
          <button class="secondary-btn big-action" data-gps-checkout="${escapeHtml(shiftId)}" type="button" ${exitDisabled}>Registrar salida con GPS</button>
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

  async function handleGpsCheckin(shiftId, assignment = null) {
    const today = todayISO();
    const existingEntry = state.events.find(e => e.shift_id === shiftId && e.event_type === "present");
    const checkbox = document.getElementById(`confirm-in-${shiftId}`);
    const notes = document.getElementById(`notes-in-${shiftId}`)?.value || "";

    if (existingEntry) return toast("La entrada ya fue registrada para hoy.");
    if (!checkbox?.checked) return toast("Primero marcá el checkbox de entrada.");

    try {
      toast("Solicitando GPS de alta precisión...");
      const position = await getPosition();
      const { latitude, longitude, accuracy } = position.coords;

      const assignedSite = assignment ? byId(state.sites, assignment.site_id) : null;

      if (!assignedSite) {
        await store.createEvent({
          shift_id: shiftId,
          assignment_id: null,
          shift_date: today,
          operator_id: state.currentProfile.id,
          site_id: null,
          event_type: "present",
          observed_status: "present",
          notes: `Sin asignación para hoy. ${notes}`.trim(),
          lat: latitude,
          lng: longitude,
          gps_accuracy_m: accuracy,
          distance_m: null,
          is_inside_site: null,
          client_time: new Date().toISOString()
        });
        toast("Entrada registrada. No tenés servicio asignado para hoy. Avisá al supervisor.");
        await renderOperatorView();
        return;
      }

      const distance = haversineMeters(latitude, longitude, Number(assignedSite.lat), Number(assignedSite.lng));
      const isInside = distance <= Number(assignedSite.gps_radius_m || 120);

      await store.createEvent({
        shift_id: shiftId,
        assignment_id: assignment.id,
        shift_date: today,
        operator_id: state.currentProfile.id,
        site_id: assignedSite.id,
        event_type: "present",
        observed_status: "present",
        notes: isInside ? notes : `Fuera de radio. ${notes}`.trim(),
        lat: latitude,
        lng: longitude,
        gps_accuracy_m: accuracy,
        distance_m: distance,
        is_inside_site: isInside,
        client_time: new Date().toISOString()
      });

      if (isInside) {
        toast(`Entrada registrada en ${assignedSite.name} (${Math.round(distance)} m del punto de ingreso).`);
      } else {
        toast(`Entrada registrada. Estás a ${Math.round(distance)} m de ${assignedSite.name} (fuera del radio). Avisá al supervisor.`);
      }
      await renderOperatorView();
    } catch (error) {
      toast(error.message || "No se pudo obtener ubicación GPS.");
    }
  }

  async function handleGpsCheckout(shiftId) {
    const today = todayISO();
    const entryEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "present");
    const existingExit = state.events.find(e => e.shift_id === shiftId && e.event_type === "checkout");
    const checkbox = document.getElementById(`confirm-out-${shiftId}`);
    const notes = document.getElementById(`notes-out-${shiftId}`)?.value || "";

    if (!entryEvent) return toast("Primero tenés que registrar la entrada.");
    if (existingExit) return toast("La salida ya fue registrada para hoy.");
    if (!checkbox?.checked) return toast("Primero marcá el checkbox de salida.");

    try {
      toast("Solicitando GPS de alta precisión...");
      const position = await getPosition();
      const { latitude, longitude, accuracy } = position.coords;

      // Use same site from entry event
      const site = byId(state.sites, entryEvent.site_id);
      const distance = site ? haversineMeters(latitude, longitude, Number(site.lat), Number(site.lng)) : null;
      const isInside = site ? distance <= Number(site.gps_radius_m || 120) : null;

      await store.createEvent({
        shift_id: shiftId,
        assignment_id: null,
        shift_date: today,
        operator_id: state.currentProfile.id,
        site_id: entryEvent.site_id,
        event_type: "checkout",
        observed_status: "on_time_exit",
        notes,
        lat: latitude,
        lng: longitude,
        gps_accuracy_m: accuracy,
        distance_m: distance,
        is_inside_site: isInside,
        client_time: new Date().toISOString()
      });

      toast(isInside ? "Salida registrada correctamente." : "Salida registrada, pero fuera del radio del servicio.");
      await renderOperatorView();
    } catch (error) {
      toast(error.message || "No se pudo obtener ubicación GPS.");
    }
  }

  async function handleManualStatus(shiftId, eventType) {
    const shift = state.shifts.find(s => s.id === shiftId);
    if (!shift) return toast("No se encontró el servicio asignado.");
    const notes = document.getElementById(`notes-in-${shiftId}`)?.value || "";
    const label = eventType === "late" ? "demora" : "ausencia";
    try {
      await store.createEvent({
        shift_id: shift.id,
        assignment_id: shift.assignment_id,
        shift_date: shift.shift_date,
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

  async function syncAutomaticAbsenceEvents(date) {
    if (!isManagementProfile()) return 0;

    const now = new Date();
    const dueShifts = state.shifts.filter(shift => shouldCreateAutomaticAbsence(shift, now));
    let created = 0;

    for (const shift of dueShifts) {
      const autoTime = getAutomaticAbsenceTime(shift);
      const operator = byId(state.profiles, shift.operator_id);
      const site = byId(state.sites, shift.site_id);
      const payload = {
        shift_id: shift.id,
        assignment_id: shift.assignment_id,
        shift_date: shift.shift_date,
        operator_id: shift.operator_id,
        site_id: shift.site_id,
        event_type: "absent",
        observed_status: "absent",
        notes: `Ausencia automática: ${operator?.full_name || "el operario"} no registró entrada en ${site?.name || "el servicio"} antes de las ${formatTime(`${autoTime.getHours().toString().padStart(2, "0")}:${autoTime.getMinutes().toString().padStart(2, "0")}`)}.`,
        client_time: autoTime.toISOString()
      };

      try {
        const inserted = await store.createEvent(payload);
        state.events.unshift(inserted);
        created++;
      } catch (error) {
        console.warn("No se pudo crear ausencia automática", shift.id, error);
      }
    }

    return created;
  }

  function buildFichajeRows(dateFrom, dateTo, operatorFilter) {
    const events = state.events.filter(e => e.shift_date >= dateFrom && e.shift_date <= dateTo);

    const shiftMap = new Map();
    for (const event of events) {
      if (!shiftMap.has(event.shift_id)) {
        shiftMap.set(event.shift_id, { shift_id: event.shift_id, shift_date: event.shift_date, operator_id: event.operator_id, site_id: null });
      }
      const s = shiftMap.get(event.shift_id);
      if (event.event_type === "present") s.entry = event;
      if (event.event_type === "checkout") s.exit = event;
      if (event.site_id) s.site_id = event.site_id;
    }

    let rows = Array.from(shiftMap.values()).map(s => {
      const operator = byId(state.profiles, s.operator_id);
      const site = byId(state.sites, s.site_id);
      const entryTime = s.entry?.client_time;
      const exitTime = s.exit?.client_time;

      let minutes = null;
      let horasLabel = "—";
      if (entryTime && exitTime) {
        minutes = Math.round((new Date(exitTime) - new Date(entryTime)) / 60000);
        horasLabel = `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
      }

      let estado, estadoClass;
      if (s.entry && s.exit) { estado = "Completo"; estadoClass = "status-present"; }
      else if (s.entry) { estado = "Sin salida"; estadoClass = "status-late"; }
      else { estado = "Sin marcación"; estadoClass = "status-absent"; }

      return {
        shift_date: s.shift_date,
        operator_id: s.operator_id,
        operator_name: operator?.full_name || "—",
        site_name: site?.name || "—",
        entry_time: entryTime,
        exit_time: exitTime,
        minutes,
        horasLabel,
        estado,
        estadoClass
      };
    });

    if (operatorFilter) rows = rows.filter(r => r.operator_id === operatorFilter);
    rows.sort((a, b) => `${b.shift_date}${a.operator_name}`.localeCompare(`${a.shift_date}${b.operator_name}`));
    return rows;
  }

  function renderFichaje() {
    const dateFrom = $("#fichajeFrom").value || todayISO();
    const dateTo = $("#fichajeTo").value || todayISO();
    const operatorFilter = $("#fichajeOperator").value || "";

    // Populate operator selector
    const select = $("#fichajeOperator");
    const currentVal = select.value;
    const operators = state.profiles.filter(p => p.role === "operator").sort((a, b) => a.full_name.localeCompare(b.full_name));
    select.innerHTML = `<option value="">Todos</option>` + operators.map(op => `<option value="${op.id}" ${op.id === currentVal ? "selected" : ""}>${escapeHtml(op.full_name)}</option>`).join("");

    const rows = buildFichajeRows(dateFrom, dateTo, operatorFilter);

    // Summary totals per operator
    const totals = new Map();
    for (const row of rows) {
      if (!totals.has(row.operator_id)) totals.set(row.operator_id, { name: row.operator_name, minutes: 0, days: 0, incomplete: 0 });
      const t = totals.get(row.operator_id);
      if (row.minutes !== null) { t.minutes += row.minutes; t.days++; }
      if (row.estado !== "Completo") t.incomplete++;
    }

    const totalMinutes = Array.from(totals.values()).reduce((acc, t) => acc + t.minutes, 0);
    const totalDays = rows.filter(r => r.estado === "Completo").length;
    const totalIncomplete = rows.filter(r => r.estado !== "Completo").length;

    $("#fichajeSummary").innerHTML = `
      ${kpi("Jornadas completas", totalDays, "status-present")}
      ${kpi("Sin salida / sin marcar", totalIncomplete, totalIncomplete ? "status-late" : "status-present")}
      ${kpi("Horas totales período", `${Math.floor(totalMinutes / 60)} h ${String(totalMinutes % 60).padStart(2, "0")} min`)}
    `;

    const tableRows = rows.map(row => `
      <tr>
        <td>${escapeHtml(row.shift_date)}</td>
        <td><strong>${escapeHtml(row.operator_name)}</strong></td>
        <td>${escapeHtml(row.site_name)}</td>
        <td>${row.entry_time ? formatDateTime(row.entry_time) : "—"}</td>
        <td>${row.exit_time ? formatDateTime(row.exit_time) : "—"}</td>
        <td><strong>${escapeHtml(row.horasLabel)}</strong></td>
        <td><span class="status-pill ${row.estadoClass}">${escapeHtml(row.estado)}</span></td>
      </tr>`).join("");

    $("#fichajeTable").innerHTML = `
      <table>
        <thead>
          <tr><th>Fecha</th><th>Operario</th><th>Servicio</th><th>Entrada</th><th>Salida</th><th>Horas trabajadas</th><th>Estado</th></tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="7">No hay registros en el período seleccionado.</td></tr>`}</tbody>
      </table>`;
  }

  function exportFichajeExcel() {
    const dateFrom = $("#fichajeFrom").value || todayISO();
    const dateTo = $("#fichajeTo").value || todayISO();
    const operatorFilter = $("#fichajeOperator").value || "";
    const rows = buildFichajeRows(dateFrom, dateTo, operatorFilter);

    // Sheet 1: detalle
    const detalle = rows.map(r => ({
      "Fecha": r.shift_date,
      "Operario": r.operator_name,
      "Servicio": r.site_name,
      "Hora entrada": r.entry_time ? new Date(r.entry_time).toLocaleString("es-AR") : "",
      "Hora salida": r.exit_time ? new Date(r.exit_time).toLocaleString("es-AR") : "",
      "Horas trabajadas": r.horasLabel,
      "Minutos trabajados": r.minutes ?? "",
      "Estado": r.estado
    }));

    // Sheet 2: resumen por operario
    const totals = new Map();
    for (const row of rows) {
      if (!totals.has(row.operator_id)) totals.set(row.operator_id, { Operario: row.operator_name, "Jornadas completas": 0, "Total minutos": 0, "Total horas": "" });
      const t = totals.get(row.operator_id);
      if (row.minutes !== null) { t["Jornadas completas"]++; t["Total minutos"] += row.minutes; }
    }
    const resumen = Array.from(totals.values()).map(t => {
      t["Total horas"] = `${Math.floor(t["Total minutos"] / 60)} h ${String(t["Total minutos"] % 60).padStart(2, "0")} min`;
      return t;
    }).sort((a, b) => a.Operario.localeCompare(b.Operario));

    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(detalle), "Detalle");
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.json_to_sheet(resumen), "Resumen por operario");
    window.XLSX.writeFile(wb, `fichaje-cleanit-${dateFrom}-al-${dateTo}.xlsx`);
  }

  async function renderSupervisorView() {
    const date = $("#dashboardDate").value || todayISO();
    await refreshBaseData(date);
    const createdAbsences = await syncAutomaticAbsenceEvents(date);
    if (createdAbsences) {
      await refreshBaseData(date);
      toast(`${createdAbsences} ausencia${createdAbsences === 1 ? "" : "s"} automática${createdAbsences === 1 ? "" : "s"} registrada${createdAbsences === 1 ? "" : "s"}.`);
    }
    renderTab(state.activeTab);
    renderDashboard();
    renderFichaje();
    renderCoverage();
    renderSites();
    renderAssignmentSelectors();
    renderAssignments();
    renderUsers();
    syncUserFormFields();
    renderRecords();
  }

  function renderTab(tab) {
    state.activeTab = tab;
    $$(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
    $(`#${tab}Tab`).classList.add("active");
  }

  function statusDetailCell(status, event, emptyText) {
    const when = event ? formatDateTime(event.client_time || event.created_at) : emptyText;
    const gps = event ? `<br><span class="muted small">${escapeHtml(gpsSummary(event))}</span>` : "";
    return `<span class="status-pill ${status.className}">${status.label}</span><br><span class="muted small">${escapeHtml(when)}</span>${gps}`;
  }

  function hasCoordinates(event) {
    return Boolean(event) && Number.isFinite(Number(event.lat)) && Number.isFinite(Number(event.lng));
  }

  function hasOperationalAlert(row) {
    return ["late", "absent", "outside"].includes(row.entryStatus.key)
      || ["early_exit", "exit_outside", "missing_exit", "exit_due"].includes(row.exitStatus.key);
  }

  function operationalAlertItems(row) {
    const items = [];
    const entryItems = {
      late: { label: "Entrada tarde / demorada", className: "status-late" },
      absent: { label: "Ausencia", className: "status-absent" },
      outside: { label: "Entrada fuera de radio", className: "status-outside" }
    };
    const exitItems = {
      early_exit: { label: "Salida anticipada", className: "status-late" },
      exit_outside: { label: "Salida fuera de radio", className: "status-outside" },
      missing_exit: { label: "Salida no registrada", className: "status-absent" },
      exit_due: { label: "Salida pendiente", className: "status-late" }
    };
    if (entryItems[row.entryStatus.key]) items.push(entryItems[row.entryStatus.key]);
    if (exitItems[row.exitStatus.key]) items.push(exitItems[row.exitStatus.key]);
    return items;
  }

  function operationalAlertLabels(row) {
    return operationalAlertItems(row).map(item => item.label);
  }

  function operationalAlertPriority(row) {
    const keys = [row.entryStatus.key, row.exitStatus.key];
    if (keys.includes("absent") || keys.includes("missing_exit")) return 1;
    if (keys.includes("outside") || keys.includes("exit_outside")) return 2;
    if (keys.includes("early_exit")) return 3;
    return 4;
  }

  function getDashboardRows() {
    return state.shifts.map(shift => {
      const entryEvent = getEntryEvent(shift);
      const exitEvent = getExitEvent(shift);
      const manualEvent = getManualEvent(shift);
      const entryStatus = getEntryStatus(shift, entryEvent, manualEvent);
      const exitStatus = getExitStatus(shift, entryEvent, exitEvent);
      const status = getShiftStatus(shift);
      const lastEvent = latestEventForShift(shift.id);
      return { shift, entryEvent, exitEvent, manualEvent, entryStatus, exitStatus, status, lastEvent };
    });
  }

  function renderDashboard() {
    const rows = getDashboardRows();
    state.dashboardRows = rows;

    const counts = rows.reduce((acc, row) => {
      acc.total++;
      if (row.entryEvent) acc.entries++;
      if (row.exitEvent) acc.exits++;
      if (hasOperationalAlert(row)) acc.alerts++;
      return acc;
    }, { total: 0, entries: 0, exits: 0, alerts: 0 });

    $("#kpiGrid").innerHTML = `
      ${kpi("Coberturas del día", counts.total, "", "coverage")}
      ${kpi("Entradas registradas", counts.entries, "status-present", "entries")}
      ${kpi("Salidas registradas", counts.exits, "status-ok", "exits")}
      ${kpi("Alertas operativas", counts.alerts, counts.alerts ? "status-late" : "status-present", "alerts")}
    `;

    const tableRows = rows.map(row => {
      const { shift, entryEvent, exitEvent, entryStatus, exitStatus, status, lastEvent } = row;
      const operator = byId(state.profiles, shift.operator_id);
      const site = byId(state.sites, shift.site_id);
      const message = buildWhatsAppMessage(shift, status);
      const url = whatsappUrl(site?.whatsapp_phone, message);
      const mapButtons = [
        hasCoordinates(entryEvent) ? `<button class="location-btn" data-map-event="${escapeHtml(entryEvent.id)}" type="button">Mapa entrada</button>` : "",
        hasCoordinates(exitEvent) ? `<button class="location-btn" data-map-event="${escapeHtml(exitEvent.id)}" type="button">Mapa salida</button>` : ""
      ].filter(Boolean).join("");

      return `
        <tr>
          <td><strong>${escapeHtml(operator?.full_name || "—")}</strong><br><span class="muted small">${escapeHtml(operator?.phone || "")}</span></td>
          <td><strong>${escapeHtml(site?.name || "—")}</strong><br><span class="muted small">${escapeHtml(site?.address || "")}</span></td>
          <td>${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}</td>
          <td>${statusDetailCell(entryStatus, entryEvent, "Sin entrada")}</td>
          <td>${statusDetailCell(exitStatus, exitEvent, "Sin salida")}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span><br><span class="muted small">${lastEvent ? `${eventTypeLabel(lastEvent.event_type)} · ${formatDateTime(lastEvent.client_time || lastEvent.created_at)}` : "—"}</span></td>
          <td class="row-actions">
            ${mapButtons}
            <a class="wa-btn ${normalizePhone(site?.whatsapp_phone) ? "" : "disabled-link"}" href="${url}" target="_blank" rel="noopener">WhatsApp consorcio</a>
          </td>
        </tr>`;
    }).join("");

    $("#liveTable").innerHTML = `
      <table>
        <thead>
          <tr><th>Operario</th><th>Servicio</th><th>Horario</th><th>Entrada</th><th>Salida</th><th>Estado operativo</th><th>Acción</th></tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="7">No hay cobertura programada para esta fecha.</td></tr>`}</tbody>
      </table>`;
    $("#lastRefreshLabel").textContent = `Actualizado ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function kpi(label, value, className = "", detailKey = "") {
    if (!detailKey) {
      return `<div class="summary-card ${className}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div></div>`;
    }
    return `<button class="summary-card kpi-button ${className}" data-kpi-detail="${detailKey}" type="button" aria-label="Ver detalle de ${escapeHtml(label)}"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div><span class="kpi-hint">Ver detalle</span></button>`;
  }

  function formatOperationalDate(dateString) {
    try {
      return new Date(`${dateString}T12:00:00`).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
    } catch (_) {
      return dateString;
    }
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.classList.remove("hidden");
    document.body.classList.add("modal-open");
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.classList.add("hidden");
    if (id === "locationModal" && attendanceMapInstance) {
      attendanceMapInstance.remove();
      attendanceMapInstance = null;
      const mapEl = $("#attendanceMap");
      if (mapEl) mapEl.innerHTML = "";
    }
    if ($$(".modal-backdrop:not(.hidden)").length === 0) document.body.classList.remove("modal-open");
  }

  function quickDetailBadge(row, kind) {
    if (kind === "entries") return `<span class="status-pill ${row.entryStatus.className}">${escapeHtml(row.entryStatus.label)}</span>`;
    if (kind === "exits") return `<span class="status-pill ${row.exitStatus.className}">${escapeHtml(row.exitStatus.label)}</span>`;
    if (kind === "alerts") {
      return operationalAlertItems(row).map(item => `<span class="status-pill ${item.className}">${escapeHtml(item.label)}</span>`).join("");
    }
    return `<span class="status-pill ${row.status.className}">${escapeHtml(row.status.label)}</span>`;
  }

  function quickDetailMeta(row, kind) {
    const shift = row.shift;
    const lines = [`Horario ${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}`];
    if (kind === "entries" && row.entryEvent) {
      lines.push(`Entrada: ${formatDateTime(row.entryEvent.client_time || row.entryEvent.created_at)}`);
      lines.push(gpsSummary(row.entryEvent));
    } else if (kind === "exits" && row.exitEvent) {
      lines.push(`Salida: ${formatDateTime(row.exitEvent.client_time || row.exitEvent.created_at)}`);
      lines.push(gpsSummary(row.exitEvent));
    } else if (kind === "alerts") {
      if (row.entryEvent) lines.push(`Entrada: ${formatDateTime(row.entryEvent.client_time || row.entryEvent.created_at)}`);
      if (row.exitEvent) lines.push(`Salida: ${formatDateTime(row.exitEvent.client_time || row.exitEvent.created_at)}`);
      if (row.manualEvent?.notes) lines.push(row.manualEvent.notes);
    } else {
      lines.push(`Entrada: ${row.entryEvent ? formatDateTime(row.entryEvent.client_time || row.entryEvent.created_at) : "Sin registrar"}`);
      lines.push(`Salida: ${row.exitEvent ? formatDateTime(row.exitEvent.client_time || row.exitEvent.created_at) : "Sin registrar"}`);
    }
    return lines.filter(Boolean).map(line => escapeHtml(line)).join(" · ");
  }

  function quickDetailMapActions(row, kind) {
    const events = [];
    if (["coverage", "entries", "alerts"].includes(kind) && hasCoordinates(row.entryEvent)) events.push([row.entryEvent, "Ver entrada en mapa"]);
    if (["coverage", "exits", "alerts"].includes(kind) && hasCoordinates(row.exitEvent)) events.push([row.exitEvent, "Ver salida en mapa"]);
    return events.map(([event, label]) => `<button class="location-btn" data-map-event="${escapeHtml(event.id)}" type="button">${label}</button>`).join("");
  }

  function openQuickDetail(kind) {
    if (!isManagementProfile()) return;
    const rows = state.dashboardRows.length ? [...state.dashboardRows] : getDashboardRows();
    const date = $("#dashboardDate").value || todayISO();
    const config = {
      coverage: { title: "Coberturas del día", subtitle: "Dotación programada y estado actual", filter: () => true },
      entries: { title: "Entradas registradas", subtitle: "Ingresos efectivamente fichados", filter: row => Boolean(row.entryEvent) },
      exits: { title: "Salidas registradas", subtitle: "Egresos efectivamente fichados", filter: row => Boolean(row.exitEvent) },
      alerts: { title: "Alertas operativas", subtitle: "Incidencias que requieren revisión", filter: row => hasOperationalAlert(row) }
    }[kind];
    if (!config) return;

    let filtered = rows.filter(config.filter);
    if (kind === "alerts") filtered.sort((a, b) => operationalAlertPriority(a) - operationalAlertPriority(b));

    $("#quickDetailTitle").textContent = config.title;
    $("#quickDetailSubtitle").textContent = `${formatOperationalDate(date)} · ${config.subtitle} · ${filtered.length} registro${filtered.length === 1 ? "" : "s"}`;

    $("#quickDetailBody").innerHTML = filtered.map(row => {
      const operator = byId(state.profiles, row.shift.operator_id);
      const site = byId(state.sites, row.shift.site_id);
      return `
        <article class="quick-detail-item">
          <div class="quick-detail-main">
            <div class="quick-detail-title">
              <strong>${escapeHtml(operator?.full_name || "—")}</strong>
              ${quickDetailBadge(row, kind)}
            </div>
            <div class="quick-detail-meta"><strong>${escapeHtml(site?.name || "—")}</strong> · ${escapeHtml(site?.address || "Sin dirección")}</div>
            <div class="quick-detail-meta">${quickDetailMeta(row, kind)}</div>
          </div>
          <div class="quick-detail-actions">${quickDetailMapActions(row, kind)}</div>
        </article>`;
    }).join("") || `<div class="empty-state-compact">No hay registros para mostrar en esta categoría.</div>`;

    openModal("quickDetailModal");
  }

  function nearestServiceTo(lat, lng) {
    return state.sites
      .filter(site => Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lng)))
      .map(site => ({ site, distance: haversineMeters(lat, lng, Number(site.lat), Number(site.lng)) }))
      .sort((a, b) => a.distance - b.distance)[0] || null;
  }

  function openAttendanceMap(eventId) {
    if (!isManagementProfile()) return;
    const attendanceEvent = state.events.find(event => String(event.id) === String(eventId));
    if (!attendanceEvent || !hasCoordinates(attendanceEvent)) {
      toast("Esta marcación no tiene coordenadas GPS disponibles.");
      return;
    }
    if (!window.L) {
      toast("No se pudo cargar el mapa. Revisá la conexión a internet.");
      return;
    }

    const lat = Number(attendanceEvent.lat);
    const lng = Number(attendanceEvent.lng);
    const operator = byId(state.profiles, attendanceEvent.operator_id);
    const assignedSite = byId(state.sites, attendanceEvent.site_id);
    const assignedDistance = assignedSite ? haversineMeters(lat, lng, Number(assignedSite.lat), Number(assignedSite.lng)) : null;
    const nearest = nearestServiceTo(lat, lng);
    const withinAssigned = assignedSite && assignedDistance !== null ? assignedDistance <= Number(assignedSite.gps_radius_m || 120) : null;

    $("#locationModalTitle").textContent = `${eventTypeLabel(attendanceEvent.event_type)} · ${operator?.full_name || "Operario"}`;
    $("#locationModalSubtitle").textContent = `${formatDateTime(attendanceEvent.client_time || attendanceEvent.created_at)} · ${assignedSite?.name || "Servicio sin identificar"}`;

    const nearestDifferent = nearest?.site && assignedSite && nearest.site.id !== assignedSite.id;
    $("#locationSummary").innerHTML = `
      <div class="location-summary-card">
        <strong>Fichaje GPS</strong>
        <span>${lat.toFixed(6)}, ${lng.toFixed(6)} · Precisión ${attendanceEvent.gps_accuracy_m ? `${Math.round(Number(attendanceEvent.gps_accuracy_m))} m` : "sin dato"}</span>
      </div>
      <div class="location-summary-card ${withinAssigned === false ? "alert" : "ok"}">
        <strong>Servicio asignado</strong>
        <span>${escapeHtml(assignedSite?.name || "Sin servicio")} · ${assignedDistance !== null ? `${Math.round(assignedDistance)} m del punto` : "sin distancia"}${assignedSite ? ` · radio aceptado ${Math.round(Number(assignedSite.gps_radius_m || 120))} m` : ""}</span>
      </div>
      <div class="location-summary-card ${nearestDifferent ? "alert" : ""}">
        <strong>Servicio geolocalizado más cercano</strong>
        <span>${nearest ? `${escapeHtml(nearest.site.name)} · ${Math.round(nearest.distance)} m` : "No hay servicios geolocalizados"}${nearestDifferent ? " · distinto del asignado" : ""}</span>
      </div>`;

    openModal("locationModal");

    window.requestAnimationFrame(() => {
      if (attendanceMapInstance) attendanceMapInstance.remove();
      attendanceMapInstance = window.L.map("attendanceMap", { zoomControl: true });
      window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
      }).addTo(attendanceMapInstance);

      const checkinPoint = [lat, lng];
      const checkinMarker = window.L.circleMarker(checkinPoint, {
        radius: 9,
        color: "#991b1b",
        weight: 3,
        fillColor: "#dc2626",
        fillOpacity: .95
      }).addTo(attendanceMapInstance);
      checkinMarker.bindPopup(`<strong>${escapeHtml(operator?.full_name || "Operario")}</strong><br>${escapeHtml(eventTypeLabel(attendanceEvent.event_type))}<br>${escapeHtml(formatDateTime(attendanceEvent.client_time || attendanceEvent.created_at))}`).openPopup();

      if (Number(attendanceEvent.gps_accuracy_m) > 0) {
        window.L.circle(checkinPoint, {
          radius: Number(attendanceEvent.gps_accuracy_m),
          color: "#dc2626",
          weight: 1,
          fillColor: "#fecaca",
          fillOpacity: .12
        }).addTo(attendanceMapInstance);
      }

      state.sites.forEach(site => {
        if (!Number.isFinite(Number(site.lat)) || !Number.isFinite(Number(site.lng))) return;
        const isAssigned = assignedSite?.id === site.id;
        const marker = window.L.circleMarker([Number(site.lat), Number(site.lng)], {
          radius: isAssigned ? 10 : 6,
          color: isAssigned ? "#a16207" : "#475569",
          weight: isAssigned ? 4 : 2,
          fillColor: isAssigned ? "#f2b705" : "#64748b",
          fillOpacity: isAssigned ? .95 : .72
        }).addTo(attendanceMapInstance);
        marker.bindPopup(`<strong>${escapeHtml(site.name)}</strong><br>${escapeHtml(site.address || "")}<br>${isAssigned ? "Servicio asignado" : "Servicio Clean It"}`);
      });

      if (assignedSite && Number.isFinite(Number(assignedSite.lat)) && Number.isFinite(Number(assignedSite.lng))) {
        const assignedPoint = [Number(assignedSite.lat), Number(assignedSite.lng)];
        window.L.circle(assignedPoint, {
          radius: Number(assignedSite.gps_radius_m || 120),
          color: "#a16207",
          weight: 2,
          fillColor: "#fde68a",
          fillOpacity: .12
        }).addTo(attendanceMapInstance);
        window.L.polyline([checkinPoint, assignedPoint], { color: "#0f172a", weight: 3, dashArray: "7,7", opacity: .7 }).addTo(attendanceMapInstance);
        attendanceMapInstance.fitBounds(window.L.latLngBounds([checkinPoint, assignedPoint]).pad(.35), { maxZoom: 17 });
      } else {
        attendanceMapInstance.setView(checkinPoint, 16);
      }

      window.setTimeout(() => attendanceMapInstance?.invalidateSize(), 50);
    });
  }

  function assignmentMatchesSearch(site, assignments, term) {
    if (!term) return true;
    const haystack = [
      site.name, site.address, site.zone, site.supervisor_name, site.service_type,
      ...assignments.map(a => byId(state.profiles, a.operator_id)?.full_name || "")
    ].join(" ").toLowerCase();
    return haystack.includes(term.toLowerCase());
  }

  function renderCoverage() {
    const term = $("#coverageSearch")?.value?.trim() || "";
    const grid = $("#coverageGrid");
    const html = state.sites
      .map(site => ({ site, assignments: state.assignments.filter(a => a.site_id === site.id) }))
      .filter(group => assignmentMatchesSearch(group.site, group.assignments, term))
      .map(({ site, assignments }) => {
        const dayCards = DAYS.map(day => {
          const dayAssignments = assignments.filter(a => (a.days_of_week || []).map(Number).includes(day.id));
          const chips = dayAssignments.map(a => {
            const op = byId(state.profiles, a.operator_id);
            return `<div class="coverage-assignment"><strong>${escapeHtml(op?.full_name || "—")}</strong><span>${formatTime(a.scheduled_start)}-${formatTime(a.scheduled_end)}</span></div>`;
          }).join("");
          return `<div class="coverage-day"><div class="coverage-day-title">${day.short}</div>${chips || `<div class="no-coverage">Sin cobertura</div>`}</div>`;
        }).join("");

        return `
          <article class="service-card">
            <div class="service-card-head">
              <div>
                <h3>${escapeHtml(site.name)}</h3>
                <p class="muted">${escapeHtml(site.address || "")}</p>
              </div>
              <div class="tag-row">
                ${site.service_type ? `<span class="mini-tag">${escapeHtml(site.service_type)}</span>` : ""}
                ${site.zone ? `<span class="mini-tag">${escapeHtml(site.zone)}</span>` : ""}
                ${site.supervisor_name ? `<span class="mini-tag">${escapeHtml(site.supervisor_name)}</span>` : ""}
              </div>
            </div>
            <div class="coverage-days">${dayCards}</div>
          </article>`;
      }).join("");
    grid.innerHTML = html || `<p class="muted">No hay servicios que coincidan con la búsqueda.</p>`;
  }

  function renderSites() {
    const list = $("#sitesList");
    list.innerHTML = state.sites.map(site => `
      <div class="list-item">
        <div class="list-item-head">
          <div>
            <div class="list-item-title">${escapeHtml(site.name)}</div>
            <div class="muted small">${escapeHtml(site.address)}</div>
            <div class="muted small">${escapeHtml(site.zone || "Sin zona")} · ${escapeHtml(site.supervisor_name || "Sin supervisor")} · ${escapeHtml(site.service_type || "Sin tipo")}</div>
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
      zone: $("#siteZone").value.trim(),
      supervisor_name: $("#siteSupervisor").value.trim(),
      service_type: $("#siteType").value.trim(),
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
    $("#siteZone").value = site.zone || "";
    $("#siteSupervisor").value = site.supervisor_name || "";
    $("#siteType").value = site.service_type || "";
    $("#siteLat").value = site.lat || "";
    $("#siteLng").value = site.lng || "";
    $("#siteRadius").value = site.gps_radius_m || 120;
    $("#siteContactName").value = site.whatsapp_name || "";
    $("#siteWhatsapp").value = site.whatsapp_phone || "";
    $("#siteFormTitle").textContent = "Editar servicio / consorcio";
    $("#cancelSiteEditBtn").classList.remove("hidden");
    renderTab("sites");
  }

  async function deleteSite(id) {
    if (!window.confirm("¿Eliminar este servicio? También se darán de baja sus asignaciones activas.")) return;
    await store.deleteSite(id);
    toast("Servicio eliminado.");
    await renderSupervisorView();
  }

  function renderAssignmentSelectors() {
    const operators = state.profiles.filter(p => p.role === "operator");
    $("#assignmentOperator").innerHTML = operators.map(op => `<option value="${op.id}">${escapeHtml(op.full_name)}</option>`).join("");
    $("#assignmentSite").innerHTML = state.sites.map(site => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join("");
  }

  function defaultScheduleStart() { return "08:00"; }
  function defaultScheduleEnd() { return "12:00"; }

  function scheduleInputId(prefix, dayId) {
    return `${prefix}-${dayId}`;
  }

  function renderAssignmentSchedule() {
    const grid = $("#assignmentScheduleGrid");
    grid.innerHTML = DAYS.map(day => `
      <div class="schedule-day-row" data-schedule-row="${day.id}">
        <label class="schedule-day-toggle">
          <input id="${scheduleInputId("assignmentDayEnabled", day.id)}" type="checkbox" value="${day.id}" />
          <span>${day.long}</span>
        </label>
        <label class="schedule-time-field">
          <span>Entrada</span>
          <input id="${scheduleInputId("assignmentDayStart", day.id)}" type="time" value="${defaultScheduleStart()}" disabled />
        </label>
        <label class="schedule-time-field">
          <span>Salida</span>
          <input id="${scheduleInputId("assignmentDayEnd", day.id)}" type="time" value="${defaultScheduleEnd()}" disabled />
        </label>
      </div>`).join("");

    DAYS.forEach(day => {
      const enabled = document.getElementById(scheduleInputId("assignmentDayEnabled", day.id));
      const start = document.getElementById(scheduleInputId("assignmentDayStart", day.id));
      const end = document.getElementById(scheduleInputId("assignmentDayEnd", day.id));
      enabled.addEventListener("change", () => {
        start.disabled = !enabled.checked;
        end.disabled = !enabled.checked;
        if (enabled.checked) {
          if (!start.value) start.value = defaultScheduleStart();
          if (!end.value) end.value = defaultScheduleEnd();
        }
      });
    });
  }

  function setScheduleDay(dayId, enabled, start = defaultScheduleStart(), end = defaultScheduleEnd()) {
    const checkbox = document.getElementById(scheduleInputId("assignmentDayEnabled", dayId));
    const startInput = document.getElementById(scheduleInputId("assignmentDayStart", dayId));
    const endInput = document.getElementById(scheduleInputId("assignmentDayEnd", dayId));
    if (!checkbox || !startInput || !endInput) return;
    checkbox.checked = Boolean(enabled);
    startInput.disabled = !checkbox.checked;
    endInput.disabled = !checkbox.checked;
    startInput.value = start || defaultScheduleStart();
    endInput.value = end || defaultScheduleEnd();
  }

  function clearAssignmentSchedule() {
    DAYS.forEach(day => setScheduleDay(day.id, false));
  }

  function setAssignmentScheduleRows(rows = []) {
    clearAssignmentSchedule();
    rows.forEach(row => {
      const dayId = Number(row.day_id ?? row.day ?? row.id);
      if (!dayId) return;
      setScheduleDay(dayId, true, formatTime(row.scheduled_start || row.start || defaultScheduleStart()), formatTime(row.scheduled_end || row.end || defaultScheduleEnd()));
    });
  }

  function applyWeekdaysPreset() {
    DAYS.forEach(day => {
      if (day.id <= 5) {
        const start = document.getElementById(scheduleInputId("assignmentDayStart", day.id))?.value || defaultScheduleStart();
        const end = document.getElementById(scheduleInputId("assignmentDayEnd", day.id))?.value || defaultScheduleEnd();
        setScheduleDay(day.id, true, start, end);
      }
    });
  }

  function applyAllDaysPreset() {
    DAYS.forEach(day => {
      const start = document.getElementById(scheduleInputId("assignmentDayStart", day.id))?.value || defaultScheduleStart();
      const end = document.getElementById(scheduleInputId("assignmentDayEnd", day.id))?.value || defaultScheduleEnd();
      setScheduleDay(day.id, true, start, end);
    });
  }

  function copyFirstScheduleToActiveDays() {
    const active = getAssignmentScheduleRows(false);
    if (!active.length) {
      toast("Activá al menos un día para copiar el horario.");
      return;
    }
    const first = active[0];
    active.forEach(row => setScheduleDay(row.day_id, true, first.scheduled_start, first.scheduled_end));
  }

  function getAssignmentScheduleRows(validate = true) {
    const rows = [];
    for (const day of DAYS) {
      const checkbox = document.getElementById(scheduleInputId("assignmentDayEnabled", day.id));
      if (!checkbox?.checked) continue;
      const start = document.getElementById(scheduleInputId("assignmentDayStart", day.id))?.value;
      const end = document.getElementById(scheduleInputId("assignmentDayEnd", day.id))?.value;
      if (validate) {
        if (!start || !end) throw new Error(`Cargá horario de entrada y salida para ${day.long}.`);
        if (end <= start) throw new Error(`En ${day.long}, la hora de salida debe ser posterior a la entrada.`);
      }
      rows.push({ day_id: day.id, scheduled_start: start || defaultScheduleStart(), scheduled_end: end || defaultScheduleEnd() });
    }
    return rows;
  }

  function groupScheduleRows(rows) {
    const groups = new Map();
    rows.forEach(row => {
      const key = `${row.scheduled_start}|${row.scheduled_end}`;
      if (!groups.has(key)) {
        groups.set(key, {
          scheduled_start: row.scheduled_start,
          scheduled_end: row.scheduled_end,
          days_of_week: []
        });
      }
      groups.get(key).days_of_week.push(row.day_id);
    });
    return Array.from(groups.values()).map(group => ({
      ...group,
      days_of_week: group.days_of_week.sort((a, b) => a - b)
    }));
  }

  function renderAssignments() {
    const list = $("#assignmentsList");
    const sorted = [...state.assignments].sort((a, b) => {
      const siteA = byId(state.sites, a.site_id)?.name || "";
      const siteB = byId(state.sites, b.site_id)?.name || "";
      return `${siteA} ${a.scheduled_start}`.localeCompare(`${siteB} ${b.scheduled_start}`);
    });

    list.innerHTML = sorted.map(assignment => {
      const op = byId(state.profiles, assignment.operator_id);
      const site = byId(state.sites, assignment.site_id);
      const days = (assignment.days_of_week || []).map(d => dayLabel(d)).join(", ");
      const vigencia = `${assignment.valid_from || "—"}${assignment.valid_to ? ` a ${assignment.valid_to}` : " en adelante"}`;
      return `
        <div class="list-item">
          <div class="list-item-title">${escapeHtml(site?.name || "—")}</div>
          <div class="muted small"><strong>${escapeHtml(op?.full_name || "—")}</strong> · ${formatTime(assignment.scheduled_start)} a ${formatTime(assignment.scheduled_end)}</div>
          <div class="muted small">Días: ${escapeHtml(days || "—")} · Vigencia: ${escapeHtml(vigencia)}</div>
          <div class="muted small">Tolerancia: ${assignment.grace_minutes} min · Ausente desde: ${assignment.absence_after_minutes} min</div>
          ${assignment.notes ? `<div class="muted small">Notas: ${escapeHtml(assignment.notes)}</div>` : ""}
          <div class="list-item-actions">
            <button class="secondary-btn small-btn" data-edit-assignment="${assignment.id}" type="button">Editar</button>
            <button class="danger-btn small-btn" data-delete-assignment="${assignment.id}" type="button">Eliminar</button>
          </div>
        </div>`;
    }).join("") || `<p class="muted">No hay asignaciones cargadas.</p>`;

    list.querySelectorAll("[data-edit-assignment]").forEach(btn => btn.addEventListener("click", () => editAssignment(btn.dataset.editAssignment)));
    list.querySelectorAll("[data-delete-assignment]").forEach(btn => btn.addEventListener("click", () => deleteAssignment(btn.dataset.deleteAssignment)));
  }

  function assignmentPayloadsFromForm() {
    const id = $("#assignmentId").value || undefined;
    const rows = getAssignmentScheduleRows(true);
    if (!rows.length) throw new Error("Activá al menos un día de cobertura.");

    const groups = groupScheduleRows(rows);
    const base = {
      operator_id: $("#assignmentOperator").value,
      site_id: $("#assignmentSite").value,
      grace_minutes: Number($("#assignmentGrace").value || 10),
      absence_after_minutes: Number($("#assignmentAbsentAfter").value || 30),
      valid_from: $("#assignmentValidFrom").value || todayISO(),
      valid_to: $("#assignmentValidTo").value || null,
      notes: $("#assignmentNotes").value.trim(),
      is_active: true
    };

    return groups.map((group, index) => ({
      ...(id && index === 0 ? { id } : {}),
      ...base,
      days_of_week: group.days_of_week,
      scheduled_start: group.scheduled_start,
      scheduled_end: group.scheduled_end
    }));
  }

  function resetAssignmentForm() {
    $("#assignmentForm").reset();
    $("#assignmentId").value = "";
    $("#assignmentGrace").value = 10;
    $("#assignmentAbsentAfter").value = 30;
    $("#assignmentValidFrom").value = todayISO();
    clearAssignmentSchedule();
    $("#assignmentFormTitle").textContent = "Nueva asignación fija";
    $("#cancelAssignmentEditBtn").classList.add("hidden");
  }

  function editAssignment(id) {
    const assignment = byId(state.assignments, id);
    if (!assignment) return;
    $("#assignmentId").value = assignment.id;
    $("#assignmentOperator").value = assignment.operator_id;
    $("#assignmentSite").value = assignment.site_id;
    $("#assignmentGrace").value = assignment.grace_minutes || 10;
    $("#assignmentAbsentAfter").value = assignment.absence_after_minutes || 30;
    $("#assignmentValidFrom").value = assignment.valid_from || todayISO();
    $("#assignmentValidTo").value = assignment.valid_to || "";
    $("#assignmentNotes").value = assignment.notes || "";
    setAssignmentScheduleRows((assignment.days_of_week || []).map(day => ({
      day_id: Number(day),
      scheduled_start: formatTime(assignment.scheduled_start),
      scheduled_end: formatTime(assignment.scheduled_end)
    })));
    $("#assignmentFormTitle").textContent = "Editar asignación fija";
    $("#cancelAssignmentEditBtn").classList.remove("hidden");
    renderTab("assignments");
  }

  async function deleteAssignment(id) {
    if (!window.confirm("¿Eliminar esta asignación fija? Las marcaciones históricas quedan guardadas.")) return;
    await store.deleteAssignment(id);
    toast("Asignación eliminada.");
    await renderSupervisorView();
  }

  function renderUsers() {
    const list = $("#usersList");
    list.innerHTML = state.profiles.map(user => `
      <div class="list-item">
        <div class="list-item-title">${escapeHtml(user.full_name)}</div>
        <div class="muted small">${escapeHtml(roleLabel(user.role).replace(/^./, c => c.toUpperCase()))} · ${escapeHtml(user.phone || "Sin teléfono")}</div>
        <div class="muted small">UUID Auth / ID perfil: ${escapeHtml(user.id)}</div>
        ${user.notes ? `<div class="muted small">Notas: ${escapeHtml(user.notes)}</div>` : ""}
        <div class="list-item-actions">
          <button class="secondary-btn small-btn" data-edit-user="${user.id}" type="button">Editar</button>
          ${user.role === "operator" ? `<button class="secondary-btn small-btn" data-reset-password="${user.id}" type="button">Restablecer contraseña</button>` : ""}
          <button class="danger-btn small-btn" data-delete-user="${user.id}" type="button">Eliminar</button>
        </div>
      </div>`).join("") || `<p class="muted">No hay usuarios cargados.</p>`;

    list.querySelectorAll("[data-edit-user]").forEach(btn => btn.addEventListener("click", () => editUser(btn.dataset.editUser)));
    list.querySelectorAll("[data-delete-user]").forEach(btn => btn.addEventListener("click", () => deleteUser(btn.dataset.deleteUser)));
    list.querySelectorAll("[data-reset-password]").forEach(btn => btn.addEventListener("click", () => resetOperatorPasswordPrompt(btn.dataset.resetPassword)));
  }

  function syncUserFormFields() {
    const isEditing = Boolean($("#userId").value);
    const role = $("#userRole").value;
    const showOperatorFields = !isEditing && role === "operator";
    const showSupervisorFields = !isEditing && ["supervisor", "admin"].includes(role);

    $("#userOperatorFields").classList.toggle("hidden", !showOperatorFields);
    $("#userSupervisorFields").classList.toggle("hidden", !showSupervisorFields);
    $("#userUsername").required = showOperatorFields;
    $("#userDni").required = showOperatorFields;
    $("#userAuthId").required = showSupervisorFields;
  }

  function userPayloadFromForm() {
    const id = $("#userId").value || $("#userAuthId").value.trim();
    if (!id) throw new Error("Tenés que cargar el UUID real del usuario creado en Supabase Authentication.");
    return {
      id,
      full_name: $("#userName").value.trim(),
      phone: $("#userPhone").value.trim(),
      role: $("#userRole").value,
      notes: $("#userNotes").value.trim(),
      is_active: true
    };
  }

  function resetUserForm() {
    $("#userForm").reset();
    $("#userId").value = "";
    $("#userAuthId").value = "";
    $("#userUsername").value = "";
    $("#userDni").value = "";
    $("#userRole").value = "operator";
    $("#userFormTitle").textContent = "Nuevo usuario";
    $("#cancelUserEditBtn").classList.add("hidden");
    syncUserFormFields();
  }

  function editUser(id) {
    const user = byId(state.profiles, id);
    if (!user) return;
    $("#userId").value = user.id;
    $("#userRole").value = user.role || "operator";
    $("#userAuthId").value = user.id || "";
    $("#userUsername").value = "";
    $("#userDni").value = "";
    $("#userName").value = user.full_name || "";
    $("#userPhone").value = user.phone || "";
    $("#userNotes").value = user.notes || "";
    $("#userFormTitle").textContent = "Editar usuario";
    $("#cancelUserEditBtn").classList.remove("hidden");
    syncUserFormFields();
    renderTab("users");
  }

  async function deleteUser(id) {
    if (id === state.currentProfile?.id) {
      toast("No conviene eliminar tu propio usuario mientras estás logueado.");
      return;
    }
    if (!window.confirm("¿Eliminar este usuario? También se darán de baja sus asignaciones activas.")) return;
    await store.deleteProfile(id);
    toast("Usuario eliminado.");
    await renderSupervisorView();
  }

  async function resetOperatorPasswordPrompt(id) {
    const user = byId(state.profiles, id);
    if (!user) return;
    const dni = window.prompt(`Nuevo DNI (contraseña) para ${user.full_name}:`);
    if (!dni) return;
    try {
      await store.resetOperatorPassword(id, dni.trim());
      toast("Contraseña restablecida.");
    } catch (error) {
      toast(error.message || "No se pudo restablecer la contraseña.");
    }
  }

  function renderRecords() {
    const rows = state.events.map(event => {
      const op = byId(state.profiles, event.operator_id);
      const site = byId(state.sites, event.site_id);
      return `
        <tr>
          <td>${formatDateTime(event.created_at)}</td>
          <td>${escapeHtml(event.shift_date || "—")}</td>
          <td>${escapeHtml(op?.full_name || event.operator_id || "—")}</td>
          <td>${escapeHtml(site?.name || event.site_id || "—")}</td>
          <td><strong>${escapeHtml(eventTypeLabel(event.event_type))}</strong><br><span class="muted small">${escapeHtml(observedStatusLabel(event.observed_status))}</span></td>
          <td>${event.lat ? `${Number(event.lat).toFixed(6)}, ${Number(event.lng).toFixed(6)}` : "—"}</td>
          <td>${event.gps_accuracy_m ? `${Math.round(event.gps_accuracy_m)} m` : "—"}</td>
          <td>${event.distance_m ? `${Math.round(event.distance_m)} m` : "—"}</td>
          <td>${event.is_inside_site === true ? "Sí" : event.is_inside_site === false ? "No" : "—"}</td>
          <td>${escapeHtml(event.notes || "")}</td>
        </tr>`;
    }).join("");

    $("#recordsTable").innerHTML = `
      <table>
        <thead><tr><th>Hora registro</th><th>Fecha servicio</th><th>Operario</th><th>Servicio</th><th>Tipo</th><th>GPS</th><th>Precisión</th><th>Distancia</th><th>Dentro radio</th><th>Obs.</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10">Todavía no hay marcaciones.</td></tr>`}</tbody>
      </table>`;
  }

  function exportCsv() {
    const header = ["fecha_hora", "fecha_servicio", "operario", "servicio", "tipo", "tipo_legible", "estado", "estado_legible", "lat", "lng", "precision_m", "distancia_m", "dentro_radio", "observacion", "assignment_id", "shift_id"];
    const lines = state.events.map(event => {
      const op = byId(state.profiles, event.operator_id);
      const site = byId(state.sites, event.site_id);
      const values = [
        event.created_at,
        event.shift_date || "",
        op?.full_name || event.operator_id || "",
        site?.name || event.site_id || "",
        event.event_type || "",
        eventTypeLabel(event.event_type),
        event.observed_status || "",
        observedStatusLabel(event.observed_status),
        event.lat || "",
        event.lng || "",
        event.gps_accuracy_m || "",
        event.distance_m || "",
        event.is_inside_site === true ? "si" : event.is_inside_site === false ? "no" : "",
        event.notes || "",
        event.assignment_id || "",
        event.shift_id || ""
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
    $$('[data-login-mode]').forEach(btn => btn.addEventListener('click', () => {
      state.loginMode = btn.dataset.loginMode;
      renderLoginMode();
    }));
    $("#supabaseLoginForm").addEventListener("submit", handleSupabaseLogin);
    $("#operatorLogoutBtn").addEventListener("click", logout);
    $("#supervisorLogoutBtn").addEventListener("click", logout);
    $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => renderTab(btn.dataset.tab)));
    $("#refreshDashboardBtn").addEventListener("click", renderSupervisorView);
    $("#dashboardDate").addEventListener("change", renderSupervisorView);
    $("#kpiGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-kpi-detail]");
      if (button) openQuickDetail(button.dataset.kpiDetail);
    });
    $("#liveTable").addEventListener("click", (event) => {
      const button = event.target.closest("[data-map-event]");
      if (button) openAttendanceMap(button.dataset.mapEvent);
    });
    $("#quickDetailBody").addEventListener("click", (event) => {
      const button = event.target.closest("[data-map-event]");
      if (button) openAttendanceMap(button.dataset.mapEvent);
    });
    $$('[data-close-modal]').forEach(button => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
    $$(".modal-backdrop").forEach(modal => modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal.id);
    }));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!$("#locationModal").classList.contains("hidden")) closeModal("locationModal");
      else if (!$("#quickDetailModal").classList.contains("hidden")) closeModal("quickDetailModal");
    });
    $("#coverageSearch").addEventListener("input", renderCoverage);
    $("#clearCoverageSearchBtn").addEventListener("click", () => { $("#coverageSearch").value = ""; renderCoverage(); });

    $("#siteForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await store.upsertSite(sitePayloadFromForm());
      resetSiteForm();
      toast("Servicio guardado.");
      await renderSupervisorView();
    });
    $("#cancelSiteEditBtn").addEventListener("click", resetSiteForm);

    $("#assignmentForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const payloads = assignmentPayloadsFromForm();
        for (const payload of payloads) {
          await store.upsertAssignment(payload);
        }
        resetAssignmentForm();
        toast(payloads.length === 1 ? "Asignación guardada." : `${payloads.length} asignaciones guardadas según horarios distintos.`);
        await renderSupervisorView();
      } catch (error) {
        toast(error.message || "No se pudo guardar la asignación.");
      }
    });
    $("#cancelAssignmentEditBtn").addEventListener("click", resetAssignmentForm);
    $("#presetWeekdaysBtn").addEventListener("click", applyWeekdaysPreset);
    $("#presetAllDaysBtn").addEventListener("click", applyAllDaysPreset);
    $("#copyFirstScheduleBtn").addEventListener("click", copyFirstScheduleToActiveDays);
    $("#clearScheduleBtn").addEventListener("click", clearAssignmentSchedule);

    $("#userForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const isEditing = Boolean($("#userId").value);
        if (!isEditing && $("#userRole").value === "operator") {
          await store.createOperator({
            username: $("#userUsername").value.trim(),
            dni: $("#userDni").value.trim(),
            full_name: $("#userName").value.trim(),
            phone: $("#userPhone").value.trim()
          });
        } else {
          await store.upsertProfile(userPayloadFromForm());
        }
        resetUserForm();
        toast("Usuario guardado.");
        await renderSupervisorView();
      } catch (error) {
        toast(error.message || "No se pudo guardar el usuario.");
      }
    });
    $("#userRole").addEventListener("change", syncUserFormFields);
    $("#cancelUserEditBtn").addEventListener("click", resetUserForm);
    $("#exportCsvBtn").addEventListener("click", exportCsv);

    const firstDay = new Date();
    firstDay.setDate(1);
    $("#fichajeFrom").value = firstDay.toISOString().slice(0, 10);
    $("#fichajeTo").value = todayISO();
    $("#applyFichajeBtn").addEventListener("click", renderFichaje);
    $("#exportFichajeBtn").addEventListener("click", exportFichajeExcel);
  }

  async function init() {
    renderConnectionMode();
    renderLoginMode();
    renderAssignmentSchedule();
    $("#dashboardDate").value = todayISO();
    $("#assignmentValidFrom").value = todayISO();
    bindEvents();

    try {
      const session = await store.getCurrentSessionProfile();
      if (session?.user && session?.profile) {
        state.currentUser = session.user;
        state.currentProfile = session.profile;
        await afterLogin();
      }
    } catch (error) {
      await store.signOut();
      setView("#loginView");
    }
  }

  init();
})();
