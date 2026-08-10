(function () {
  const CONFIG = window.APP_CONFIG || {};
  const INITIAL_AUTH_URL = window.location.href;
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
    liveStatusFilter: "all",
    recordsEvents: [],
    recordsProfiles: [],
    recordsSites: [],
    recordsLoaded: false,
    activeTab: "live"
  };

  let attendanceMapInstance = null;
  let passwordRecoveryActive = false;

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

  function dateToISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function parseISODate(dateString) {
    return new Date(`${dateString}T12:00:00`);
  }

  function addDaysISO(dateString, days) {
    const d = parseISODate(dateString);
    d.setDate(d.getDate() + Number(days || 0));
    return dateToISO(d);
  }

  function monthStartISO(dateString) {
    const d = parseISODate(dateString);
    d.setDate(1);
    return dateToISO(d);
  }

  function monthEndISO(dateString) {
    const d = parseISODate(dateString);
    d.setMonth(d.getMonth() + 1, 0);
    return dateToISO(d);
  }

  function minISO(values) {
    return values.filter(Boolean).sort()[0] || null;
  }

  function maxISO(values) {
    const filtered = values.filter(Boolean).sort();
    return filtered[filtered.length - 1] || null;
  }

  function periodElements(kind) {
    if (kind === "live") {
      return { period: $("#liveExportPeriod"), from: $("#liveExportFrom"), to: $("#liveExportTo") };
    }
    return { period: $("#recordsPeriod"), from: $("#recordsFrom"), to: $("#recordsTo") };
  }

  function periodAnchor(kind) {
    return kind === "live" ? ($("#dashboardDate")?.value || todayISO()) : todayISO();
  }

  function syncPeriodControls(kind, preserveCustom = true) {
    const { period, from, to } = periodElements(kind);
    if (!period || !from || !to) return;
    const value = period.value;
    const anchorDate = periodAnchor(kind);
    const custom = value === "custom";
    const all = value === "all";

    if (all) {
      from.value = "";
      to.value = "";
    } else if (!custom || !preserveCustom || !from.value || !to.value) {
      let rangeFrom = anchorDate;
      let rangeTo = anchorDate;
      if (value === "yesterday") rangeFrom = rangeTo = addDaysISO(anchorDate, -1);
      if (value === "last7") rangeFrom = addDaysISO(anchorDate, -6);
      if (value === "month") {
        rangeFrom = monthStartISO(anchorDate);
        rangeTo = kind === "live" ? minISO([monthEndISO(anchorDate), todayISO()]) || anchorDate : todayISO();
      }
      if (value === "lastmonth") {
        const previousMonthEnd = addDaysISO(monthStartISO(anchorDate), -1);
        rangeFrom = monthStartISO(previousMonthEnd);
        rangeTo = monthEndISO(previousMonthEnd);
      }
      if (value === "today") rangeFrom = rangeTo = todayISO();
      if (value === "shown") rangeFrom = rangeTo = anchorDate;
      from.value = rangeFrom;
      to.value = rangeTo;
    }

    from.disabled = all || !custom;
    to.disabled = all || !custom;
  }

  function resolvePeriod(kind) {
    const { period, from, to } = periodElements(kind);
    const value = period?.value || (kind === "live" ? "shown" : "month");
    syncPeriodControls(kind, true);
    if (value === "all") return { mode: value, from: null, to: null, isAll: true, label: "historial-completo" };
    const rangeFrom = from?.value || periodAnchor(kind);
    const rangeTo = to?.value || rangeFrom;
    if (rangeFrom > rangeTo) throw new Error("La fecha Desde no puede ser posterior a Hasta.");
    return { mode: value, from: rangeFrom, to: rangeTo, isAll: false, label: rangeFrom === rangeTo ? rangeFrom : `${rangeFrom}-al-${rangeTo}` };
  }

  function formatClock(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    } catch (_) {
      return "";
    }
  }

  function csvEscape(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadCsvObjects(rows, headers, filename) {
    const lines = [headers.map(h => csvEscape(h)).join(",")];
    rows.forEach(row => lines.push(headers.map(header => csvEscape(row[header])).join(",")));
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function applyWorksheetUsability(ws, widths = []) {
    if (!ws) return;
    if (widths.length) ws["!cols"] = widths.map(wch => ({ wch }));
    if (ws["!ref"]) ws["!autofilter"] = { ref: ws["!ref"] };
  }

  async function withExportButton(button, busyText, callback) {
    if (!button) return callback();
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    button.closest(".export-panel, .data-card")?.classList.add("export-loading");
    try {
      return await callback();
    } finally {
      button.disabled = false;
      button.textContent = previous;
      button.closest(".export-panel, .data-card")?.classList.remove("export-loading");
    }
  }

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
    if (minutesAfterEnd < 0) {
      // Mientras el operario sigue trabajando, la columna Salida también conserva
      // visualmente una anomalía de ingreso para evitar que un azul "normal" la oculte.
      if (entryEvent.is_inside_site === false) return { key: "in_service_outside", label: "En servicio · entrada fuera de radio", className: "status-outside" };
      if (entryEvent.observed_status === "late") return { key: "in_service_late", label: "En servicio · entrada tarde", className: "status-late" };
      return { key: "in_service", label: "En servicio", className: "status-ok" };
    }
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
    if (entryEvent && ["in_service", "in_service_outside", "in_service_late"].includes(exitStatus.key)) {
      if (entryStatus.key === "outside") return { key: "in_service_outside", label: "En servicio · entrada fuera de radio", className: "status-outside" };
      if (entryStatus.key === "late") return { key: "in_service_late", label: "En servicio · entrada tarde", className: "status-late" };
      return { key: "in_service", label: "En servicio", className: "status-present" };
    }
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
      ? `<p class="eyebrow">Acceso supervisor</p><h3>Panel de control</h3><p class="muted small no-margin">Ingresá con tu nombre de usuario o email y tu contraseña.</p>`
      : `<p class="eyebrow">Acceso operario</p><h3>Marcar presencia</h3><p class="muted small no-margin">Ingresá con tu nombre de usuario o email para registrar entrada o salida con GPS.</p>`;
    emailLabel.textContent = "Usuario o email";
    email.placeholder = isSupervisor ? "ej: supervisor1" : "ej: arielacevedo";
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
      const identifier = emailInput.value.trim();
      const password = passwordInput.value;
      const { user, profile } = await store.loginWithIdentifier(identifier, password);

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

  function looksLikePasswordRecoveryUrl() {
    const source = String(INITIAL_AUTH_URL || "");
    return /(?:[?#&])type=recovery(?:[&#]|$)/i.test(source);
  }

  function showPasswordResetView(ready = false) {
    passwordRecoveryActive = true;
    setView("#resetPasswordView");
    const status = $("#resetPasswordStatus");
    if (status) status.textContent = ready
      ? "Enlace validado. Elegí una contraseña nueva."
      : "Validando el enlace de recuperación…";
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    const identifier = $("#forgotIdentifier").value.trim();
    const button = $("#forgotPasswordSubmitBtn");
    try {
      button.disabled = true;
      const result = await store.requestPasswordReset(identifier);
      if (result?.needs_real_email) {
        toast(result.message || "Este usuario no tiene un email real de recuperación configurado.");
        return;
      }
      toast(result?.sent === false
        ? "Si la cuenta existe y tiene email configurado, recibirá un enlace de recuperación."
        : "Email de recuperación enviado. Revisá también la carpeta de spam.", "success");
    } catch (error) {
      toast(error.message || "No se pudo enviar el email de recuperación.");
    } finally {
      button.disabled = false;
    }
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    const password = $("#newPassword").value;
    const confirmation = $("#newPasswordConfirm").value;
    const button = $("#resetPasswordSubmitBtn");
    try {
      if (password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
      if (password !== confirmation) throw new Error("Las contraseñas no coinciden.");
      button.disabled = true;
      const session = await store.getSession();
      if (!session?.user) throw new Error("El enlace de recuperación venció o no es válido. Solicitá uno nuevo.");
      await store.updateCurrentPassword(password);
      await store.signOut();
      passwordRecoveryActive = false;
      $("#newPassword").value = "";
      $("#newPasswordConfirm").value = "";
      const cleanUrl = `${window.location.origin}${window.location.pathname}`;
      window.history.replaceState({}, document.title, cleanUrl);
      setView("#loginView");
      toast("Contraseña actualizada. Ya podés ingresar con la nueva contraseña.", "success");
    } catch (error) {
      toast(error.message || "No se pudo actualizar la contraseña.");
    } finally {
      button.disabled = false;
    }
  }

  async function afterLogin() {
    if (state.currentProfile.role === "operator") {
      setView("#operatorView");
      await renderOperatorView();
    } else {
      setView("#supervisorView");
      const managementRoleLabel = $("#managementRoleLabel");
      if (managementRoleLabel) {
        managementRoleLabel.textContent = String(state.currentProfile?.role || "").toLowerCase() === "admin"
          ? "Vista administrador"
          : "Vista supervisor";
      }
      $("#dashboardDate").value = todayISO();
      $("#assignmentValidFrom").value = todayISO();
      syncPeriodControls("live", false);
      await renderSupervisorView();
    }
  }

  async function logout() {
    await store.signOut();
    state.currentUser = null;
    state.currentProfile = null;
    state.recordsEvents = [];
    state.recordsProfiles = [];
    state.recordsSites = [];
    state.recordsLoaded = false;
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

  function liveStatusFilterDefinitions(rows) {
    const exitAlertKeys = ["early_exit", "exit_outside", "missing_exit", "exit_due"];
    const definitions = [
      { key: "all", label: "Todos", tone: "neutral", matches: () => true },
      { key: "alerts", label: "Con alerta", tone: "alert", matches: row => hasOperationalAlert(row) },
      { key: "on_time", label: "Ingreso correcto", tone: "present", matches: row => row.entryStatus.key === "present" },
      { key: "late", label: "Llegada tarde", tone: "late", matches: row => row.entryStatus.key === "late" || row.entryEvent?.observed_status === "late" },
      { key: "outside", label: "Fuera de radio", tone: "outside", matches: row => row.entryStatus.key === "outside" },
      { key: "absent", label: "Ausentes", tone: "absent", matches: row => row.entryStatus.key === "absent" },
      { key: "pending", label: "Pendientes", tone: "pending", matches: row => ["scheduled", "on_window"].includes(row.entryStatus.key) },
      { key: "exit_alert", label: "Alertas de salida", tone: "exit", matches: row => exitAlertKeys.includes(row.exitStatus.key) }
    ];
    return definitions.map(def => ({ ...def, count: rows.filter(def.matches).length }));
  }

  function renderLiveStatusFilters(rows) {
    const container = $("#liveStatusFilters");
    if (!container) return;
    const definitions = liveStatusFilterDefinitions(rows);
    if (!definitions.some(def => def.key === state.liveStatusFilter)) state.liveStatusFilter = "all";
    container.innerHTML = `
      <span class="live-filter-label">Filtrar:</span>
      ${definitions.map(def => `
        <button class="status-filter-btn tone-${def.tone} ${state.liveStatusFilter === def.key ? "active" : ""}"
          type="button" data-live-filter="${def.key}" aria-pressed="${state.liveStatusFilter === def.key ? "true" : "false"}">
          <span class="filter-dot" aria-hidden="true"></span>
          <span>${escapeHtml(def.label)}</span>
          <strong class="filter-count">${def.count}</strong>
        </button>`).join("")}
    `;
  }

  function filteredDashboardRows(rows) {
    const definition = liveStatusFilterDefinitions(rows).find(def => def.key === state.liveStatusFilter);
    return definition ? rows.filter(definition.matches) : rows;
  }

  let liveScrollSyncLock = false;

  function refreshLiveFloatingScrollbar() {
    const tableWrap = $("#liveTable");
    const proxy = $("#liveTableScrollProxy");
    if (!tableWrap || !proxy) return;
    const inner = proxy.querySelector(".floating-h-scroll-inner");
    if (!inner) return;

    const hasOverflow = tableWrap.scrollWidth > tableWrap.clientWidth + 2;
    const rect = tableWrap.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const tableIsOnScreen = rect.bottom > 0 && rect.top < viewportHeight;
    const nativeBottomScrollbarIsBelowViewport = rect.bottom > viewportHeight - 2;
    const shouldFloat = hasOverflow && tableIsOnScreen && nativeBottomScrollbarIsBelowViewport;

    inner.style.width = `${Math.max(tableWrap.scrollWidth, tableWrap.clientWidth)}px`;

    if (!shouldFloat) {
      proxy.classList.add("hidden");
      return;
    }

    const left = Math.max(8, rect.left);
    const right = Math.min(window.innerWidth - 8, rect.right);
    const width = Math.max(120, right - left);
    proxy.style.left = `${left}px`;
    proxy.style.width = `${width}px`;
    proxy.style.bottom = "8px";
    proxy.classList.remove("hidden");

    if (!liveScrollSyncLock && Math.abs(proxy.scrollLeft - tableWrap.scrollLeft) > 1) {
      proxy.scrollLeft = tableWrap.scrollLeft;
    }
  }

  function setupLiveFloatingScrollbar() {
    const tableWrap = $("#liveTable");
    const proxy = $("#liveTableScrollProxy");
    if (!tableWrap || !proxy || proxy.dataset.bound === "1") {
      refreshLiveFloatingScrollbar();
      return;
    }
    proxy.dataset.bound = "1";

    tableWrap.addEventListener("scroll", () => {
      if (liveScrollSyncLock) return;
      liveScrollSyncLock = true;
      proxy.scrollLeft = tableWrap.scrollLeft;
      liveScrollSyncLock = false;
    }, { passive: true });

    proxy.addEventListener("scroll", () => {
      if (liveScrollSyncLock) return;
      liveScrollSyncLock = true;
      tableWrap.scrollLeft = proxy.scrollLeft;
      liveScrollSyncLock = false;
    }, { passive: true });

    window.addEventListener("scroll", refreshLiveFloatingScrollbar, { passive: true });
    window.addEventListener("resize", refreshLiveFloatingScrollbar, { passive: true });
    refreshLiveFloatingScrollbar();
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

    renderLiveStatusFilters(rows);
    const visibleRows = filteredDashboardRows(rows);

    const tableRows = visibleRows.map(row => {
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
        <tbody>${tableRows || `<tr><td colspan="7">${rows.length ? "No hay personas que coincidan con este filtro." : "No hay cobertura programada para esta fecha."}</td></tr>`}</tbody>
      </table>`;
    $("#lastRefreshLabel").textContent = `Actualizado ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
    setupLiveFloatingScrollbar();
    requestAnimationFrame(refreshLiveFloatingScrollbar);
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

  function canManageAccountUser(user) {
    const currentRole = String(state.currentProfile?.role || "").toLowerCase();
    const targetRole = String(user?.role || "").toLowerCase();
    if (currentRole === "admin") return true;
    // Un supervisor puede gestionar operarios y otros supervisores,
    // pero nunca crear/editar/eliminar administradores.
    return currentRole === "supervisor" && ["operator", "supervisor"].includes(targetRole);
  }

  function hasRealRecoveryEmail(user) {
    const email = String(user?.email || "").trim().toLowerCase();
    return Boolean(email && email.includes("@") && !email.endsWith("@cleanit.ar"));
  }

  function renderUsers() {
    const list = $("#usersList");
    list.innerHTML = state.profiles.map(user => {
      const manageable = canManageAccountUser(user);
      const username = user.username || (String(user.email || "").toLowerCase().endsWith("@cleanit.ar") ? String(user.email).split("@")[0] : "Sin usuario");
      const recoveryEmail = hasRealRecoveryEmail(user) ? user.email : "Sin email real de recuperación";
      return `
      <div class="list-item">
        <div class="list-item-title">${escapeHtml(user.full_name)}</div>
        <div class="muted small">${escapeHtml(roleLabel(user.role).replace(/^./, c => c.toUpperCase()))} · Usuario: <strong>${escapeHtml(username)}</strong></div>
        <div class="muted small ${hasRealRecoveryEmail(user) ? "" : "warning-text"}">Email recuperación: ${escapeHtml(recoveryEmail)}</div>
        <div class="muted small">${escapeHtml(user.phone || "Sin teléfono")}</div>
        ${user.notes ? `<div class="muted small">Notas: ${escapeHtml(user.notes)}</div>` : ""}
        <div class="list-item-actions">
          ${manageable ? `<button class="secondary-btn small-btn" data-edit-user="${user.id}" type="button">Editar</button>` : ""}
          ${manageable ? `<button class="secondary-btn small-btn" data-set-password="${user.id}" type="button">Cambiar contraseña</button>` : ""}
          ${manageable ? `<button class="danger-btn small-btn" data-delete-user="${user.id}" type="button">Eliminar</button>` : ""}
        </div>
      </div>`;
    }).join("") || `<p class="muted">No hay usuarios cargados.</p>`;

    list.querySelectorAll("[data-edit-user]").forEach(btn => btn.addEventListener("click", () => editUser(btn.dataset.editUser)));
    list.querySelectorAll("[data-delete-user]").forEach(btn => btn.addEventListener("click", () => deleteUser(btn.dataset.deleteUser)));
    list.querySelectorAll("[data-set-password]").forEach(btn => btn.addEventListener("click", () => setUserPasswordPrompt(btn.dataset.setPassword)));
  }

  function syncUserRolePermissions() {
    const currentRole = String(state.currentProfile?.role || "").toLowerCase();
    const isAdmin = currentRole === "admin";
    const isSupervisor = currentRole === "supervisor";
    const select = $("#userRole");
    if (!select) return;

    Array.from(select.options).forEach(option => {
      if (isAdmin) {
        option.disabled = false;
      } else if (isSupervisor) {
        option.disabled = !["operator", "supervisor"].includes(option.value);
      } else {
        option.disabled = option.value !== "operator";
      }
    });

    // Si el valor actual quedó fuera de los permisos del usuario, vuelve a Operario.
    const selected = select.options[select.selectedIndex];
    if (selected?.disabled) select.value = "operator";
  }

  function syncUserFormFields() {
    const isEditing = Boolean($("#userId").value);
    const role = $("#userRole").value;
    const passwordInput = $("#userPassword");
    const passwordLabel = $("#userPasswordLabel");
    const passwordHelp = $("#userPasswordHelp");

    syncUserRolePermissions();
    passwordInput.required = !isEditing;
    passwordLabel.textContent = isEditing ? "Nueva contraseña (opcional)" : "Contraseña inicial";
    passwordInput.placeholder = isEditing ? "Dejar vacío para mantener la actual" : "Mínimo 6 caracteres";

    if (isEditing) {
      passwordHelp.textContent = "Si no querés cambiar la contraseña, dejá este campo vacío. El email debe ser real para que funcione «Olvidaste tu contraseña».";
    } else if (role === "operator") {
      passwordHelp.textContent = "Para operarios podés usar el DNI como contraseña inicial. Luego la persona podrá recuperarla por email.";
    } else {
      passwordHelp.textContent = "Definí la contraseña inicial que quieras. No hace falta crear el usuario manualmente en Supabase ni copiar ningún UUID.";
    }
  }

  function userAccountPayloadFromForm() {
    const username = $("#userUsername").value.trim();
    const email = $("#userEmail").value.trim().toLowerCase();
    const password = $("#userPassword").value;
    const fullName = $("#userName").value.trim();
    if (username.length < 3) throw new Error("El nombre de usuario debe tener al menos 3 caracteres.");
    if (!email || !email.includes("@") || email.endsWith("@cleanit.ar")) throw new Error("Cargá un email real para recuperación de contraseña.");
    if (!fullName) throw new Error("Cargá nombre y apellido.");
    if (!$("#userId").value && password.length < 6) throw new Error("La contraseña inicial debe tener al menos 6 caracteres.");
    if (password && password.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");
    return {
      username,
      email,
      password,
      full_name: fullName,
      phone: $("#userPhone").value.trim(),
      role: $("#userRole").value,
      notes: $("#userNotes").value.trim()
    };
  }

  function resetUserForm() {
    $("#userForm").reset();
    $("#userId").value = "";
    $("#userUsername").value = "";
    $("#userEmail").value = "";
    $("#userPassword").value = "";
    $("#userRole").value = "operator";
    $("#userFormTitle").textContent = "Nuevo usuario";
    $("#cancelUserEditBtn").classList.add("hidden");
    syncUserFormFields();
  }

  function editUser(id) {
    const user = byId(state.profiles, id);
    if (!user || !canManageAccountUser(user)) return;
    $("#userId").value = user.id;
    $("#userRole").value = user.role || "operator";
    $("#userUsername").value = user.username || (String(user.email || "").toLowerCase().endsWith("@cleanit.ar") ? String(user.email).split("@")[0] : "");
    $("#userEmail").value = hasRealRecoveryEmail(user) ? user.email : "";
    $("#userPassword").value = "";
    $("#userName").value = user.full_name || "";
    $("#userPhone").value = user.phone || "";
    $("#userNotes").value = user.notes || "";
    $("#userFormTitle").textContent = "Editar usuario";
    $("#cancelUserEditBtn").classList.remove("hidden");
    syncUserFormFields();
    renderTab("users");
  }

  async function deleteUser(id) {
    const user = byId(state.profiles, id);
    if (!user || !canManageAccountUser(user)) return;
    if (id === state.currentProfile?.id) {
      toast("No podés eliminar tu propio usuario mientras estás logueado.");
      return;
    }
    if (!window.confirm("¿Eliminar este usuario? También se darán de baja sus asignaciones activas.")) return;
    await store.deleteProfile(id);
    toast("Usuario eliminado.");
    await renderSupervisorView();
  }

  async function setUserPasswordPrompt(id) {
    const user = byId(state.profiles, id);
    if (!user || !canManageAccountUser(user)) return;
    const password = window.prompt(`Nueva contraseña para ${user.full_name} (mínimo 6 caracteres):`);
    if (!password) return;
    try {
      await store.setManagedUserPassword(id, password.trim());
      toast("Contraseña actualizada.", "success");
    } catch (error) {
      toast(error.message || "No se pudo cambiar la contraseña.");
    }
  }

  function eventTimestamp(event) {
    return event?.client_time || event?.created_at || null;
  }

  function latestEventFromList(events, type) {
    const allowed = Array.isArray(type) ? type : [type];
    return [...events]
      .filter(event => allowed.includes(event.event_type))
      .sort((a, b) => new Date(eventTimestamp(b) || 0) - new Date(eventTimestamp(a) || 0))[0] || null;
  }

  function assignmentHistoricalEnd(assignment) {
    if (assignment.valid_to) return assignment.valid_to;
    if (assignment.is_active === false) {
      const changed = assignment.updated_at || assignment.created_at;
      return changed ? String(changed).slice(0, 10) : null;
    }
    return null;
  }

  function assignmentAppliesHistorically(assignment, dateString) {
    const day = (() => { const d = parseISODate(dateString).getDay(); return d === 0 ? 7 : d; })();
    const days = Array.isArray(assignment.days_of_week) ? assignment.days_of_week.map(Number) : [];
    if (!days.includes(day)) return false;
    const start = assignment.valid_from || String(assignment.created_at || "").slice(0, 10);
    const end = assignmentHistoricalEnd(assignment);
    if (start && start > dateString) return false;
    if (end && end < dateString) return false;
    return true;
  }

  function scheduledRangeForShift(dateString, startTime, endTime) {
    const start = new Date(`${dateString}T${String(startTime || "00:00").slice(0, 5)}:00`);
    let end = new Date(`${dateString}T${String(endTime || "00:00").slice(0, 5)}:00`);
    if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  function eventInsideLabel(event) {
    if (!event) return "";
    return event.is_inside_site === true ? "Sí" : event.is_inside_site === false ? "No" : "";
  }

  function getHistoricalShiftEvaluation(shift, events, now = new Date()) {
    const entry = latestEventFromList(events, "present");
    const exit = latestEventFromList(events, "checkout");
    const absentEvent = latestEventFromList(events, "absent");
    const lateEvent = latestEventFromList(events, "late");
    const { start, end } = scheduledRangeForShift(shift.shift_date, shift.scheduled_start, shift.scheduled_end);
    const grace = Number(shift.grace_minutes ?? 10);
    const absentAfter = Number(shift.absence_after_minutes ?? 30);
    const isFuture = now.getTime() < start.getTime();
    const absenceDue = now.getTime() > start.getTime() + absentAfter * 60000;
    const exitDue = now.getTime() > end.getTime() + grace * 60000;

    let entryStatus = "Pendiente";
    let entryKey = "pending";
    let source = "Programación";
    if (entry) {
      source = "Marcación";
      if (entry.is_inside_site === false) { entryStatus = "Entrada fuera de radio"; entryKey = "outside"; }
      else if (entry.observed_status === "late" || new Date(eventTimestamp(entry)).getTime() > start.getTime() + grace * 60000) { entryStatus = "Entrada tarde"; entryKey = "late"; }
      else { entryStatus = "Entrada correcta"; entryKey = "present"; }
    } else if (absentEvent) {
      entryStatus = "Ausente registrado";
      entryKey = "absent";
      source = "Ausencia registrada";
    } else if (!isFuture && absenceDue) {
      entryStatus = "Sin entrada / ausencia inferida";
      entryKey = "absent";
      source = "Inferido por programación";
    } else if (lateEvent) {
      entryStatus = "Demora informada";
      entryKey = "late";
      source = "Demora registrada";
    }

    let exitStatus = "Sin entrada";
    let exitKey = "not_started";
    if (exit) {
      source = source === "Programación" ? "Marcación" : source;
      if (exit.is_inside_site === false) { exitStatus = "Salida fuera de radio"; exitKey = "exit_outside"; }
      else if (exit.observed_status === "early_exit" || new Date(eventTimestamp(exit)).getTime() < end.getTime() - grace * 60000) { exitStatus = "Salida anticipada"; exitKey = "early_exit"; }
      else { exitStatus = "Salida correcta"; exitKey = "completed"; }
    } else if (entry) {
      if (exitDue) { exitStatus = "Salida no registrada"; exitKey = "missing_exit"; }
      else {
        exitStatus = entryKey === "outside" ? "En servicio · entrada fuera de radio" : entryKey === "late" ? "En servicio · entrada tarde" : "En servicio";
        exitKey = "in_service";
      }
    }

    const alerts = [];
    const entryIsLate = Boolean(entry) && (entry.observed_status === "late" || new Date(eventTimestamp(entry)).getTime() > start.getTime() + grace * 60000);
    if (entryKey === "late" || entryIsLate) alerts.push("Llegada tarde");
    if (entryKey === "outside") alerts.push("Entrada fuera de radio");
    if (entryKey === "absent") alerts.push("Ausencia / sin entrada");
    if (exitKey === "early_exit") alerts.push("Salida anticipada");
    if (exitKey === "exit_outside") alerts.push("Salida fuera de radio");
    if (exitKey === "missing_exit") alerts.push("Salida no registrada");

    let operational = "Pendiente";
    if (entryKey === "absent") operational = entryStatus;
    else if (entry && !exit) operational = exitStatus;
    else if (entry && exit) {
      if (exitKey === "early_exit") operational = "Jornada con salida anticipada";
      else if (exitKey === "exit_outside") operational = "Jornada · salida fuera de radio";
      else if (entryKey === "outside") operational = "Jornada completa · entrada fuera de radio";
      else if (entryKey === "late") operational = "Jornada completa · entrada tarde";
      else operational = "Jornada completa";
    } else if (isFuture) operational = "Programado";

    const entryMoment = entry ? new Date(eventTimestamp(entry)) : null;
    const exitMoment = exit ? new Date(eventTimestamp(exit)) : null;
    const rawLateMinutes = entryMoment ? Math.max(0, Math.round((entryMoment.getTime() - start.getTime()) / 60000)) : null;
    const rawEarlyExitMinutes = exitMoment ? Math.max(0, Math.round((end.getTime() - exitMoment.getTime()) / 60000)) : null;
    const lateMinutes = entryMoment ? (entryIsLate ? rawLateMinutes : 0) : null;
    const earlyExitMinutes = exitMoment ? (exitKey === "early_exit" ? rawEarlyExitMinutes : 0) : null;

    return { entry, exit, absentEvent, lateEvent, entryStatus, entryKey, exitStatus, exitKey, operational, alerts, source, lateMinutes, earlyExitMinutes, start, end };
  }

  async function fetchReportContext(period) {
    const [profiles, sites, assignments, events] = await Promise.all([
      store.listAllProfiles(),
      store.listAllSites(),
      store.listAllAssignments(),
      store.listEventsRange(period.from, period.to)
    ]);
    return { profiles, sites, assignments, events };
  }

  function resolveCompleteOperationalPeriod(period, context) {
    if (!period.isAll) return period;
    const starts = [
      ...context.assignments.map(a => a.valid_from || String(a.created_at || "").slice(0, 10)),
      ...context.events.map(e => e.shift_date)
    ];
    const earliest = minISO(starts) || todayISO();
    return { ...period, from: earliest, to: todayISO(), label: `${earliest}-al-${todayISO()}` };
  }

  function buildOperationalExportRows(period, context) {
    const resolved = resolveCompleteOperationalPeriod(period, context);
    const profilesById = new Map(context.profiles.map(item => [item.id, item]));
    const sitesById = new Map(context.sites.map(item => [item.id, item]));
    const eventsByShift = new Map();
    const eventsByAssignmentDate = new Map();
    context.events.forEach(event => {
      if (!eventsByShift.has(event.shift_id)) eventsByShift.set(event.shift_id, []);
      eventsByShift.get(event.shift_id).push(event);
      if (event.assignment_id && event.shift_date) {
        const key = `${event.assignment_id}__${event.shift_date}`;
        if (!eventsByAssignmentDate.has(key)) eventsByAssignmentDate.set(key, []);
        eventsByAssignmentDate.get(key).push(event);
      }
    });

    const rows = [];
    const matchedShiftIds = new Set();
    const reportNow = new Date();

    for (const assignment of context.assignments) {
      let date = maxISO([resolved.from, assignment.valid_from || String(assignment.created_at || "").slice(0, 10)]) || resolved.from;
      const assignmentEnd = assignmentHistoricalEnd(assignment);
      const endDate = minISO([resolved.to, assignmentEnd]) || resolved.to;
      if (!date || !endDate || date > endDate) continue;

      while (date <= endDate) {
        if (assignmentAppliesHistorically(assignment, date)) {
          const shiftId = `${assignment.id}__${date}`;
          const shift = {
            id: shiftId,
            shift_date: date,
            assignment_id: assignment.id,
            operator_id: assignment.operator_id,
            site_id: assignment.site_id,
            scheduled_start: assignment.scheduled_start,
            scheduled_end: assignment.scheduled_end,
            grace_minutes: assignment.grace_minutes ?? 10,
            absence_after_minutes: assignment.absence_after_minutes ?? 30,
            notes: assignment.notes || ""
          };
          const shiftEvents = eventsByShift.get(shiftId) || eventsByAssignmentDate.get(`${assignment.id}__${date}`) || [];
          shiftEvents.forEach(e => matchedShiftIds.add(e.shift_id));
          const evalResult = getHistoricalShiftEvaluation(shift, shiftEvents, reportNow);
          const operator = profilesById.get(assignment.operator_id);
          const site = sitesById.get(assignment.site_id);
          const notes = [assignment.notes, evalResult.absentEvent?.notes, evalResult.lateEvent?.notes, evalResult.entry?.notes, evalResult.exit?.notes].filter(Boolean).join(" | ");

          rows.push({
            "Fecha": date,
            "Operario": operator?.full_name || assignment.operator_id || "",
            "Servicio": site?.name || assignment.site_id || "",
            "Dirección": site?.address || "",
            "Horario programado": `${String(assignment.scheduled_start || "").slice(0, 5)} - ${String(assignment.scheduled_end || "").slice(0, 5)}`,
            "Hora entrada": evalResult.entry ? formatClock(eventTimestamp(evalResult.entry)) : "",
            "Estado entrada": evalResult.entryStatus,
            "Minutos demora": evalResult.lateMinutes ?? "",
            "Entrada dentro radio": eventInsideLabel(evalResult.entry),
            "Distancia entrada (m)": evalResult.entry?.distance_m != null ? Math.round(Number(evalResult.entry.distance_m)) : "",
            "Precisión entrada (m)": evalResult.entry?.gps_accuracy_m != null ? Math.round(Number(evalResult.entry.gps_accuracy_m)) : "",
            "Lat entrada": evalResult.entry?.lat ?? "",
            "Lng entrada": evalResult.entry?.lng ?? "",
            "Hora salida": evalResult.exit ? formatClock(eventTimestamp(evalResult.exit)) : "",
            "Estado salida": evalResult.exitStatus,
            "Minutos salida anticipada": evalResult.earlyExitMinutes ?? "",
            "Salida dentro radio": eventInsideLabel(evalResult.exit),
            "Distancia salida (m)": evalResult.exit?.distance_m != null ? Math.round(Number(evalResult.exit.distance_m)) : "",
            "Precisión salida (m)": evalResult.exit?.gps_accuracy_m != null ? Math.round(Number(evalResult.exit.gps_accuracy_m)) : "",
            "Lat salida": evalResult.exit?.lat ?? "",
            "Lng salida": evalResult.exit?.lng ?? "",
            "Estado operativo": evalResult.operational,
            "Alertas RRHH": evalResult.alerts.join(" | "),
            "Origen del estado": evalResult.source,
            "Observaciones": notes,
            "Assignment ID": assignment.id,
            "Shift ID": shiftId
          });
        }
        date = addDaysISO(date, 1);
      }
    }

    // No se pierden fichajes excepcionales que no puedan reconstruirse desde una asignación vigente/histórica.
    const groupedUnmatched = new Map();
    context.events.forEach(event => {
      if (matchedShiftIds.has(event.shift_id)) return;
      const key = event.shift_id || `${event.operator_id}_${event.shift_date}`;
      if (!groupedUnmatched.has(key)) groupedUnmatched.set(key, []);
      groupedUnmatched.get(key).push(event);
    });
    groupedUnmatched.forEach(events => {
      const sample = events[0];
      const entry = latestEventFromList(events, "present");
      const exit = latestEventFromList(events, "checkout");
      const operator = profilesById.get(sample.operator_id);
      const site = sitesById.get(sample.site_id);
      const alerts = [];
      if (entry?.observed_status === "late") alerts.push("Llegada tarde");
      if (entry?.is_inside_site === false) alerts.push("Entrada fuera de radio");
      if (exit?.observed_status === "early_exit") alerts.push("Salida anticipada");
      if (exit?.is_inside_site === false) alerts.push("Salida fuera de radio");
      rows.push({
        "Fecha": sample.shift_date || "",
        "Operario": operator?.full_name || sample.operator_id || "",
        "Servicio": site?.name || sample.site_id || "",
        "Dirección": site?.address || "",
        "Horario programado": "No reconstruido",
        "Hora entrada": entry ? formatClock(eventTimestamp(entry)) : "",
        "Estado entrada": entry ? (entry.is_inside_site === false ? "Entrada fuera de radio" : entry.observed_status === "late" ? "Entrada tarde" : "Entrada registrada") : "Sin entrada",
        "Minutos demora": "",
        "Entrada dentro radio": eventInsideLabel(entry),
        "Distancia entrada (m)": entry?.distance_m != null ? Math.round(Number(entry.distance_m)) : "",
        "Precisión entrada (m)": entry?.gps_accuracy_m != null ? Math.round(Number(entry.gps_accuracy_m)) : "",
        "Lat entrada": entry?.lat ?? "",
        "Lng entrada": entry?.lng ?? "",
        "Hora salida": exit ? formatClock(eventTimestamp(exit)) : "",
        "Estado salida": exit ? (exit.is_inside_site === false ? "Salida fuera de radio" : exit.observed_status === "early_exit" ? "Salida anticipada" : "Salida registrada") : "",
        "Minutos salida anticipada": "",
        "Salida dentro radio": eventInsideLabel(exit),
        "Distancia salida (m)": exit?.distance_m != null ? Math.round(Number(exit.distance_m)) : "",
        "Precisión salida (m)": exit?.gps_accuracy_m != null ? Math.round(Number(exit.gps_accuracy_m)) : "",
        "Lat salida": exit?.lat ?? "",
        "Lng salida": exit?.lng ?? "",
        "Estado operativo": entry ? (exit ? "Jornada con fichajes" : "En servicio / sin salida") : eventTypeLabel(sample.event_type),
        "Alertas RRHH": alerts.join(" | "),
        "Origen del estado": "Marcación sin turno reconstruido",
        "Observaciones": events.map(e => e.notes).filter(Boolean).join(" | "),
        "Assignment ID": sample.assignment_id || "",
        "Shift ID": sample.shift_id || ""
      });
    });

    rows.sort((a, b) => `${a.Fecha}|${a.Operario}|${a.Servicio}`.localeCompare(`${b.Fecha}|${b.Operario}|${b.Servicio}`));
    return { rows, period: resolved };
  }

  function operationalSummaryByOperator(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = row.Operario || "Sin identificar";
      if (!map.has(key)) map.set(key, { "Operario": key, "Coberturas": 0, "Ingresos correctos": 0, "Llegadas tarde": 0, "Fuera de radio": 0, "Ausencias / sin entrada": 0, "Ausencias registradas": 0, "Sin entrada inferido": 0, "Salidas anticipadas": 0, "Salidas no registradas": 0 });
      const item = map.get(key);
      item["Coberturas"]++;
      if (row["Estado entrada"] === "Entrada correcta") item["Ingresos correctos"]++;
      if (String(row["Estado entrada"]).includes("tarde") || String(row["Alertas RRHH"]).includes("Llegada tarde")) item["Llegadas tarde"]++;
      if (String(row["Alertas RRHH"]).includes("fuera de radio")) item["Fuera de radio"]++;
      if (String(row["Alertas RRHH"]).includes("Ausencia / sin entrada")) item["Ausencias / sin entrada"]++;
      if (row["Origen del estado"] === "Ausencia registrada") item["Ausencias registradas"]++;
      if (row["Origen del estado"] === "Inferido por programación") item["Sin entrada inferido"]++;
      if (String(row["Alertas RRHH"]).includes("Salida anticipada")) item["Salidas anticipadas"]++;
      if (String(row["Alertas RRHH"]).includes("Salida no registrada")) item["Salidas no registradas"]++;
    });
    return Array.from(map.values()).sort((a, b) => a.Operario.localeCompare(b.Operario));
  }

  function operationalSummaryByDate(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = row.Fecha || "Sin fecha";
      if (!map.has(key)) map.set(key, { "Fecha": key, "Coberturas": 0, "Ingresos correctos": 0, "Llegadas tarde": 0, "Fuera de radio": 0, "Ausencias / sin entrada": 0, "Ausencias registradas": 0, "Sin entrada inferido": 0, "Alertas de salida": 0 });
      const item = map.get(key);
      item["Coberturas"]++;
      if (row["Estado entrada"] === "Entrada correcta") item["Ingresos correctos"]++;
      if (String(row["Alertas RRHH"]).includes("Llegada tarde")) item["Llegadas tarde"]++;
      if (String(row["Alertas RRHH"]).includes("fuera de radio")) item["Fuera de radio"]++;
      if (String(row["Alertas RRHH"]).includes("Ausencia / sin entrada")) item["Ausencias / sin entrada"]++;
      if (row["Origen del estado"] === "Ausencia registrada") item["Ausencias registradas"]++;
      if (row["Origen del estado"] === "Inferido por programación") item["Sin entrada inferido"]++;
      if (/Salida anticipada|Salida no registrada|Salida fuera de radio/.test(String(row["Alertas RRHH"]))) item["Alertas de salida"]++;
    });
    return Array.from(map.values()).sort((a, b) => a.Fecha.localeCompare(b.Fecha));
  }

  async function getOperationalExportData() {
    const requested = resolvePeriod("live");
    const context = await fetchReportContext(requested);
    return buildOperationalExportRows(requested, context);
  }

  async function exportLiveCsv() {
    const button = $("#exportLiveCsvBtn");
    await withExportButton(button, "Generando...", async () => {
      const { rows, period } = await getOperationalExportData();
      const headers = rows.length ? Object.keys(rows[0]) : ["Fecha", "Operario", "Servicio", "Estado operativo", "Alertas RRHH"];
      downloadCsvObjects(rows, headers, `estado-operativo-cleanit-${period.label}.csv`);
      toast(`${rows.length} cobertura${rows.length === 1 ? "" : "s"} exportada${rows.length === 1 ? "" : "s"} a CSV.`, "success");
    });
  }

  async function exportLiveExcel() {
    const button = $("#exportLiveExcelBtn");
    await withExportButton(button, "Generando...", async () => {
      if (!window.XLSX) throw new Error("No se pudo cargar el módulo de Excel.");
      const { rows, period } = await getOperationalExportData();
      const wb = window.XLSX.utils.book_new();
      const ws = window.XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Sin datos": "No hay coberturas o registros en el período seleccionado." }]);
      applyWorksheetUsability(ws, [12, 28, 30, 34, 19, 13, 27, 15, 18, 20, 20, 14, 14, 13, 28, 23, 18, 20, 20, 14, 14, 38, 40, 28, 38, 38, 42]);
      window.XLSX.utils.book_append_sheet(wb, ws, "Estado operativo");

      const byOperator = operationalSummaryByOperator(rows);
      const wsOperators = window.XLSX.utils.json_to_sheet(byOperator.length ? byOperator : [{ "Operario": "Sin datos" }]);
      applyWorksheetUsability(wsOperators, [28, 13, 18, 16, 16, 22, 20, 20, 20, 23]);
      window.XLSX.utils.book_append_sheet(wb, wsOperators, "Resumen por operario");

      const byDate = operationalSummaryByDate(rows);
      const wsDates = window.XLSX.utils.json_to_sheet(byDate.length ? byDate : [{ "Fecha": "Sin datos" }]);
      applyWorksheetUsability(wsDates, [14, 13, 18, 16, 16, 22, 20, 20, 18]);
      window.XLSX.utils.book_append_sheet(wb, wsDates, "Resumen por día");

      window.XLSX.writeFile(wb, `estado-operativo-cleanit-${period.label}.xlsx`);
      toast(`${rows.length} cobertura${rows.length === 1 ? "" : "s"} exportada${rows.length === 1 ? "" : "s"} a Excel.`, "success");
    });
  }

  function recordExportObject(event, profiles = state.profiles, sites = state.sites) {
    const op = byId(profiles, event.operator_id);
    const site = byId(sites, event.site_id);
    return {
      "Fecha y hora": eventTimestamp(event) || event.created_at || "",
      "Fecha servicio": event.shift_date || "",
      "Operario": op?.full_name || event.operator_id || "",
      "Servicio": site?.name || event.site_id || "",
      "Dirección": site?.address || "",
      "Tipo": event.event_type || "",
      "Tipo legible": eventTypeLabel(event.event_type),
      "Estado": event.observed_status || "",
      "Estado legible": observedStatusLabel(event.observed_status),
      "Lat": event.lat ?? "",
      "Lng": event.lng ?? "",
      "Precisión (m)": event.gps_accuracy_m ?? "",
      "Distancia (m)": event.distance_m ?? "",
      "Dentro radio": event.is_inside_site === true ? "Sí" : event.is_inside_site === false ? "No" : "",
      "Observación": event.notes || "",
      "Assignment ID": event.assignment_id || "",
      "Shift ID": event.shift_id || ""
    };
  }

  async function fetchRecordsForSelectedPeriod() {
    const period = resolvePeriod("records");
    const [events, profiles, sites] = await Promise.all([
      store.listEventsRange(period.from, period.to),
      store.listAllProfiles(),
      store.listAllSites()
    ]);
    return { period, events, profiles, sites };
  }

  async function loadRecordsPeriod() {
    const button = $("#applyRecordsBtn");
    await withExportButton(button, "Cargando...", async () => {
      const result = await fetchRecordsForSelectedPeriod();
      state.recordsEvents = result.events;
      state.recordsProfiles = result.profiles;
      state.recordsSites = result.sites;
      state.recordsLoaded = true;
      renderRecords();
    });
  }

  async function exportRecordsExcel() {
    const button = $("#exportRecordsExcelBtn");
    await withExportButton(button, "Generando...", async () => {
      if (!window.XLSX) throw new Error("No se pudo cargar el módulo de Excel.");
      const { period, events, profiles, sites } = await fetchRecordsForSelectedPeriod();
      const rows = events.map(event => recordExportObject(event, profiles, sites));
      const wb = window.XLSX.utils.book_new();
      const ws = window.XLSX.utils.json_to_sheet(rows.length ? rows : [{ "Sin datos": "No hay marcaciones en el período seleccionado." }]);
      applyWorksheetUsability(ws, [22, 14, 28, 30, 34, 14, 16, 16, 18, 14, 14, 15, 15, 15, 38, 38, 42]);
      window.XLSX.utils.book_append_sheet(wb, ws, "Marcaciones");
      window.XLSX.writeFile(wb, `marcaciones-cleanit-${period.label}.xlsx`);
      toast(`${rows.length} marcación${rows.length === 1 ? "" : "es"} exportada${rows.length === 1 ? "" : "s"} a Excel.`, "success");
    });
  }

  function renderRecords() {
    const events = state.recordsLoaded ? state.recordsEvents : state.events;
    const displayLimit = 1000;
    const displayEvents = events.slice(0, displayLimit);
    const profileSource = state.recordsLoaded ? state.recordsProfiles : state.profiles;
    const siteSource = state.recordsLoaded ? state.recordsSites : state.sites;
    const rows = displayEvents.map(event => {
      const op = byId(profileSource, event.operator_id);
      const site = byId(siteSource, event.site_id);
      return `
        <tr>
          <td>${formatDateTime(eventTimestamp(event) || event.created_at)}</td>
          <td>${escapeHtml(event.shift_date || "—")}</td>
          <td>${escapeHtml(op?.full_name || event.operator_id || "—")}</td>
          <td>${escapeHtml(site?.name || event.site_id || "—")}</td>
          <td><strong>${escapeHtml(eventTypeLabel(event.event_type))}</strong><br><span class="muted small">${escapeHtml(observedStatusLabel(event.observed_status))}</span></td>
          <td>${event.lat != null ? `${Number(event.lat).toFixed(6)}, ${Number(event.lng).toFixed(6)}` : "—"}</td>
          <td>${event.gps_accuracy_m != null ? `${Math.round(Number(event.gps_accuracy_m))} m` : "—"}</td>
          <td>${event.distance_m != null ? `${Math.round(Number(event.distance_m))} m` : "—"}</td>
          <td>${event.is_inside_site === true ? "Sí" : event.is_inside_site === false ? "No" : "—"}</td>
          <td>${escapeHtml(event.notes || "")}</td>
        </tr>`;
    }).join("");

    $("#recordsTable").innerHTML = `
      <table>
        <thead><tr><th>Hora registro</th><th>Fecha servicio</th><th>Operario</th><th>Servicio</th><th>Tipo</th><th>GPS</th><th>Precisión</th><th>Distancia</th><th>Dentro radio</th><th>Obs.</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10">No hay marcaciones para el período seleccionado.</td></tr>`}</tbody>
      </table>`;

    const summary = $("#recordsRangeSummary");
    if (summary) {
      let label = "registros cargados";
      try {
        const period = resolvePeriod("records");
        label = period.isAll ? "historial completo" : period.from === period.to ? formatOperationalDate(period.from) : `${formatOperationalDate(period.from)} al ${formatOperationalDate(period.to)}`;
      } catch (_) { /* conserva etiqueta genérica */ }
      const displayNote = events.length > displayLimit ? ` · mostrando ${displayLimit} en pantalla; la exportación incluye las ${events.length}` : "";
      summary.textContent = `${events.length} marcación${events.length === 1 ? "" : "es"} · ${label}${displayNote}`;
    }
  }

  async function exportCsv() {
    const button = $("#exportCsvBtn");
    await withExportButton(button, "Generando...", async () => {
      const { period, events, profiles, sites } = await fetchRecordsForSelectedPeriod();
      const headers = ["fecha_hora", "fecha_servicio", "operario", "servicio", "tipo", "tipo_legible", "estado", "estado_legible", "lat", "lng", "precision_m", "distancia_m", "dentro_radio", "observacion", "assignment_id", "shift_id"];
      const rows = events.map(event => {
        const op = byId(profiles, event.operator_id);
        const site = byId(sites, event.site_id);
        return {
          fecha_hora: event.created_at || "",
          fecha_servicio: event.shift_date || "",
          operario: op?.full_name || event.operator_id || "",
          servicio: site?.name || event.site_id || "",
          tipo: event.event_type || "",
          tipo_legible: eventTypeLabel(event.event_type),
          estado: event.observed_status || "",
          estado_legible: observedStatusLabel(event.observed_status),
          lat: event.lat ?? "",
          lng: event.lng ?? "",
          precision_m: event.gps_accuracy_m ?? "",
          distancia_m: event.distance_m ?? "",
          dentro_radio: event.is_inside_site === true ? "si" : event.is_inside_site === false ? "no" : "",
          observacion: event.notes || "",
          assignment_id: event.assignment_id || "",
          shift_id: event.shift_id || ""
        };
      });
      downloadCsvObjects(rows, headers, `presentismo-cleanit-${period.label}.csv`);
      toast(`${rows.length} marcación${rows.length === 1 ? "" : "es"} exportada${rows.length === 1 ? "" : "s"} a CSV.`, "success");
    });
  }

  function bindEvents() {
    $$('[data-login-mode]').forEach(btn => btn.addEventListener('click', () => {
      state.loginMode = btn.dataset.loginMode;
      renderLoginMode();
    }));
    $("#supabaseLoginForm").addEventListener("submit", handleSupabaseLogin);
    $("#forgotPasswordBtn").addEventListener("click", () => {
      $("#forgotIdentifier").value = $("#email").value.trim();
      setView("#forgotPasswordView");
    });
    $("#backToLoginBtn").addEventListener("click", () => setView("#loginView"));
    $("#forgotPasswordForm").addEventListener("submit", handleForgotPassword);
    $("#resetPasswordForm").addEventListener("submit", handleResetPassword);
    $("#operatorLogoutBtn").addEventListener("click", logout);
    $("#supervisorLogoutBtn").addEventListener("click", logout);
    $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
      renderTab(btn.dataset.tab);
      if (btn.dataset.tab === "records") loadRecordsPeriod().catch(error => toast(error.message || "No se pudieron cargar los registros."));
    }));
    $("#refreshDashboardBtn").addEventListener("click", renderSupervisorView);
    $("#dashboardDate").addEventListener("change", async () => {
      syncPeriodControls("live", false);
      await renderSupervisorView();
    });
    $("#liveExportPeriod").addEventListener("change", () => syncPeriodControls("live", false));
    $("#exportLiveCsvBtn").addEventListener("click", () => exportLiveCsv().catch(error => toast(error.message || "No se pudo exportar el estado operativo.")));
    $("#exportLiveExcelBtn").addEventListener("click", () => exportLiveExcel().catch(error => toast(error.message || "No se pudo exportar el estado operativo.")));
    $("#kpiGrid").addEventListener("click", (event) => {
      const button = event.target.closest("[data-kpi-detail]");
      if (button) openQuickDetail(button.dataset.kpiDetail);
    });
    $("#liveStatusFilters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-live-filter]");
      if (!button) return;
      state.liveStatusFilter = button.dataset.liveFilter || "all";
      renderDashboard();
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
        const payload = userAccountPayloadFromForm();
        if (isEditing) {
          await store.updateManagedUser($("#userId").value, payload);
        } else {
          await store.createManagedUser(payload);
        }
        resetUserForm();
        toast(isEditing ? "Usuario actualizado." : "Usuario creado.", "success");
        await renderSupervisorView();
      } catch (error) {
        toast(error.message || "No se pudo guardar el usuario.");
      }
    });
    $("#userRole").addEventListener("change", syncUserFormFields);
    $("#cancelUserEditBtn").addEventListener("click", resetUserForm);
    $("#recordsPeriod").addEventListener("change", () => {
      syncPeriodControls("records", false);
      state.recordsLoaded = false;
      if (state.activeTab === "records") loadRecordsPeriod().catch(error => toast(error.message || "No se pudieron cargar los registros."));
    });
    $("#applyRecordsBtn").addEventListener("click", () => loadRecordsPeriod().catch(error => toast(error.message || "No se pudieron cargar los registros.")));
    $("#exportCsvBtn").addEventListener("click", () => exportCsv().catch(error => toast(error.message || "No se pudo exportar el CSV.")));
    $("#exportRecordsExcelBtn").addEventListener("click", () => exportRecordsExcel().catch(error => toast(error.message || "No se pudo exportar el Excel.")));

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
    syncPeriodControls("live", false);
    syncPeriodControls("records", false);
    bindEvents();

    store.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        showPasswordResetView(Boolean(session?.user));
      }
    });

    if (looksLikePasswordRecoveryUrl()) {
      showPasswordResetView(false);
      try {
        const session = await store.getSession();
        if (session?.user) showPasswordResetView(true);
      } catch (_) { /* el formulario mostrará el error si el enlace es inválido */ }
      return;
    }

    try {
      const session = await store.getCurrentSessionProfile();
      if (passwordRecoveryActive) return;
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
