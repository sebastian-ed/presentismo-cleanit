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
    analyticsLoaded: false,
    analyticsAllRows: [],
    analyticsRows: [],
    analyticsSummary: [],
    analyticsDaily: [],
    analyticsProfiles: [],
    analyticsPeriodResolved: null,
    activeTab: "live",
    sectionSearch: { live: "", analytics: "", fichaje: "", coverage: "", assignments: "", sites: "", users: "", records: "" },
    searchCounts: {},
    fichajeLoaded: false,
    fichajeEvents: [],
    fichajeProfiles: [],
    fichajeSites: [],
    bulkSelectedAssignmentIds: new Set(),
    bulkSelectedSiteIds: new Set(),
    assignmentAuditFileName: "",
    assignmentAuditParsed: null,
    assignmentAuditAnalysis: null,
    assignmentAuditFilter: "alerts",
    assignmentAuditSelectedKeys: new Set()
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

  const TAB_SEARCH_META = {
    live: { label: "En vivo", placeholder: "Buscar operario o servicio...", noun: "coberturas", target: "#liveTable" },
    analytics: { label: "Análisis", placeholder: "Buscar operario o servicio...", noun: "coberturas", target: "#analyticsSummaryTable" },
    fichaje: { label: "Fichaje", placeholder: "Buscar operario o servicio...", noun: "fichajes", target: "#fichajeTable" },
    coverage: { label: "Cobertura", placeholder: "Buscar servicio, zona u operario...", noun: "servicios", target: "#coverageGrid" },
    assignments: { label: "Asignaciones", placeholder: "Buscar operario, servicio o tipo de asignación...", noun: "asignaciones", target: "#assignmentsList" },
    sites: { label: "Servicios", placeholder: "Buscar servicio, dirección o zona...", noun: "servicios", target: "#sitesList" },
    users: { label: "Usuarios", placeholder: "Buscar nombre, usuario, email o rol...", noun: "usuarios", target: "#usersList" },
    records: { label: "Registros", placeholder: "Buscar operario, servicio o estado...", noun: "marcaciones", target: "#recordsTable" }
  };

  function normalizeSearchText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function sectionSearchTerm(tab = state.activeTab) {
    return normalizeSearchText(state.sectionSearch?.[tab] || "");
  }

  function valuesMatchSearch(term, ...values) {
    const q = normalizeSearchText(term);
    if (!q) return true;
    const words = q.split(" ").filter(Boolean);
    const haystack = normalizeSearchText(values.flat(Infinity).filter(value => value != null).join(" "));
    return words.every(word => haystack.includes(word));
  }

  function objectMatchesSearch(term, object) {
    return valuesMatchSearch(term, ...Object.values(object || {}));
  }

  function updateSectionSearchCount(tab, visible, total) {
    state.searchCounts[tab] = { visible: Number(visible || 0), total: Number(total || 0) };
    if (state.activeTab !== tab) return;
    const label = $("#contextSearchResultLabel");
    if (!label) return;
    const meta = TAB_SEARCH_META[tab] || { noun: "resultados" };
    const hasSearch = Boolean(sectionSearchTerm(tab));
    label.textContent = hasSearch ? `${visible} de ${total} ${meta.noun}` : `${total} ${meta.noun}`;
  }

  function syncContextSearchUI(tab = state.activeTab) {
    const input = $("#contextSearchInput");
    const sectionLabel = $("#contextSearchSectionLabel");
    const clear = $("#clearContextSearchBtn");
    if (!input || !sectionLabel || !clear) return;
    const meta = TAB_SEARCH_META[tab] || TAB_SEARCH_META.live;
    sectionLabel.textContent = meta.label;
    input.placeholder = meta.placeholder;
    input.value = state.sectionSearch?.[tab] || "";
    clear.classList.toggle("hidden", !String(input.value || "").trim());
    const counts = state.searchCounts[tab];
    if (counts) updateSectionSearchCount(tab, counts.visible, counts.total);
    else $("#contextSearchResultLabel").textContent = "";
  }

  function renderSectionForContextSearch(tab = state.activeTab) {
    if (tab === "live") return renderDashboard();
    if (tab === "analytics") return renderAnalyticsFromState();
    if (tab === "fichaje") {
      if (state.fichajeLoaded) return renderFichaje(state.fichajeEvents, state.fichajeProfiles, state.fichajeSites);
      return renderFichaje();
    }
    if (tab === "coverage") return renderCoverage();
    if (tab === "assignments") return renderAssignments();
    if (tab === "sites") return renderSites();
    if (tab === "users") return renderUsers();
    if (tab === "records") return renderRecords();
  }

  function focusCurrentSearchResults() {
    const tab = state.activeTab;
    const meta = TAB_SEARCH_META[tab];
    const target = meta?.target ? $(meta.target) : null;
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.remove("search-target-flash");
    requestAnimationFrame(() => target.classList.add("search-target-flash"));
    window.setTimeout(() => target.classList.remove("search-target-flash"), 1200);
  }

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
    if (kind === "analytics") {
      return { period: $("#analyticsPeriod"), from: $("#analyticsFrom"), to: $("#analyticsTo") };
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

  function formatDurationSeconds(totalSeconds) {
    if (totalSeconds == null || !Number.isFinite(Number(totalSeconds)) || Number(totalSeconds) < 0) return "";
    const seconds = Math.floor(Number(totalSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function workedDuration(entry, exit) {
    if (!entry || !exit) return { seconds: null, minutes: null, decimalHours: null, label: "" };
    const start = new Date(eventTimestamp(entry));
    const end = new Date(eventTimestamp(exit));
    const ms = end.getTime() - start.getTime();
    if (!Number.isFinite(ms) || ms < 0) return { seconds: null, minutes: null, decimalHours: null, label: "" };
    const seconds = Math.floor(ms / 1000);
    return {
      seconds,
      minutes: Math.round((seconds / 60) * 100) / 100,
      decimalHours: Math.round((seconds / 3600) * 10000) / 10000,
      label: formatDurationSeconds(seconds)
    };
  }

  function minutesToHoursLabel(minutes) {
    const value = Number(minutes || 0);
    if (!Number.isFinite(value) || value < 0) return "00:00";
    const totalMinutes = Math.round(value);
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours} h ${String(mins).padStart(2, "0")} min`;
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
    const range = scheduledRangeForShift(shift.shift_date, shift.scheduled_start, shift.scheduled_end);
    return field === "scheduled_end" ? range.end : range.start;
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

  function assignmentTypeLabel(type) {
    const normalized = String(type || "fixed").toLowerCase();
    if (normalized === "coverage") return "Cobertura por ausencia";
    if (normalized === "reinforcement") return "Refuerzo";
    return "Asignación fija";
  }

  function workTypeLabel(type) {
    const normalized = String(type || "regular").toLowerCase();
    if (normalized === "coverage") return "Cobertura por ausencia";
    if (normalized === "reinforcement") return "Refuerzo";
    return "Trabajo regular";
  }

  function validationLabel(status) {
    const normalized = String(status || "confirmed").toLowerCase();
    if (normalized === "pending") return "Pendiente de validar";
    if (normalized === "rejected") return "Rechazado";
    return "Validado";
  }

  function assignmentAppliesOnDate(assignment, dateString) {
    if (!assignment || assignment.is_active === false) return false;
    const day = (() => { const d = new Date(`${dateString}T12:00:00`).getDay(); return d === 0 ? 7 : d; })();
    if (!(assignment.days_of_week || []).map(Number).includes(day)) return false;
    if (assignment.valid_from && assignment.valid_from > dateString) return false;
    if (assignment.valid_to && assignment.valid_to < dateString) return false;
    return true;
  }

  function assignmentsOverlap(a, b) {
    const aStart = String(a?.scheduled_start || "00:00").slice(0, 5);
    const aEnd = String(a?.scheduled_end || "23:59").slice(0, 5);
    const bStart = String(b?.scheduled_start || "00:00").slice(0, 5);
    const bEnd = String(b?.scheduled_end || "23:59").slice(0, 5);
    return aStart < bEnd && bStart < aEnd;
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
      if ($("#extraAssignmentDate")) $("#extraAssignmentDate").value = todayISO();
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

    const activeToday = state.assignments.filter(a => a.operator_id === state.currentProfile.id && assignmentAppliesOnDate(a, today));
    const suppressors = activeToday.filter(a => (a.assignment_type || "fixed") !== "fixed" && a.suppress_regular_assignments === true);
    const todaysAssignments = activeToday
      .filter(a => (a.assignment_type || "fixed") !== "fixed" || !suppressors.some(extra => extra.id !== a.id && assignmentsOverlap(extra, a)))
      .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)));

    const extraEvents = state.events.filter(e =>
      e.operator_id === state.currentProfile.id &&
      e.shift_date === today &&
      e.assignment_id == null &&
      e.entry_source === "operator_extra" &&
      ["coverage", "reinforcement"].includes(String(e.work_type || ""))
    );
    const extraGroups = new Map();
    extraEvents.forEach(event => {
      if (!extraGroups.has(event.shift_id)) extraGroups.set(event.shift_id, []);
      extraGroups.get(event.shift_id).push(event);
    });

    const container = $("#operatorShiftContainer");
    const cards = [];

    if (!todaysAssignments.length && !extraGroups.size) {
      cards.push(`
        <article class="operator-card operator-empty-card">
          <p class="eyebrow">Sin asignación fija para hoy</p>
          <h3>No tenés un servicio programado.</h3>
          <p class="muted no-margin">Si te enviaron a cubrir una ausencia o a reforzar otro servicio, usá la opción extraordinaria de abajo para que el fichaje quede asociado al lugar correcto.</p>
        </article>`);
    }

    todaysAssignments.forEach(assignment => {
      const shiftId = `${assignment.id}__${today}`;
      const entryEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "present");
      const exitEvent = state.events.find(e => e.shift_id === shiftId && e.event_type === "checkout");
      const assignedSite = byId(state.sites, assignment.site_id);
      cards.push(renderGpsOnlyCard(shiftId, entryEvent, exitEvent, assignedSite, assignment));
    });

    extraGroups.forEach((eventsForShift, shiftId) => {
      const entryEvent = eventsForShift.find(e => e.event_type === "present");
      const exitEvent = eventsForShift.find(e => e.event_type === "checkout");
      if (!entryEvent) return;
      const site = byId(state.sites, entryEvent.site_id);
      cards.push(renderSelfReportedExtraCard(shiftId, entryEvent, exitEvent, site));
    });

    const hasOpenExtra = Array.from(extraGroups.values()).some(group => group.some(e => e.event_type === "present") && !group.some(e => e.event_type === "checkout"));
    cards.push(renderExtraDutyStartCard(hasOpenExtra));
    container.innerHTML = cards.join("");

    todaysAssignments.forEach(assignment => {
      const shiftId = `${assignment.id}__${today}`;
      container.querySelector(`[data-gps-checkin="${shiftId}"]`)?.addEventListener("click", () => handleGpsCheckin(shiftId, assignment));
      container.querySelector(`[data-gps-checkout="${shiftId}"]`)?.addEventListener("click", () => handleGpsCheckout(shiftId));
    });
    extraGroups.forEach((eventsForShift, shiftId) => {
      if (!eventsForShift.some(e => e.event_type === "present")) return;
      container.querySelector(`[data-gps-checkout="${shiftId}"]`)?.addEventListener("click", () => handleGpsCheckout(shiftId));
    });
    container.querySelector("[data-extra-checkin]")?.addEventListener("click", handleExtraDutyCheckin);
  }

  function renderGpsOnlyCard(shiftId, entryEvent, exitEvent, assignedSite = null, assignment = null) {
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
    const assignmentType = assignment?.assignment_type || "fixed";
    const isExtraAssignment = assignmentType !== "fixed";
    const coveredOperator = assignment?.covered_operator_id ? byId(state.profiles, assignment.covered_operator_id) : null;
    const assignmentMeta = isExtraAssignment
      ? `<div class="extra-duty-meta"><span class="extra-duty-badge ${assignmentType}">${escapeHtml(assignmentTypeLabel(assignmentType))}</span>${coveredOperator ? `<span class="muted small">Cubre a ${escapeHtml(coveredOperator.full_name || "operario")}</span>` : ""}</div>`
      : "";

    return `
      <article class="operator-card main-checkin">
        <div class="card-title-row">
          <div>
            <p class="eyebrow">Hoy · ${escapeHtml(dateLabel)}</p>
            ${assignmentMeta}
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

  function renderSelfReportedExtraCard(shiftId, entryEvent, exitEvent, site) {
    const checkedOut = Boolean(exitEvent);
    const type = entryEvent.work_type || "coverage";
    const validation = entryEvent.validation_status || "pending";
    const validationClass = validation === "confirmed" ? "status-present" : validation === "rejected" ? "status-rejected" : "status-extra";
    const exitDisabled = checkedOut ? "disabled" : "";
    return `
      <article class="operator-card main-checkin extra-self-card">
        <div class="card-title-row">
          <div>
            <p class="eyebrow">Trabajo extraordinario declarado por vos</p>
            <div class="extra-duty-meta">
              <span class="extra-duty-badge ${escapeHtml(type)}">${escapeHtml(workTypeLabel(type))}</span>
              <span class="status-pill ${validationClass}">${escapeHtml(validationLabel(validation))}</span>
            </div>
            <h3 class="service-title">${escapeHtml(site?.name || "Servicio")}</h3>
            <p class="muted">${escapeHtml(site?.address || "")}</p>
          </div>
          <span class="status-pill ${checkedOut ? "status-present" : "status-ok"}">${checkedOut ? "Servicio completado" : "En servicio"}</span>
        </div>
        <div class="meta-grid">
          <div class="meta-item"><strong>Entrada</strong><span class="meta-subline">${formatDateTime(entryEvent.client_time || entryEvent.created_at)} · ${gpsSummary(entryEvent)}</span></div>
          <div class="meta-item"><strong>Salida</strong><span class="meta-subline">${exitEvent ? `${formatDateTime(exitEvent.client_time || exitEvent.created_at)} · ${gpsSummary(exitEvent)}` : "Sin salida registrada"}</span></div>
        </div>
        <div class="checkin-box exit-box">
          <div class="checkpoint-title-row">
            <strong>Salida del servicio</strong>
            <span class="status-pill ${checkedOut ? "status-present" : "status-pending"}">${checkedOut ? "Registrada" : "Pendiente"}</span>
          </div>
          <label class="checkbox-row">
            <input type="checkbox" id="confirm-out-${escapeHtml(shiftId)}" ${exitDisabled} />
            <span><strong>Confirmo que estoy saliendo del servicio</strong><br><span class="muted small">La salida queda vinculada a esta cobertura/refuerzo.</span></span>
          </label>
          <label><span>Observación opcional</span><textarea id="notes-out-${escapeHtml(shiftId)}" ${exitDisabled} placeholder="Ej. Finalizó normal..."></textarea></label>
          <button class="secondary-btn big-action" data-gps-checkout="${escapeHtml(shiftId)}" type="button" ${exitDisabled}>Registrar salida con GPS</button>
        </div>
      </article>`;
  }

  function renderExtraDutyStartCard(hasOpenExtra = false) {
    const options = state.sites.map(site => `<option value="${site.id}">${escapeHtml(site.name)}${site.address ? ` · ${escapeHtml(site.address)}` : ""}</option>`).join("");
    return `
      <article class="operator-card extra-duty-start-card">
        <div class="card-title-row">
          <div>
            <p class="eyebrow">Situación excepcional</p>
            <h3>¿Te enviaron a cubrir o reforzar otro servicio?</h3>
            <p class="muted small no-margin">Usá esta opción solo si el supervisor todavía no cargó la tarea extraordinaria. El registro queda identificado como declarado por el operario y pendiente de validación.</p>
          </div>
          <span class="status-pill status-extra">Extraordinario</span>
        </div>
        ${hasOpenExtra ? `<div class="inline-warning">Ya tenés una cobertura/refuerzo extraordinario abierto. Registrá su salida antes de iniciar otro.</div>` : ""}
        <div class="extra-duty-operator-grid">
          <label><span>Tipo</span><select id="operatorExtraType" ${hasOpenExtra ? "disabled" : ""}><option value="coverage">Cobertura por ausencia</option><option value="reinforcement">Refuerzo</option></select></label>
          <label><span>Servicio</span><select id="operatorExtraSite" ${hasOpenExtra ? "disabled" : ""}>${options}</select></label>
          <label class="extra-notes-field"><span>Motivo / observación</span><input id="operatorExtraNotes" ${hasOpenExtra ? "disabled" : ""} placeholder="Ej. Me envió supervisor Juan para cubrir una ausencia" /></label>
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="operatorExtraConfirm" ${hasOpenExtra ? "disabled" : ""} />
          <span><strong>Confirmo que fui enviado a este servicio</strong><br><span class="muted small">Se registrarán hora, GPS, servicio y tipo de trabajo.</span></span>
        </label>
        <button class="primary-btn big-action" data-extra-checkin type="button" ${hasOpenExtra || !state.sites.length ? "disabled" : ""}>Registrar entrada extraordinaria</button>
      </article>`;
  }

  async function handleExtraDutyCheckin() {
    const siteId = $("#operatorExtraSite")?.value;
    const type = $("#operatorExtraType")?.value || "coverage";
    const notes = $("#operatorExtraNotes")?.value || "";
    const confirm = $("#operatorExtraConfirm");
    if (!confirm?.checked) return toast("Confirmá que fuiste enviado a ese servicio.");
    const site = byId(state.sites, siteId);
    if (!site) return toast("Seleccioná el servicio al que fuiste enviado.");

    const existingOpen = state.events.some(e => e.operator_id === state.currentProfile.id && e.shift_date === todayISO() && e.assignment_id == null && e.entry_source === "operator_extra" && e.event_type === "present" && !state.events.some(x => x.shift_id === e.shift_id && x.event_type === "checkout"));
    if (existingOpen) return toast("Ya tenés una cobertura/refuerzo extraordinario abierto. Registrá primero la salida.");

    try {
      toast("Solicitando GPS de alta precisión...");
      const position = await getPosition();
      const { latitude, longitude, accuracy } = position.coords;
      const distance = haversineMeters(latitude, longitude, Number(site.lat), Number(site.lng));
      const isInside = distance <= Number(site.gps_radius_m || 120);
      const shiftId = `extra__${state.currentProfile.id}__${todayISO()}__${Date.now()}`;
      await store.createEvent({
        shift_id: shiftId,
        assignment_id: null,
        shift_date: todayISO(),
        operator_id: state.currentProfile.id,
        site_id: site.id,
        event_type: "present",
        observed_status: "present",
        work_type: type,
        entry_source: "operator_extra",
        validation_status: "pending",
        notes: `Trabajo extraordinario declarado por operario. ${notes}${isInside ? "" : " · Entrada fuera de radio."}`.trim(),
        lat: latitude,
        lng: longitude,
        gps_accuracy_m: accuracy,
        distance_m: distance,
        is_inside_site: isInside,
        client_time: new Date().toISOString()
      });
      toast(`${workTypeLabel(type)} registrada en ${site.name}. Quedó pendiente de validación del supervisor.`, "success");
      await renderOperatorView();
    } catch (error) {
      toast(error.message || "No se pudo registrar el trabajo extraordinario.");
    }
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
          work_type: "regular",
          entry_source: "operator_extra",
          validation_status: "pending",
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
        work_type: assignment.assignment_type === "coverage" ? "coverage" : assignment.assignment_type === "reinforcement" ? "reinforcement" : "regular",
        entry_source: "assignment",
        validation_status: "confirmed",
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
        assignment_id: entryEvent.assignment_id || null,
        shift_date: today,
        operator_id: state.currentProfile.id,
        site_id: entryEvent.site_id,
        event_type: "checkout",
        observed_status: "on_time_exit",
        work_type: entryEvent.work_type || "regular",
        entry_source: entryEvent.entry_source || (entryEvent.assignment_id ? "assignment" : "operator_extra"),
        validation_status: entryEvent.validation_status || (entryEvent.assignment_id ? "confirmed" : "pending"),
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

  function buildFichajeRows(dateFrom, dateTo, operatorFilter, sourceEvents = state.events, sourceProfiles = state.profiles, sourceSites = state.sites) {
    const events = sourceEvents.filter(e => e.shift_date >= dateFrom && e.shift_date <= dateTo);

    const shiftMap = new Map();
    for (const event of events) {
      if (!shiftMap.has(event.shift_id)) {
        shiftMap.set(event.shift_id, { shift_id: event.shift_id, shift_date: event.shift_date, operator_id: event.operator_id, site_id: null });
      }
      const s = shiftMap.get(event.shift_id);
      if (event.event_type === "present") {
        s.entry = event;
        s.work_type = event.work_type || "regular";
        s.entry_source = event.entry_source || "assignment";
        s.validation_status = event.validation_status || "confirmed";
      }
      if (event.event_type === "checkout") s.exit = event;
      if (event.site_id) s.site_id = event.site_id;
    }

    let rows = Array.from(shiftMap.values()).map(s => {
      const operator = byId(sourceProfiles, s.operator_id);
      const site = byId(sourceSites, s.site_id);
      const entryTime = s.entry?.client_time || s.entry?.created_at;
      const exitTime = s.exit?.client_time || s.exit?.created_at;
      const duration = workedDuration(s.entry, s.exit);
      const minutes = duration.minutes;
      const horasLabel = duration.label || "—";

      let estado, estadoClass;
      if (s.entry && s.exit) { estado = "Completo"; estadoClass = "status-present"; }
      else if (s.entry) { estado = "Sin salida"; estadoClass = "status-late"; }
      else { estado = "Sin marcación"; estadoClass = "status-absent"; }

      return {
        shift_date: s.shift_date,
        operator_id: s.operator_id,
        operator_name: operator?.full_name || "—",
        site_name: site?.name || "—",
        work_type: s.work_type || "regular",
        work_type_label: workTypeLabel(s.work_type || "regular"),
        entry_source: s.entry_source || "assignment",
        validation_status: s.validation_status || "confirmed",
        validation_label: validationLabel(s.validation_status || "confirmed"),
        entry_time: entryTime,
        exit_time: exitTime,
        minutes,
        seconds: duration.seconds,
        decimalHours: duration.decimalHours,
        horasLabel,
        estado,
        estadoClass
      };
    });

    if (operatorFilter) rows = rows.filter(r => r.operator_id === operatorFilter);
    rows.sort((a, b) => `${b.shift_date}${a.operator_name}`.localeCompare(`${a.shift_date}${b.operator_name}`));
    return rows;
  }

  function renderFichaje(sourceEvents = state.events, sourceProfiles = state.profiles, sourceSites = state.sites) {
    const dateFrom = $("#fichajeFrom").value || todayISO();
    const dateTo = $("#fichajeTo").value || todayISO();
    const operatorFilter = $("#fichajeOperator").value || "";

    // Populate operator selector
    const select = $("#fichajeOperator");
    const currentVal = select.value;
    const operators = sourceProfiles.filter(p => p.role === "operator").sort((a, b) => a.full_name.localeCompare(b.full_name));
    select.innerHTML = `<option value="">Todos</option>` + operators.map(op => `<option value="${op.id}" ${op.id === currentVal ? "selected" : ""}>${escapeHtml(op.full_name)}</option>`).join("");

    const allRows = buildFichajeRows(dateFrom, dateTo, operatorFilter, sourceEvents, sourceProfiles, sourceSites);
    const searchTerm = sectionSearchTerm("fichaje");
    const rows = searchTerm ? allRows.filter(row => valuesMatchSearch(searchTerm, row.operator_name, row.site_name, row.work_type_label, row.estado, row.shift_date, row.validation_label)) : allRows;
    updateSectionSearchCount("fichaje", rows.length, allRows.length);

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
      ${kpi("Horas totales período", minutesToHoursLabel(totalMinutes))}
    `;

    const tableRows = rows.map(row => `
      <tr class="${searchTerm ? "search-match-row" : ""}">
        <td>${escapeHtml(row.shift_date)}</td>
        <td><strong>${escapeHtml(row.operator_name)}</strong></td>
        <td>${escapeHtml(row.site_name)}</td>
        <td>${escapeHtml(row.work_type_label)}${row.entry_source === "operator_extra" ? `<br><span class="muted small">Declarado por operario · ${escapeHtml(row.validation_label)}</span>` : ""}</td>
        <td>${row.entry_time ? formatDateTime(row.entry_time) : "—"}</td>
        <td>${row.exit_time ? formatDateTime(row.exit_time) : "—"}</td>
        <td><strong>${escapeHtml(row.horasLabel)}</strong></td>
        <td><span class="status-pill ${row.estadoClass}">${escapeHtml(row.estado)}</span></td>
      </tr>`).join("");

    $("#fichajeTable").innerHTML = `
      <table>
        <thead>
          <tr><th>Fecha</th><th>Operario</th><th>Servicio</th><th>Tipo de trabajo</th><th>Entrada</th><th>Salida</th><th>Horas trabajadas</th><th>Estado</th></tr>
        </thead>
        <tbody>${tableRows || `<tr><td colspan="8">No hay registros en el período seleccionado.</td></tr>`}</tbody>
      </table>`;
  }

  async function loadFichajePeriod() {
    const dateFrom = $("#fichajeFrom").value || todayISO();
    const dateTo = $("#fichajeTo").value || todayISO();
    if (dateFrom > dateTo) throw new Error("La fecha Desde no puede ser posterior a Hasta.");
    const [events, profiles, sites] = await Promise.all([
      store.listEventsRange(dateFrom, dateTo),
      store.listAllProfiles(),
      store.listAllSites()
    ]);
    state.fichajeEvents = events;
    state.fichajeProfiles = profiles;
    state.fichajeSites = sites;
    state.fichajeLoaded = true;
    renderFichaje(events, profiles, sites);
    return { events, profiles, sites, dateFrom, dateTo };
  }

  async function exportFichajeExcel() {
    const dateFrom = $("#fichajeFrom").value || todayISO();
    const dateTo = $("#fichajeTo").value || todayISO();
    const operatorFilter = $("#fichajeOperator").value || "";
    const [events, profiles, sites] = await Promise.all([
      store.listEventsRange(dateFrom, dateTo),
      store.listAllProfiles(),
      store.listAllSites()
    ]);
    const rows = buildFichajeRows(dateFrom, dateTo, operatorFilter, events, profiles, sites);

    // Sheet 1: detalle
    const detalle = rows.map(r => ({
      "Fecha": r.shift_date,
      "Operario": r.operator_name,
      "Servicio": r.site_name,
      "Tipo de trabajo": r.work_type_label,
      "Origen": r.entry_source === "operator_extra" ? "Declarado por operario" : "Asignación",
      "Validación": r.validation_label,
      "Hora entrada": r.entry_time ? new Date(r.entry_time).toLocaleString("es-AR") : "",
      "Hora salida": r.exit_time ? new Date(r.exit_time).toLocaleString("es-AR") : "",
      "Duración exacta (hh:mm:ss)": r.horasLabel === "—" ? "" : r.horasLabel,
      "Minutos trabajados": r.minutes ?? "",
      "Horas trabajadas (decimal)": r.decimalHours ?? "",
      "Estado": r.estado
    }));

    // Sheet 2: resumen por operario
    const totals = new Map();
    const dailyTotals = new Map();
    for (const row of rows) {
      if (!totals.has(row.operator_id)) totals.set(row.operator_id, { Operario: row.operator_name, "Jornadas completas": 0, "Total segundos": 0 });
      const t = totals.get(row.operator_id);
      if (row.seconds !== null) { t["Jornadas completas"]++; t["Total segundos"] += row.seconds; }
      const dailyKey = `${row.shift_date}__${row.operator_id}`;
      if (!dailyTotals.has(dailyKey)) dailyTotals.set(dailyKey, { Fecha: row.shift_date, Operario: row.operator_name, "Turnos completos": 0, "Total segundos": 0 });
      const d = dailyTotals.get(dailyKey);
      if (row.seconds !== null) { d["Turnos completos"]++; d["Total segundos"] += row.seconds; }
    }
    const resumen = Array.from(totals.values()).map(t => ({
      Operario: t.Operario,
      "Jornadas completas": t["Jornadas completas"],
      "Total exacto (hh:mm:ss)": formatDurationSeconds(t["Total segundos"]),
      "Total minutos": Math.round((t["Total segundos"] / 60) * 100) / 100,
      "Total horas (decimal)": Math.round((t["Total segundos"] / 3600) * 10000) / 10000
    })).sort((a, b) => a.Operario.localeCompare(b.Operario));
    const diario = Array.from(dailyTotals.values()).map(d => ({
      Fecha: d.Fecha,
      Operario: d.Operario,
      "Turnos completos": d["Turnos completos"],
      "Total exacto (hh:mm:ss)": formatDurationSeconds(d["Total segundos"]),
      "Total minutos": Math.round((d["Total segundos"] / 60) * 100) / 100,
      "Total horas (decimal)": Math.round((d["Total segundos"] / 3600) * 10000) / 10000
    })).sort((a, b) => `${a.Fecha}|${a.Operario}`.localeCompare(`${b.Fecha}|${b.Operario}`));

    const wb = window.XLSX.utils.book_new();
    const wsDetail = window.XLSX.utils.json_to_sheet(detalle.length ? detalle : [{ "Sin datos": "No hay fichajes en el período." }]);
    applyWorksheetUsability(wsDetail, [14, 30, 30, 24, 22, 18, 24, 24, 24, 20, 22, 18]);
    window.XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle");
    const wsResumen = window.XLSX.utils.json_to_sheet(resumen.length ? resumen : [{ Operario: "Sin datos" }]);
    applyWorksheetUsability(wsResumen, [30, 20, 24, 20, 22]);
    window.XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen por operario");
    const wsDiario = window.XLSX.utils.json_to_sheet(diario.length ? diario : [{ Fecha: "Sin datos" }]);
    applyWorksheetUsability(wsDiario, [14, 30, 20, 24, 20, 22]);
    window.XLSX.utils.book_append_sheet(wb, wsDiario, "Horas por día");
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
    if (state.assignmentAuditParsed) analyzeParsedAssignmentAudit();
    else renderAssignmentAudit();
    renderUsers();
    syncUserFormFields();
    renderRecords();
  }

  function renderTab(tab) {
    state.activeTab = tab;
    $$(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tab));
    $$(".tab-panel").forEach(panel => panel.classList.remove("active"));
    $(`#${tab}Tab`).classList.add("active");
    syncContextSearchUI(tab);
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
      || ["early_exit", "exit_outside", "missing_exit", "exit_due"].includes(row.exitStatus.key)
      || (row.isSelfReportedExtra && ["pending", "rejected"].includes(row.extraValidationStatus));
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
    if (row.isSelfReportedExtra && row.extraValidationStatus === "pending") items.push({ label: "Trabajo extraordinario pendiente de validar", className: "status-extra" });
    if (row.isSelfReportedExtra && row.extraValidationStatus === "rejected") items.push({ label: "Trabajo extraordinario rechazado", className: "status-rejected" });
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

  function getSelfReportedExtraDashboardRows() {
    const date = $("#dashboardDate")?.value || todayISO();
    const events = state.events.filter(event => event.shift_date === date && event.assignment_id == null && event.entry_source === "operator_extra" && ["coverage", "reinforcement"].includes(String(event.work_type || "")));
    const groups = new Map();
    events.forEach(event => {
      if (!groups.has(event.shift_id)) groups.set(event.shift_id, []);
      groups.get(event.shift_id).push(event);
    });
    const rows = [];
    groups.forEach((group, shiftId) => {
      const entryEvent = group.filter(e => e.event_type === "present").sort((a, b) => new Date(b.client_time || b.created_at) - new Date(a.client_time || a.created_at))[0];
      if (!entryEvent) return;
      const exitEvent = group.filter(e => e.event_type === "checkout").sort((a, b) => new Date(b.client_time || b.created_at) - new Date(a.client_time || a.created_at))[0] || null;
      const validation = entryEvent.validation_status || "pending";
      const entryStatus = entryEvent.is_inside_site === false
        ? { key: "outside", label: "Entrada fuera de radio", className: "status-outside" }
        : { key: "present", label: "Entrada registrada", className: "status-present" };
      let exitStatus;
      if (exitEvent) {
        exitStatus = exitEvent.is_inside_site === false
          ? { key: "exit_outside", label: "Salida fuera de radio", className: "status-outside" }
          : { key: "completed", label: "Salida registrada", className: "status-present" };
      } else {
        exitStatus = { key: "in_service_extra", label: "En servicio extraordinario", className: "status-extra" };
      }
      let status = exitEvent ? { ...exitStatus } : { key: "extra", label: `${workTypeLabel(entryEvent.work_type)} · ${validationLabel(validation)}`, className: validation === "rejected" ? "status-rejected" : "status-extra" };
      if (validation === "pending") status = { key: "extra_pending", label: `${workTypeLabel(entryEvent.work_type)} · pendiente de validar`, className: "status-extra" };
      if (validation === "rejected") status = { key: "extra_rejected", label: `${workTypeLabel(entryEvent.work_type)} · rechazado`, className: "status-rejected" };
      const shift = {
        id: shiftId,
        assignment_id: null,
        shift_date: date,
        operator_id: entryEvent.operator_id,
        site_id: entryEvent.site_id,
        scheduled_start: null,
        scheduled_end: null,
        grace_minutes: 0,
        absence_after_minutes: 0,
        assignment_type: entryEvent.work_type || "coverage",
        notes: entryEvent.notes || ""
      };
      const lastEvent = [...group].sort((a, b) => new Date(b.client_time || b.created_at) - new Date(a.client_time || a.created_at))[0];
      rows.push({ shift, entryEvent, exitEvent, manualEvent: null, entryStatus, exitStatus, status, lastEvent, isSelfReportedExtra: true, extraValidationStatus: validation, extraWorkType: entryEvent.work_type || "coverage" });
    });
    return rows;
  }

  function getDashboardRows() {
    const regularRows = state.shifts.map(shift => {
      const entryEvent = getEntryEvent(shift);
      const exitEvent = getExitEvent(shift);
      const manualEvent = getManualEvent(shift);
      const entryStatus = getEntryStatus(shift, entryEvent, manualEvent);
      const exitStatus = getExitStatus(shift, entryEvent, exitEvent);
      const status = getShiftStatus(shift);
      const lastEvent = latestEventForShift(shift.id);
      return { shift, entryEvent, exitEvent, manualEvent, entryStatus, exitStatus, status, lastEvent, isSelfReportedExtra: false };
    });
    return [...regularRows, ...getSelfReportedExtraDashboardRows()].sort((a, b) => `${a.shift.scheduled_start || "99:99"}|${byId(state.sites, a.shift.site_id)?.name || ""}`.localeCompare(`${b.shift.scheduled_start || "99:99"}|${byId(state.sites, b.shift.site_id)?.name || ""}`));
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
      { key: "extra", label: "Coberturas / refuerzos", tone: "extra", matches: row => row.isSelfReportedExtra || ["coverage", "reinforcement"].includes(String(row.shift.assignment_type || "")) },
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

  async function updateExtraValidation(shiftId, status) {
    if (!isManagementProfile()) return toast("No tenés permisos para validar este registro.");
    if (!shiftId || !["confirmed", "rejected"].includes(status)) return;
    const action = status === "confirmed" ? "validar" : "rechazar";
    if (!window.confirm(`¿${action === "validar" ? "Validar" : "Rechazar"} este trabajo extraordinario declarado por el operario?`)) return;
    await store.updateEventsByShift(shiftId, { validation_status: status });
    toast(status === "confirmed" ? "Trabajo extraordinario validado." : "Trabajo extraordinario marcado como rechazado.", status === "confirmed" ? "success" : undefined);
    await renderSupervisorView();
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
    const statusFilteredRows = filteredDashboardRows(rows);
    const searchTerm = sectionSearchTerm("live");
    const visibleRows = searchTerm ? statusFilteredRows.filter(row => {
      const operator = byId(state.profiles, row.shift.operator_id);
      const site = byId(state.sites, row.shift.site_id);
      return valuesMatchSearch(
        searchTerm,
        operator?.full_name, operator?.phone,
        site?.name, site?.address, site?.zone, site?.supervisor_name,
        row.entryStatus?.label, row.exitStatus?.label, row.status?.label,
        assignmentTypeLabel(row.shift.assignment_type || row.extraWorkType || "fixed"),
        row.entryEvent?.notes, row.exitEvent?.notes
      );
    }) : statusFilteredRows;
    updateSectionSearchCount("live", visibleRows.length, statusFilteredRows.length);

    const tableRows = visibleRows.map(row => {
      const { shift, entryEvent, exitEvent, entryStatus, exitStatus, status, lastEvent } = row;
      const operator = byId(state.profiles, shift.operator_id);
      const site = byId(state.sites, shift.site_id);
      const message = row.isSelfReportedExtra ? `Trabajo extraordinario registrado por ${operator?.full_name || "operario"} en ${site?.name || "servicio"}.` : buildWhatsAppMessage(shift, status);
      const url = whatsappUrl(site?.whatsapp_phone, message);
      const assignmentType = row.isSelfReportedExtra ? (row.extraWorkType || "coverage") : (shift.assignment_type || "fixed");
      const typeBadge = assignmentType !== "fixed" ? `<span class="extra-duty-badge ${escapeHtml(assignmentType)}">${escapeHtml(assignmentTypeLabel(assignmentType))}</span>` : "";
      const validationActions = row.isSelfReportedExtra && row.extraValidationStatus === "pending"
        ? `<div class="validation-actions"><button class="secondary-btn small-btn" data-extra-validation="confirmed" data-extra-shift="${escapeHtml(shift.id)}" type="button">Validar</button><button class="ghost-btn small-btn" data-extra-validation="rejected" data-extra-shift="${escapeHtml(shift.id)}" type="button">Rechazar</button></div>`
        : row.isSelfReportedExtra ? `<span class="muted small">${escapeHtml(validationLabel(row.extraValidationStatus))}</span>` : "";
      const mapButtons = [
        hasCoordinates(entryEvent) ? `<button class="location-btn" data-map-event="${escapeHtml(entryEvent.id)}" type="button">Mapa entrada</button>` : "",
        hasCoordinates(exitEvent) ? `<button class="location-btn" data-map-event="${escapeHtml(exitEvent.id)}" type="button">Mapa salida</button>` : ""
      ].filter(Boolean).join("");

      return `
        <tr class="${searchTerm ? "search-match-row" : ""}">
          <td><strong>${escapeHtml(operator?.full_name || "—")}</strong><br><span class="muted small">${escapeHtml(operator?.phone || "")}</span></td>
          <td><strong>${escapeHtml(site?.name || "—")}</strong><br>${typeBadge ? `${typeBadge}<br>` : ""}<span class="muted small">${escapeHtml(site?.address || "")}</span></td>
          <td>${row.isSelfReportedExtra ? `<span class="extra-schedule-label">Sin horario previo</span>` : `${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}`}</td>
          <td>${statusDetailCell(entryStatus, entryEvent, "Sin entrada")}</td>
          <td>${statusDetailCell(exitStatus, exitEvent, "Sin salida")}</td>
          <td><span class="status-pill ${status.className}">${status.label}</span><br><span class="muted small">${lastEvent ? `${eventTypeLabel(lastEvent.event_type)} · ${formatDateTime(lastEvent.client_time || lastEvent.created_at)}` : "—"}</span></td>
          <td class="row-actions">
            ${mapButtons}
            ${validationActions}
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
    const lines = [row.isSelfReportedExtra ? "Sin horario previo · trabajo extraordinario" : `Horario ${formatTime(shift.scheduled_start)} - ${formatTime(shift.scheduled_end)}`];
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
    return valuesMatchSearch(
      term,
      site.name, site.address, site.zone, site.supervisor_name, site.service_type,
      ...assignments.map(a => byId(state.profiles, a.operator_id)?.full_name || "")
    );
  }

  function renderCoverage() {
    const term = sectionSearchTerm("coverage");
    const grid = $("#coverageGrid");
    const groups = state.sites
      .map(site => ({ site, assignments: state.assignments.filter(a => a.site_id === site.id && (a.assignment_type || "fixed") === "fixed") }));
    const visibleGroups = groups.filter(group => assignmentMatchesSearch(group.site, group.assignments, term));
    updateSectionSearchCount("coverage", visibleGroups.length, groups.length);
    const html = visibleGroups
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
          <article class="service-card ${term ? "search-match-card" : ""}">
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
    const validIds = new Set(state.sites.map(site => site.id));
    state.bulkSelectedSiteIds = new Set([...state.bulkSelectedSiteIds].filter(id => validIds.has(id)));
    const searchTerm = sectionSearchTerm("sites");
    const visibleSites = searchTerm ? state.sites.filter(site => valuesMatchSearch(searchTerm, site.name, site.address, site.zone, site.supervisor_name, site.service_type, site.whatsapp_name, site.whatsapp_phone)) : state.sites;
    updateSectionSearchCount("sites", visibleSites.length, state.sites.length);

    list.innerHTML = visibleSites.map(site => `
      <div class="list-item ${state.bulkSelectedSiteIds.has(site.id) ? "bulk-selected-item" : ""} ${searchTerm ? "search-match-card" : ""}">
        <div class="bulk-select-line">
          <label class="bulk-select-control">
            <input type="checkbox" data-select-site="${site.id}" ${state.bulkSelectedSiteIds.has(site.id) ? "checked" : ""} />
            <span>Seleccionar para cambio masivo</span>
          </label>
        </div>
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

    list.querySelectorAll("[data-select-site]").forEach(input => input.addEventListener("change", () => {
      if (input.checked) state.bulkSelectedSiteIds.add(input.dataset.selectSite);
      else state.bulkSelectedSiteIds.delete(input.dataset.selectSite);
      input.closest(".list-item")?.classList.toggle("bulk-selected-item", input.checked);
      updateBulkSelectionSummaries();
    }));
    list.querySelectorAll("[data-edit-site]").forEach(btn => btn.addEventListener("click", () => editSite(btn.dataset.editSite)));
    list.querySelectorAll("[data-delete-site]").forEach(btn => btn.addEventListener("click", () => deleteSite(btn.dataset.deleteSite)));
    updateBulkSelectionSummaries();
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
    const operatorOptions = operators.map(op => `<option value="${op.id}">${escapeHtml(op.full_name)}</option>`).join("");
    const siteOptions = state.sites.map(site => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join("");
    $("#assignmentOperator").innerHTML = operatorOptions;
    $("#assignmentSite").innerHTML = siteOptions;
    if ($("#extraAssignmentOperator")) $("#extraAssignmentOperator").innerHTML = operatorOptions;
    if ($("#extraAssignmentSite")) $("#extraAssignmentSite").innerHTML = siteOptions;
    if ($("#extraCoveredOperator")) $("#extraCoveredOperator").innerHTML = `<option value="">Sin especificar</option>${operatorOptions}`;
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
        if (end === start) throw new Error(`En ${day.long}, entrada y salida no pueden ser iguales. Los turnos nocturnos, por ejemplo 22:00 a 06:00, sí están permitidos.`);
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


  // ---------------------------------------------------------------------------
  // Auditoría y sincronización de asignaciones contra Excel
  // ---------------------------------------------------------------------------
  function auditEntityKey(value) {
    return normalizeSearchText(value)
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function auditNameTokens(value) {
    return auditEntityKey(value).split(" ").filter(Boolean).sort();
  }

  function auditNameFingerprint(value) {
    return auditNameTokens(value).join("|");
  }

  function auditRowValue(row, candidates) {
    const wanted = new Set((candidates || []).map(auditEntityKey));
    for (const [key, value] of Object.entries(row || {})) {
      if (wanted.has(auditEntityKey(key))) return value;
    }
    return "";
  }

  function auditDayId(value) {
    const key = auditEntityKey(value);
    const map = {
      lunes: 1, lun: 1,
      martes: 2, mar: 2,
      miercoles: 3, mie: 3,
      jueves: 4, jue: 4,
      viernes: 5, vie: 5,
      sabado: 6, sab: 6,
      domingo: 7, dom: 7
    };
    return map[key] || null;
  }

  function auditParseSchedule(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    const match = raw.match(/(\d{1,2}):(\d{2})[^0-9]+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const startH = Number(match[1]);
    const startM = Number(match[2]);
    const endH = Number(match[3]);
    const endM = Number(match[4]);
    if ([startH, endH].some(n => !Number.isInteger(n) || n < 0 || n > 23) || [startM, endM].some(n => !Number.isInteger(n) || n < 0 || n > 59)) return null;
    const start = `${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}`;
    const end = `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
    if (start === end) return null;
    return { start, end, overnight: end < start, raw };
  }

  function auditParseCoordinates(value) {
    const match = String(value || "").replace(/;/g, ",").match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) return null;
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }

  function auditFindSheet(workbook, expectedName, requiredHeaders = []) {
    const expected = auditEntityKey(expectedName);
    const exact = workbook.SheetNames.find(name => auditEntityKey(name) === expected);
    if (exact) return { name: exact, sheet: workbook.Sheets[exact] };
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false, header: 1 });
      const headers = (rows[0] || []).map(auditEntityKey);
      if (requiredHeaders.every(header => headers.includes(auditEntityKey(header)))) return { name, sheet };
    }
    return null;
  }

  async function parseAssignmentAuditFile(file) {
    if (!window.XLSX) throw new Error("No se pudo cargar el módulo de Excel.");
    if (!file) throw new Error("Seleccioná un archivo Excel.");
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: false });
    const coverageSheet = auditFindSheet(workbook, "Cobertura por día", ["Servicio", "Día", "Operario", "Horario"]);
    if (!coverageSheet) throw new Error('No encontré una hoja "Cobertura por día" con las columnas Servicio, Día, Operario y Horario.');

    const coverageRows = window.XLSX.utils.sheet_to_json(coverageSheet.sheet, { defval: "", raw: false });
    const serviceSheet = auditFindSheet(workbook, "Servicios", ["Servicio", "Dirección"]);
    const serviceRows = serviceSheet ? window.XLSX.utils.sheet_to_json(serviceSheet.sheet, { defval: "", raw: false }) : [];
    const serviceMeta = new Map();
    serviceRows.forEach(row => {
      const name = String(auditRowValue(row, ["Servicio"]) || "").trim();
      if (!name) return;
      const coordinates = auditParseCoordinates(auditRowValue(row, ["Coordenadas", "Coordenada"]));
      serviceMeta.set(auditEntityKey(name), {
        name,
        address: String(auditRowValue(row, ["Dirección", "Direccion"]) || "").trim(),
        zone: String(auditRowValue(row, ["Zona"]) || "").trim(),
        supervisor: String(auditRowValue(row, ["Supervisor"]) || "").trim(),
        frequency: String(auditRowValue(row, ["Frecuencia"]) || "fixed").trim() || "fixed",
        coordinates
      });
    });

    const groups = new Map();
    const issues = [];
    let validCoverageRows = 0;
    let noCoverageRows = 0;
    let overnightRows = 0;

    coverageRows.forEach((row, index) => {
      const rowNumber = index + 2;
      const serviceName = String(auditRowValue(row, ["Servicio"]) || "").trim();
      const dayRaw = String(auditRowValue(row, ["Día", "Dia"]) || "").trim();
      const operatorName = String(auditRowValue(row, ["Operario"]) || "").trim();
      const scheduleRaw = String(auditRowValue(row, ["Horario"]) || "").trim();
      if (!serviceName && !dayRaw && !operatorName && !scheduleRaw) return;
      if (!serviceName) {
        issues.push({ rowNumber, type: "invalid", message: "Falta el servicio.", raw: row });
        return;
      }
      const dayId = auditDayId(dayRaw);
      if (!dayId) {
        issues.push({ rowNumber, type: "invalid", message: `Día no reconocido: ${dayRaw || "vacío"}.`, serviceName, raw: row });
        return;
      }
      const serviceKey = auditEntityKey(serviceName);
      const groupKey = `${serviceKey}|${dayId}`;
      if (!groups.has(groupKey)) groups.set(groupKey, { groupKey, serviceKey, serviceName, dayId, dayName: dayLabel(dayId, "long"), expectedRows: [], explicitNoCoverage: false, sourceRows: [] });
      const group = groups.get(groupKey);
      group.sourceRows.push(rowNumber);

      const noCoverage = !operatorName || auditEntityKey(operatorName) === "sin cobertura";
      if (noCoverage) {
        group.explicitNoCoverage = true;
        noCoverageRows++;
        return;
      }
      const schedule = auditParseSchedule(scheduleRaw);
      if (!schedule) {
        group.expectedRows.push({ rowNumber, operatorName, scheduleRaw, invalid: true, message: `Horario no reconocido: ${scheduleRaw || "vacío"}.` });
        return;
      }
      if (schedule.overnight) overnightRows++;
      validCoverageRows++;
      group.expectedRows.push({ rowNumber, operatorName, scheduleRaw, start: schedule.start, end: schedule.end, overnight: schedule.overnight, invalid: false });
    });

    for (const group of groups.values()) {
      if (group.explicitNoCoverage && group.expectedRows.some(row => !row.invalid)) {
        issues.push({ type: "invalid", serviceName: group.serviceName, dayId: group.dayId, message: `${group.serviceName} / ${group.dayName}: el Excel mezcla "Sin cobertura" con operarios cargados.` });
      }
    }

    return {
      fileName: file.name,
      coverageSheetName: coverageSheet.name,
      serviceSheetName: serviceSheet?.name || null,
      coverageRowsCount: coverageRows.length,
      validCoverageRows,
      noCoverageRows,
      overnightRows,
      groups,
      issues,
      serviceMeta
    };
  }

  function auditMatchSite(serviceName, serviceMeta) {
    const nameKey = auditEntityKey(serviceName);
    const direct = state.sites.filter(site => auditEntityKey(site.name) === nameKey);
    if (direct.length === 1) return { site: direct[0], method: "nombre exacto" };

    const fingerprint = auditNameFingerprint(serviceName);
    const fpMatches = state.sites.filter(site => auditNameFingerprint(site.name) === fingerprint);
    if (fpMatches.length === 1) return { site: fpMatches[0], method: "nombre normalizado" };

    const meta = serviceMeta?.get(nameKey);
    if (meta?.address) {
      const addressKey = auditEntityKey(meta.address);
      const addressMatches = state.sites.filter(site => auditEntityKey(site.address) === addressKey);
      if (addressMatches.length === 1) return { site: addressMatches[0], method: "dirección" };
    }

    if (meta?.coordinates) {
      const nearby = state.sites
        .filter(site => Number.isFinite(Number(site.lat)) && Number.isFinite(Number(site.lng)))
        .map(site => ({ site, distance: haversineMeters(meta.coordinates.lat, meta.coordinates.lng, Number(site.lat), Number(site.lng)) }))
        .sort((a, b) => a.distance - b.distance);
      if (nearby[0] && nearby[0].distance <= 35 && (!nearby[1] || nearby[1].distance - nearby[0].distance >= 20)) {
        return { site: nearby[0].site, method: `GPS (${Math.round(nearby[0].distance)} m)` };
      }
    }
    return { site: null, method: null };
  }

  function auditMatchOperator(operatorName) {
    const operators = state.profiles.filter(profile => String(profile.role).toLowerCase() === "operator" && profile.is_active !== false);
    const fingerprint = auditNameFingerprint(operatorName);
    const exact = operators.filter(profile => auditNameFingerprint(profile.full_name) === fingerprint);
    if (exact.length === 1) return { operator: exact[0], method: "nombre" };

    const sourceTokens = new Set(auditNameTokens(operatorName));
    const subsetCandidates = operators.filter(profile => {
      const profileTokens = new Set(auditNameTokens(profile.full_name));
      const sourceInside = [...sourceTokens].every(token => profileTokens.has(token));
      const profileInside = [...profileTokens].every(token => sourceTokens.has(token));
      return sourceTokens.size >= 2 && (sourceInside || profileInside);
    });
    if (subsetCandidates.length === 1) return { operator: subsetCandidates[0], method: "nombre compatible" };

    const scored = operators.map(profile => {
      const profileTokens = new Set(auditNameTokens(profile.full_name));
      const intersection = [...sourceTokens].filter(token => profileTokens.has(token)).length;
      const union = new Set([...sourceTokens, ...profileTokens]).size || 1;
      return { operator: profile, score: intersection / union };
    }).sort((a, b) => b.score - a.score);
    if (scored[0]?.score >= .8 && (!scored[1] || scored[0].score - scored[1].score >= .15)) return { operator: scored[0].operator, method: "nombre aproximado" };
    return { operator: null, method: null };
  }

  function auditAssignmentActiveOnDate(assignment, dateString) {
    if (!assignment || assignment.is_active === false) return false;
    if ((assignment.assignment_type || "fixed") !== "fixed") return false;
    if (assignment.valid_from && assignment.valid_from > dateString) return false;
    if (assignment.valid_to && assignment.valid_to < dateString) return false;
    return true;
  }

  function auditCurrentAtoms(dateString) {
    const atoms = [];
    state.assignments.filter(a => auditAssignmentActiveOnDate(a, dateString)).forEach(assignment => {
      (assignment.days_of_week || []).map(Number).forEach(dayId => atoms.push({
        assignment,
        assignmentId: assignment.id,
        siteId: assignment.site_id,
        operatorId: assignment.operator_id,
        dayId,
        start: formatTime(assignment.scheduled_start),
        end: formatTime(assignment.scheduled_end)
      }));
    });
    return atoms;
  }

  function auditSameAtom(expected, current) {
    return expected.operatorId === current.operatorId && expected.start === current.start && expected.end === current.end;
  }

  function auditPairScore(expected, current) {
    let score = 0;
    if (expected.operatorId && expected.operatorId === current.operatorId) score += 4;
    if (expected.start === current.start && expected.end === current.end) score += 3;
    return score;
  }

  function auditExpectedText(row) {
    if (!row) return "—";
    const name = row.operatorName || row.operator?.full_name || "—";
    const schedule = row.start && row.end ? `${row.start}–${row.end}${row.end < row.start ? " (+1 día)" : ""}` : (row.scheduleRaw || "—");
    return `${name} · ${schedule}`;
  }

  function auditCurrentText(atom) {
    if (!atom) return "—";
    const op = byId(state.profiles, atom.operatorId);
    return `${op?.full_name || "Operario no disponible"} · ${atom.start}–${atom.end}${atom.end < atom.start ? " (+1 día)" : ""}`;
  }

  function buildAssignmentAuditAnalysis(parsed, dateString) {
    const currentAtoms = auditCurrentAtoms(dateString);
    const currentBySiteDay = new Map();
    currentAtoms.forEach(atom => {
      const key = `${atom.siteId}|${atom.dayId}`;
      if (!currentBySiteDay.has(key)) currentBySiteDay.set(key, []);
      currentBySiteDay.get(key).push(atom);
    });

    const results = [];
    const syncPlans = new Map();
    const siteMatches = new Map();
    const operatorMatches = new Map();

    (parsed.issues || []).forEach((issue, index) => {
      results.push({
        id: `issue-${index}`,
        severity: "blocked",
        status: "invalid",
        statusLabel: "Dato inválido",
        serviceName: issue.serviceName || "Excel",
        dayId: issue.dayId || null,
        expectedText: issue.rowNumber ? `Fila ${issue.rowNumber}` : "—",
        currentText: "—",
        detail: issue.message,
        canSync: false,
        syncKey: null
      });
    });

    for (const group of parsed.groups.values()) {
      const siteMatch = auditMatchSite(group.serviceName, parsed.serviceMeta);
      siteMatches.set(group.serviceKey, siteMatch);
      if (!siteMatch.site) {
        results.push({
          id: `site-${group.groupKey}`,
          severity: "blocked",
          status: "unknown_site",
          statusLabel: "Servicio no encontrado",
          serviceName: group.serviceName,
          serviceKey: group.serviceKey,
          dayId: group.dayId,
          expectedText: group.expectedRows.length ? `${group.expectedRows.length} cobertura${group.expectedRows.length === 1 ? "" : "s"} en Excel` : "Sin cobertura",
          currentText: "—",
          detail: "El servicio del Excel no pudo vincularse con un servicio activo de Presentismo.",
          canSync: false,
          syncKey: null,
          canCreateSite: Boolean(parsed.serviceMeta?.get(group.serviceKey)?.address && parsed.serviceMeta?.get(group.serviceKey)?.coordinates)
        });
        continue;
      }

      const siteId = siteMatch.site.id;
      const syncKey = `${siteId}|${group.dayId}`;
      const current = [...(currentBySiteDay.get(syncKey) || [])];
      const expected = [];
      const unresolvedOperators = [];
      let invalidGroup = false;

      group.expectedRows.forEach(source => {
        if (source.invalid) {
          invalidGroup = true;
          results.push({
            id: `invalid-${group.groupKey}-${source.rowNumber}`,
            severity: "blocked",
            status: "invalid_schedule",
            statusLabel: "Horario inválido",
            serviceName: group.serviceName,
            siteId,
            dayId: group.dayId,
            expectedText: `${source.operatorName || "—"} · ${source.scheduleRaw || "—"}`,
            currentText: "—",
            detail: `${source.message} Fila ${source.rowNumber}.`,
            canSync: false,
            syncKey
          });
          return;
        }
        const operatorKey = auditNameFingerprint(source.operatorName);
        let operatorMatch = operatorMatches.get(operatorKey);
        if (!operatorMatch) {
          operatorMatch = auditMatchOperator(source.operatorName);
          operatorMatches.set(operatorKey, operatorMatch);
        }
        if (!operatorMatch.operator) {
          unresolvedOperators.push(source.operatorName);
          results.push({
            id: `operator-${group.groupKey}-${source.rowNumber}`,
            severity: "blocked",
            status: "unknown_operator",
            statusLabel: "Operario no encontrado",
            serviceName: group.serviceName,
            siteId,
            dayId: group.dayId,
            operatorName: source.operatorName,
            expectedText: auditExpectedText(source),
            currentText: "—",
            detail: "El nombre del Excel no coincide de forma segura con un operario activo de Presentismo.",
            canSync: false,
            syncKey
          });
          return;
        }
        expected.push({ ...source, siteId, operatorId: operatorMatch.operator.id, operator: operatorMatch.operator, operatorMatchMethod: operatorMatch.method });
      });

      const groupBlocked = invalidGroup || unresolvedOperators.length > 0 || (group.explicitNoCoverage && expected.length > 0);
      const plan = { syncKey, siteId, site: siteMatch.site, siteMatchMethod: siteMatch.method, serviceName: group.serviceName, dayId: group.dayId, dayName: group.dayName, expectedAtoms: expected, currentAtoms: current, blocked: groupBlocked, unresolvedOperators };
      syncPlans.set(syncKey, plan);

      const expectedLeft = [...expected];
      const currentLeft = [...current];

      // Sacar primero coincidencias exactas como multiconjunto.
      for (let i = expectedLeft.length - 1; i >= 0; i--) {
        const expectedAtom = expectedLeft[i];
        const currentIndex = currentLeft.findIndex(currentAtom => auditSameAtom(expectedAtom, currentAtom));
        if (currentIndex === -1) continue;
        const currentAtom = currentLeft[currentIndex];
        results.push({
          id: `match-${group.groupKey}-${expectedAtom.rowNumber}-${currentAtom.assignmentId}`,
          severity: "ok",
          status: "match",
          statusLabel: "Coincide",
          serviceName: group.serviceName,
          siteId,
          dayId: group.dayId,
          expectedText: auditExpectedText(expectedAtom),
          currentText: auditCurrentText(currentAtom),
          detail: `Servicio, operario, día y horario coinciden (${siteMatch.method}).`,
          canSync: false,
          syncKey
        });
        expectedLeft.splice(i, 1);
        currentLeft.splice(currentIndex, 1);
      }

      // Emparejar diferencias que claramente corresponden al mismo puesto.
      while (expectedLeft.length && currentLeft.length) {
        let best = null;
        for (let ei = 0; ei < expectedLeft.length; ei++) {
          for (let ci = 0; ci < currentLeft.length; ci++) {
            const score = auditPairScore(expectedLeft[ei], currentLeft[ci]);
            if (!best || score > best.score) best = { ei, ci, score };
          }
        }
        if (!best || (best.score === 0 && !(expectedLeft.length === 1 && currentLeft.length === 1))) break;
        const expectedAtom = expectedLeft.splice(best.ei, 1)[0];
        const currentAtom = currentLeft.splice(best.ci, 1)[0];
        const sameOperator = expectedAtom.operatorId === currentAtom.operatorId;
        const sameSchedule = expectedAtom.start === currentAtom.start && expectedAtom.end === currentAtom.end;
        const status = sameOperator ? "time_mismatch" : sameSchedule ? "operator_mismatch" : "operator_time_mismatch";
        const label = sameOperator ? "Horario distinto" : sameSchedule ? "Operario distinto" : "Operario y horario distintos";
        results.push({
          id: `mismatch-${group.groupKey}-${expectedAtom.rowNumber}-${currentAtom.assignmentId}`,
          severity: "warning",
          status,
          statusLabel: label,
          serviceName: group.serviceName,
          siteId,
          dayId: group.dayId,
          expectedText: auditExpectedText(expectedAtom),
          currentText: auditCurrentText(currentAtom),
          detail: "La planificación del Excel y la asignación fija vigente no coinciden.",
          canSync: !groupBlocked,
          syncKey
        });
      }

      expectedLeft.forEach(expectedAtom => results.push({
        id: `missing-${group.groupKey}-${expectedAtom.rowNumber}`,
        severity: "warning",
        status: "missing_assignment",
        statusLabel: "Falta en Presentismo",
        serviceName: group.serviceName,
        siteId,
        dayId: group.dayId,
        expectedText: auditExpectedText(expectedAtom),
        currentText: "Sin asignación equivalente",
        detail: "El Excel espera esta cobertura pero no existe una asignación fija equivalente.",
        canSync: !groupBlocked,
        syncKey
      }));

      currentLeft.forEach(currentAtom => results.push({
        id: `extra-${group.groupKey}-${currentAtom.assignmentId}-${currentAtom.dayId}-${currentAtom.operatorId}`,
        severity: "warning",
        status: "extra_assignment",
        statusLabel: "Sobra en Presentismo",
        serviceName: group.serviceName,
        siteId,
        dayId: group.dayId,
        expectedText: expected.length ? "No figura esta cobertura" : "Sin cobertura",
        currentText: auditCurrentText(currentAtom),
        detail: expected.length ? "Hay una asignación fija adicional que no figura en el Excel." : "El Excel indica que ese día no debería haber cobertura fija.",
        canSync: !groupBlocked,
        syncKey
      }));

      if (!expected.length && !current.length && group.explicitNoCoverage && !groupBlocked) {
        results.push({
          id: `nocoverage-${group.groupKey}`,
          severity: "ok",
          status: "no_coverage_match",
          statusLabel: "Sin cobertura · coincide",
          serviceName: group.serviceName,
          siteId,
          dayId: group.dayId,
          expectedText: "Sin cobertura",
          currentText: "Sin asignación fija",
          detail: "El Excel y Presentismo coinciden: no hay cobertura fija para ese día.",
          canSync: false,
          syncKey
        });
      }
    }

    const stats = {
      ok: results.filter(row => row.severity === "ok").length,
      warnings: results.filter(row => row.severity === "warning").length,
      blocked: results.filter(row => row.severity === "blocked").length,
      total: results.length,
      syncableKeys: new Set(results.filter(row => row.severity === "warning" && row.canSync && row.syncKey).map(row => row.syncKey)).size
    };
    return { dateString, results, syncPlans, siteMatches, operatorMatches, stats };
  }

  function auditStatusClass(row) {
    if (row.severity === "ok") return "audit-status-ok";
    if (row.severity === "blocked") return "audit-status-blocked";
    return "audit-status-warning";
  }

  function auditRowClass(row) {
    if (row.severity === "ok") return "audit-ok-row";
    if (row.severity === "blocked") return "audit-blocked-row";
    return "audit-difference-row";
  }

  function assignmentAuditFilteredRows() {
    const analysis = state.assignmentAuditAnalysis;
    if (!analysis) return [];
    const filter = state.assignmentAuditFilter || "alerts";
    if (filter === "ok") return analysis.results.filter(row => row.severity === "ok");
    if (filter === "alerts") return analysis.results.filter(row => row.severity !== "ok");
    return analysis.results;
  }

  function auditSyncableAlertKeys() {
    const analysis = state.assignmentAuditAnalysis;
    if (!analysis) return [];
    return [...new Set(analysis.results.filter(row => row.severity === "warning" && row.canSync && row.syncKey).map(row => row.syncKey))];
  }

  function renderAssignmentAudit() {
    const panel = $("#assignmentAuditPanel");
    const info = $("#assignmentAuditFileInfo");
    const analysis = state.assignmentAuditAnalysis;
    if (!panel || !info) return;

    if (!analysis || !state.assignmentAuditParsed) {
      panel.classList.add("hidden");
      if (!state.assignmentAuditFileName) info.textContent = "Todavía no cargaste un archivo.";
      return;
    }
    panel.classList.remove("hidden");
    const parsed = state.assignmentAuditParsed;
    info.textContent = `${parsed.fileName} · hoja ${parsed.coverageSheetName} · ${parsed.coverageRowsCount} filas leídas · ${parsed.validCoverageRows} coberturas con operario · ${parsed.noCoverageRows} filas sin cobertura${parsed.overnightRows ? ` · ${parsed.overnightRows} turnos nocturnos` : ""}.`;

    const stats = analysis.stats;
    $("#assignmentAuditKpis").innerHTML = `
      <div class="assignment-audit-kpi"><strong>${parsed.validCoverageRows}</strong><span>Coberturas del Excel</span></div>
      <div class="assignment-audit-kpi audit-ok"><strong>${stats.ok}</strong><span>Coincidencias</span></div>
      <div class="assignment-audit-kpi audit-alert"><strong>${stats.warnings}</strong><span>Diferencias</span></div>
      <div class="assignment-audit-kpi audit-block"><strong>${stats.blocked}</strong><span>Bloqueos a revisar</span></div>`;

    $$("[data-audit-filter]").forEach(button => button.classList.toggle("active", button.dataset.auditFilter === state.assignmentAuditFilter));
    const rows = assignmentAuditFilteredRows();
    const table = $("#assignmentAuditTable");
    table.innerHTML = `
      <table>
        <thead><tr>
          <th class="audit-col-select"></th>
          <th class="audit-col-status">Estado</th>
          <th class="audit-col-service">Servicio</th>
          <th class="audit-col-day">Día</th>
          <th class="audit-col-plan">Excel</th>
          <th class="audit-col-app">Presentismo</th>
          <th class="audit-col-detail">Detalle / acción</th>
        </tr></thead>
        <tbody>${rows.map(row => {
          const selected = row.syncKey && state.assignmentAuditSelectedKeys.has(row.syncKey);
          const selectCell = row.severity === "warning" && row.canSync ? `<input class="audit-checkbox" data-audit-select="${escapeHtml(row.syncKey)}" type="checkbox" ${selected ? "checked" : ""} title="Sincronizar este servicio y día" />` : "";
          let action = "";
          if (row.severity === "warning" && row.canSync) action = `<button class="secondary-btn small-btn audit-inline-action" data-audit-apply-key="${escapeHtml(row.syncKey)}" type="button">Corregir este día</button>`;
          if (row.status === "unknown_site" && row.canCreateSite) action = `<button class="secondary-btn small-btn audit-inline-action" data-audit-create-site="${escapeHtml(row.serviceKey)}" type="button">Crear servicio desde Excel</button>`;
          if (row.status === "unknown_operator") action = `<button class="ghost-btn small-btn audit-inline-action" data-audit-find-user="${escapeHtml(row.operatorName || "")}" type="button">Buscar / crear en Usuarios</button>`;
          return `<tr class="${auditRowClass(row)}">
            <td class="audit-col-select">${selectCell}</td>
            <td><span class="audit-status-pill ${auditStatusClass(row)}">${escapeHtml(row.statusLabel)}</span></td>
            <td><strong>${escapeHtml(row.serviceName || "—")}</strong></td>
            <td>${escapeHtml(row.dayId ? dayLabel(row.dayId, "long") : "—")}</td>
            <td><div class="audit-plan-line">${escapeHtml(row.expectedText || "—")}</div></td>
            <td><div class="audit-app-line">${escapeHtml(row.currentText || "—")}</div></td>
            <td><div>${escapeHtml(row.detail || "")}</div>${action}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="7" class="muted">No hay resultados para este filtro.</td></tr>`}</tbody>
      </table>`;

    const selectedCount = state.assignmentAuditSelectedKeys.size;
    $("#assignmentAuditSelectionSummary").textContent = `${selectedCount} servicio${selectedCount === 1 ? "" : "s"} + día seleccionado${selectedCount === 1 ? "" : "s"}. Hay ${stats.syncableKeys} día${stats.syncableKeys === 1 ? "" : "s"} con diferencias corregibles automáticamente.`;

    table.querySelectorAll("[data-audit-select]").forEach(input => input.addEventListener("change", () => {
      const key = input.dataset.auditSelect;
      if (input.checked) state.assignmentAuditSelectedKeys.add(key);
      else state.assignmentAuditSelectedKeys.delete(key);
      renderAssignmentAudit();
    }));
    table.querySelectorAll("[data-audit-apply-key]").forEach(button => button.addEventListener("click", () => applyAssignmentAuditKeys([button.dataset.auditApplyKey]).catch(error => toast(error.message || "No se pudo sincronizar la asignación."))));
    table.querySelectorAll("[data-audit-create-site]").forEach(button => button.addEventListener("click", () => createMissingAuditSite(button.dataset.auditCreateSite).catch(error => toast(error.message || "No se pudo crear el servicio."))));
    table.querySelectorAll("[data-audit-find-user]").forEach(button => button.addEventListener("click", () => {
      renderTab("users");
      state.sectionSearch.users = button.dataset.auditFindUser || "";
      syncContextSearchUI("users");
      renderUsers();
      focusCurrentSearchResults();
    }));
  }

  function clearAssignmentAudit() {
    state.assignmentAuditFileName = "";
    state.assignmentAuditParsed = null;
    state.assignmentAuditAnalysis = null;
    state.assignmentAuditSelectedKeys.clear();
    state.assignmentAuditFilter = "alerts";
    if ($("#assignmentAuditFile")) $("#assignmentAuditFile").value = "";
    if ($("#assignmentAuditFileInfo")) $("#assignmentAuditFileInfo").textContent = "Todavía no cargaste un archivo.";
    renderAssignmentAudit();
  }

  function analyzeParsedAssignmentAudit() {
    if (!state.assignmentAuditParsed) return;
    const dateString = $("#assignmentAuditEffectiveDate")?.value || todayISO();
    state.assignmentAuditAnalysis = buildAssignmentAuditAnalysis(state.assignmentAuditParsed, dateString);
    const validKeys = new Set(state.assignmentAuditAnalysis.syncPlans.keys());
    state.assignmentAuditSelectedKeys = new Set([...state.assignmentAuditSelectedKeys].filter(key => validKeys.has(key)));
    renderAssignmentAudit();
  }

  async function analyzeAssignmentAuditFile() {
    const file = $("#assignmentAuditFile")?.files?.[0];
    const parsed = await parseAssignmentAuditFile(file);
    state.assignmentAuditFileName = file.name;
    state.assignmentAuditParsed = parsed;
    state.assignmentAuditSelectedKeys.clear();
    state.assignmentAuditFilter = "alerts";
    analyzeParsedAssignmentAudit();
    const differences = state.assignmentAuditAnalysis?.stats?.warnings || 0;
    const blocked = state.assignmentAuditAnalysis?.stats?.blocked || 0;
    toast(differences || blocked ? `Análisis listo: ${differences} diferencia${differences === 1 ? "" : "s"} y ${blocked} bloqueo${blocked === 1 ? "" : "s"}.` : "El Excel coincide con las asignaciones vigentes.", differences || blocked ? "" : "success");
  }

  async function createMissingAuditSite(serviceKey) {
    const parsed = state.assignmentAuditParsed;
    if (!parsed) throw new Error("Volvé a cargar el Excel.");
    const meta = parsed.serviceMeta?.get(serviceKey);
    if (!meta?.address || !meta?.coordinates) throw new Error("El Excel no tiene dirección y coordenadas suficientes para crear este servicio automáticamente.");
    const existing = state.sites.find(site => auditEntityKey(site.name) === serviceKey);
    if (existing) throw new Error("Ese servicio ya existe. Volvé a analizar el Excel.");
    if (!window.confirm(`¿Crear el servicio "${meta.name}" usando dirección y coordenadas del Excel? El radio GPS inicial será 120 m y luego podés cambiarlo en Servicios.`)) return;
    await store.upsertSite({
      name: meta.name,
      address: meta.address,
      zone: meta.zone || null,
      supervisor_name: meta.supervisor || null,
      service_type: meta.frequency || "fixed",
      lat: meta.coordinates.lat,
      lng: meta.coordinates.lng,
      gps_radius_m: 120,
      is_active: true
    });
    await refreshBaseData($("#dashboardDate")?.value || todayISO());
    renderSites();
    renderAssignmentSelectors();
    analyzeParsedAssignmentAudit();
    toast("Servicio creado desde el Excel. El análisis fue recalculado.", "success");
  }

  function auditTemplateForExpected(expectedAtom, currentAtoms) {
    const exact = currentAtoms.find(atom => auditSameAtom(expectedAtom, atom));
    if (exact) return exact.assignment;
    const sameOperator = currentAtoms.find(atom => atom.operatorId === expectedAtom.operatorId);
    if (sameOperator) return sameOperator.assignment;
    const sameSchedule = currentAtoms.find(atom => atom.start === expectedAtom.start && atom.end === expectedAtom.end);
    if (sameSchedule) return sameSchedule.assignment;
    return currentAtoms[0]?.assignment || null;
  }

  function auditAssignmentContinuationPayload(assignment, days, validFrom) {
    return {
      operator_id: assignment.operator_id,
      site_id: assignment.site_id,
      days_of_week: days,
      scheduled_start: formatTime(assignment.scheduled_start),
      scheduled_end: formatTime(assignment.scheduled_end),
      grace_minutes: Number(assignment.grace_minutes ?? 10),
      absence_after_minutes: Number(assignment.absence_after_minutes ?? 30),
      valid_from: validFrom,
      valid_to: assignment.valid_to || null,
      notes: assignment.notes || null,
      assignment_type: "fixed",
      created_by: assignment.created_by || state.currentProfile?.id || null,
      suppress_regular_assignments: false,
      is_active: true
    };
  }

  function buildAssignmentAuditSyncPayload(syncKeys, effectiveDate) {
    const analysis = state.assignmentAuditAnalysis;
    if (!analysis) throw new Error("Primero analizá el Excel.");
    const keys = [...new Set(syncKeys || [])].filter(Boolean);
    if (!keys.length) throw new Error("Seleccioná al menos una diferencia para corregir.");
    const plans = keys.map(key => analysis.syncPlans.get(key)).filter(Boolean);
    const blocked = plans.filter(plan => plan.blocked);
    if (blocked.length) throw new Error(`Hay ${blocked.length} servicio/día bloqueado por datos sin resolver. Corregí primero esos nombres u horarios.`);

    const selectedDaysBySite = new Map();
    plans.forEach(plan => {
      if (!selectedDaysBySite.has(plan.siteId)) selectedDaysBySite.set(plan.siteId, new Set());
      selectedDaysBySite.get(plan.siteId).add(Number(plan.dayId));
    });

    const updates = [];
    const inserts = [];
    const activeFixed = state.assignments.filter(a => auditAssignmentActiveOnDate(a, effectiveDate));

    // Cerrar o recortar las asignaciones actuales solamente desde la fecha elegida.
    activeFixed.forEach(assignment => {
      const selectedDays = selectedDaysBySite.get(assignment.site_id);
      if (!selectedDays) return;
      const days = (assignment.days_of_week || []).map(Number);
      const affectedDays = days.filter(day => selectedDays.has(day));
      if (!affectedDays.length) return;
      const remainingDays = days.filter(day => !selectedDays.has(day));
      const validFrom = assignment.valid_from || effectiveDate;
      if (validFrom < effectiveDate) {
        updates.push({ id: assignment.id, patch: { valid_to: addDaysISO(effectiveDate, -1) } });
        if (remainingDays.length) inserts.push(auditAssignmentContinuationPayload(assignment, remainingDays, effectiveDate));
      } else {
        if (remainingDays.length) updates.push({ id: assignment.id, patch: { days_of_week: remainingDays } });
        else updates.push({ id: assignment.id, patch: { is_active: false } });
      }
    });

    // Crear la versión que dicta el Excel para cada servicio/día seleccionado.
    const desiredRaw = [];
    plans.forEach(plan => {
      plan.expectedAtoms.forEach(expectedAtom => {
        const template = auditTemplateForExpected(expectedAtom, plan.currentAtoms);
        desiredRaw.push({
          operator_id: expectedAtom.operatorId,
          site_id: plan.siteId,
          days_of_week: [Number(plan.dayId)],
          scheduled_start: expectedAtom.start,
          scheduled_end: expectedAtom.end,
          grace_minutes: Number(template?.grace_minutes ?? 10),
          absence_after_minutes: Number(template?.absence_after_minutes ?? 30),
          valid_from: effectiveDate,
          valid_to: template?.valid_to && template.valid_to >= effectiveDate ? template.valid_to : null,
          notes: template?.notes || `Sincronizado desde Excel ${state.assignmentAuditFileName || "de planificación"}`,
          assignment_type: "fixed",
          created_by: state.currentProfile?.id || null,
          suppress_regular_assignments: false,
          is_active: true
        });
      });
    });

    // Agrupar días iguales para no llenar la base con una fila por día cuando no hace falta.
    const grouped = new Map();
    desiredRaw.forEach(payload => {
      const key = [payload.operator_id, payload.site_id, payload.scheduled_start, payload.scheduled_end, payload.grace_minutes, payload.absence_after_minutes, payload.valid_to || "", payload.notes || ""].join("|");
      if (!grouped.has(key)) grouped.set(key, { ...payload, days_of_week: [] });
      grouped.get(key).days_of_week.push(...payload.days_of_week);
    });
    grouped.forEach(payload => {
      payload.days_of_week = [...new Set(payload.days_of_week.map(Number))].sort((a, b) => a - b);
      inserts.push(payload);
    });

    return { updates, inserts, plans };
  }

  async function applyAssignmentAuditKeys(syncKeys) {
    const effectiveDate = $("#assignmentAuditEffectiveDate")?.value || todayISO();
    const payload = buildAssignmentAuditSyncPayload(syncKeys, effectiveDate);
    const daysCount = payload.plans.length;
    const coverageCount = payload.plans.reduce((sum, plan) => sum + plan.expectedAtoms.length, 0);
    const noCoverageCount = payload.plans.filter(plan => plan.expectedAtoms.length === 0).length;
    const message = `¿Sincronizar ${daysCount} servicio/día desde ${effectiveDate}? Se crearán o ajustarán ${coverageCount} cobertura${coverageCount === 1 ? "" : "s"}${noCoverageCount ? ` y ${noCoverageCount} día${noCoverageCount === 1 ? "" : "s"} quedará${noCoverageCount === 1 ? "" : "n"} sin cobertura fija` : ""}. El historial anterior se conserva.`;
    if (!window.confirm(message)) return;

    await store.applyAssignmentSync(payload);
    state.assignmentAuditSelectedKeys.clear();
    await renderSupervisorView();
    analyzeParsedAssignmentAudit();
    toast("Asignaciones sincronizadas con el Excel.", "success");
  }

  function updateBulkSelectionSummaries() {
    const assignmentCount = state.bulkSelectedAssignmentIds.size;
    const siteCount = state.bulkSelectedSiteIds.size;
    if ($("#bulkAssignmentSelectionSummary")) {
      $("#bulkAssignmentSelectionSummary").textContent = `${assignmentCount} asignación${assignmentCount === 1 ? "" : "es"} seleccionada${assignmentCount === 1 ? "" : "s"} de ${state.assignments.length}.`;
    }
    if ($("#bulkSiteSelectionSummary")) {
      $("#bulkSiteSelectionSummary").textContent = `${siteCount} servicio${siteCount === 1 ? "" : "s"} seleccionado${siteCount === 1 ? "" : "s"} de ${state.sites.length}.`;
    }
  }

  function selectedAssignmentTargets() {
    const scope = $("#bulkAssignmentScope")?.value || "all";
    if (scope === "selected") return state.assignments.filter(a => state.bulkSelectedAssignmentIds.has(a.id));
    return [...state.assignments];
  }

  function selectedSiteTargets() {
    const scope = $("#bulkSiteScope")?.value || "all";
    if (scope === "selected") return state.sites.filter(site => state.bulkSelectedSiteIds.has(site.id));
    return [...state.sites];
  }

  async function applyBulkAssignmentSettings() {
    const graceRaw = $("#bulkAssignmentGrace").value.trim();
    const absentRaw = $("#bulkAssignmentAbsent").value.trim();
    if (!graceRaw && !absentRaw) throw new Error("Ingresá al menos un valor para demora o ausencia.");

    const patch = {};
    if (graceRaw) {
      const grace = Number(graceRaw);
      if (!Number.isFinite(grace) || grace < 0 || grace > 120) throw new Error("La tolerancia de demora debe estar entre 0 y 120 minutos.");
      patch.grace_minutes = Math.round(grace);
    }
    if (absentRaw) {
      const absent = Number(absentRaw);
      if (!Number.isFinite(absent) || absent < 1 || absent > 240) throw new Error("El margen de ausencia debe estar entre 1 y 240 minutos.");
      patch.absence_after_minutes = Math.round(absent);
    }

    const targets = selectedAssignmentTargets();
    if (!targets.length) throw new Error($("#bulkAssignmentScope").value === "selected" ? "Seleccioná al menos una asignación." : "No hay asignaciones activas para modificar.");

    const invalid = targets.filter(a => {
      const nextGrace = patch.grace_minutes ?? Number(a.grace_minutes ?? 10);
      const nextAbsent = patch.absence_after_minutes ?? Number(a.absence_after_minutes ?? 30);
      return nextAbsent <= nextGrace;
    });
    if (invalid.length) {
      throw new Error(`La ausencia debe quedar después de la tolerancia de demora. Hay ${invalid.length} asignación${invalid.length === 1 ? "" : "es"} que quedarían con valores incompatibles.`);
    }

    const changes = [
      patch.grace_minutes !== undefined ? `demora ${patch.grace_minutes} min` : null,
      patch.absence_after_minutes !== undefined ? `ausencia ${patch.absence_after_minutes} min` : null
    ].filter(Boolean).join(" · ");
    const scopeLabel = $("#bulkAssignmentScope").value === "selected" ? "seleccionadas" : "activas";
    if (!window.confirm(`¿Aplicar ${changes} a ${targets.length} asignación${targets.length === 1 ? "" : "es"} ${scopeLabel}? El cambio también puede modificar las alertas del día en curso.`)) return;

    const button = $("#applyBulkAssignmentsBtn");
    button.disabled = true;
    try {
      await store.bulkUpdateAssignments(targets.map(a => a.id), patch);
      $("#bulkAssignmentGrace").value = "";
      $("#bulkAssignmentAbsent").value = "";
      toast(`${targets.length} asignación${targets.length === 1 ? "" : "es"} actualizada${targets.length === 1 ? "" : "s"}.`, "success");
      await renderSupervisorView();
    } finally {
      button.disabled = false;
    }
  }

  async function applyBulkSiteRadius() {
    const radius = Number($("#bulkSiteRadius").value);
    if (!Number.isFinite(radius) || radius < 10 || radius > 1000) throw new Error("El radio GPS debe estar entre 10 y 1000 metros.");
    const roundedRadius = Math.round(radius);
    const targets = selectedSiteTargets();
    if (!targets.length) throw new Error($("#bulkSiteScope").value === "selected" ? "Seleccioná al menos un servicio." : "No hay servicios activos para modificar.");

    const scopeLabel = $("#bulkSiteScope").value === "selected" ? "seleccionados" : "activos";
    if (!window.confirm(`¿Establecer un radio GPS de ${roundedRadius} m en ${targets.length} servicio${targets.length === 1 ? "" : "s"} ${scopeLabel}?`)) return;

    const button = $("#applyBulkSitesBtn");
    button.disabled = true;
    try {
      await store.bulkUpdateSites(targets.map(site => site.id), { gps_radius_m: roundedRadius });
      $("#bulkSiteRadius").value = "";
      toast(`${targets.length} servicio${targets.length === 1 ? "" : "s"} actualizado${targets.length === 1 ? "" : "s"} a ${roundedRadius} m.`, "success");
      await renderSupervisorView();
    } finally {
      button.disabled = false;
    }
  }

  async function saveExtraAssignment(event) {
    event.preventDefault();
    const operatorId = $("#extraAssignmentOperator")?.value;
    const siteId = $("#extraAssignmentSite")?.value;
    const type = $("#extraAssignmentType")?.value || "coverage";
    const date = $("#extraAssignmentDate")?.value || todayISO();
    const start = $("#extraAssignmentStart")?.value;
    const end = $("#extraAssignmentEnd")?.value;
    const grace = Number($("#extraAssignmentGrace")?.value || 10);
    const absent = Number($("#extraAssignmentAbsent")?.value || 30);
    const coveredOperatorId = $("#extraCoveredOperator")?.value || null;
    const notes = $("#extraAssignmentNotes")?.value.trim() || "";
    const suppressRegular = Boolean($("#extraSuppressRegular")?.checked);

    if (!operatorId || !siteId || !date || !start || !end) throw new Error("Completá operario, servicio, fecha y horario.");
    if (end === start) throw new Error("Entrada y salida no pueden ser iguales. Los turnos nocturnos, por ejemplo 22:00 a 06:00, sí están permitidos.");
    if (absent <= grace) throw new Error("El margen de ausencia debe ser posterior a la tolerancia de demora.");
    const day = (() => { const d = new Date(`${date}T12:00:00`).getDay(); return d === 0 ? 7 : d; })();

    await store.upsertAssignment({
      operator_id: operatorId,
      site_id: siteId,
      days_of_week: [day],
      scheduled_start: start,
      scheduled_end: end,
      grace_minutes: grace,
      absence_after_minutes: absent,
      valid_from: date,
      valid_to: date,
      assignment_type: type,
      covered_operator_id: coveredOperatorId,
      created_by: state.currentProfile?.id || null,
      suppress_regular_assignments: suppressRegular,
      notes: notes || (type === "coverage" ? "Cobertura extraordinaria" : "Refuerzo extraordinario"),
      is_active: true
    });

    $("#extraAssignmentNotes").value = "";
    $("#extraCoveredOperator").value = "";
    if ($("#extraSuppressRegular")) $("#extraSuppressRegular").checked = false;
    $("#extraAssignmentDate").value = todayISO();
    toast(`${assignmentTypeLabel(type)} creada. El operario la verá como tarea extraordinaria.`, "success");
    await renderSupervisorView();
  }

  function renderAssignments() {
    const list = $("#assignmentsList");
    const validIds = new Set(state.assignments.map(assignment => assignment.id));
    state.bulkSelectedAssignmentIds = new Set([...state.bulkSelectedAssignmentIds].filter(id => validIds.has(id)));
    const sorted = [...state.assignments].sort((a, b) => {
      const siteA = byId(state.sites, a.site_id)?.name || "";
      const siteB = byId(state.sites, b.site_id)?.name || "";
      return `${siteA} ${a.scheduled_start}`.localeCompare(`${siteB} ${b.scheduled_start}`);
    });
    const searchTerm = sectionSearchTerm("assignments");
    const visibleAssignments = searchTerm ? sorted.filter(assignment => {
      const op = byId(state.profiles, assignment.operator_id);
      const site = byId(state.sites, assignment.site_id);
      const coveredOp = assignment.covered_operator_id ? byId(state.profiles, assignment.covered_operator_id) : null;
      return valuesMatchSearch(searchTerm, op?.full_name, site?.name, site?.address, site?.zone, coveredOp?.full_name, assignmentTypeLabel(assignment.assignment_type || "fixed"), assignment.notes, assignment.scheduled_start, assignment.scheduled_end);
    }) : sorted;
    updateSectionSearchCount("assignments", visibleAssignments.length, sorted.length);

    list.innerHTML = visibleAssignments.map(assignment => {
      const op = byId(state.profiles, assignment.operator_id);
      const site = byId(state.sites, assignment.site_id);
      const coveredOp = assignment.covered_operator_id ? byId(state.profiles, assignment.covered_operator_id) : null;
      const assignmentType = assignment.assignment_type || "fixed";
      const days = (assignment.days_of_week || []).map(d => dayLabel(d)).join(", ");
      const vigencia = `${assignment.valid_from || "—"}${assignment.valid_to ? ` a ${assignment.valid_to}` : " en adelante"}`;
      const selected = state.bulkSelectedAssignmentIds.has(assignment.id);
      return `
        <div class="list-item ${selected ? "bulk-selected-item" : ""} ${searchTerm ? "search-match-card" : ""}">
          <div class="bulk-select-line">
            <label class="bulk-select-control">
              <input type="checkbox" data-select-assignment="${assignment.id}" ${selected ? "checked" : ""} />
              <span>Seleccionar para cambio masivo</span>
            </label>
          </div>
          <div class="list-item-title-row"><div class="list-item-title">${escapeHtml(site?.name || "—")}</div>${assignmentType !== "fixed" ? `<span class="extra-duty-badge ${escapeHtml(assignmentType)}">${escapeHtml(assignmentTypeLabel(assignmentType))}</span>` : ""}</div>
          <div class="muted small"><strong>${escapeHtml(op?.full_name || "—")}</strong> · ${formatTime(assignment.scheduled_start)} a ${formatTime(assignment.scheduled_end)}</div>
          ${coveredOp ? `<div class="muted small">Cubre a: <strong>${escapeHtml(coveredOp.full_name || "—")}</strong></div>` : ""}
          ${assignment.suppress_regular_assignments ? `<div class="muted small"><strong>Reemplaza la asignación habitual del operario en ese horario.</strong></div>` : ""}
          <div class="muted small">Días: ${escapeHtml(days || "—")} · Vigencia: ${escapeHtml(vigencia)}</div>
          <div class="muted small">Tolerancia: ${assignment.grace_minutes} min · Ausente desde: ${assignment.absence_after_minutes} min</div>
          ${assignment.notes ? `<div class="muted small">Notas: ${escapeHtml(assignment.notes)}</div>` : ""}
          <div class="list-item-actions">
            <button class="secondary-btn small-btn" data-edit-assignment="${assignment.id}" type="button">Editar</button>
            <button class="danger-btn small-btn" data-delete-assignment="${assignment.id}" type="button">Eliminar</button>
          </div>
        </div>`;
    }).join("") || `<p class="muted">No hay asignaciones cargadas.</p>`;

    list.querySelectorAll("[data-select-assignment]").forEach(input => input.addEventListener("change", () => {
      if (input.checked) state.bulkSelectedAssignmentIds.add(input.dataset.selectAssignment);
      else state.bulkSelectedAssignmentIds.delete(input.dataset.selectAssignment);
      input.closest(".list-item")?.classList.toggle("bulk-selected-item", input.checked);
      updateBulkSelectionSummaries();
    }));
    list.querySelectorAll("[data-edit-assignment]").forEach(btn => btn.addEventListener("click", () => editAssignment(btn.dataset.editAssignment)));
    list.querySelectorAll("[data-delete-assignment]").forEach(btn => btn.addEventListener("click", () => deleteAssignment(btn.dataset.deleteAssignment)));
    updateBulkSelectionSummaries();
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
      is_active: true,
      ...(!id ? { assignment_type: "fixed", created_by: state.currentProfile?.id || null } : {})
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
    const searchTerm = sectionSearchTerm("users");
    const visibleUsers = searchTerm ? state.profiles.filter(user => valuesMatchSearch(searchTerm, user.full_name, user.username, user.email, user.phone, roleLabel(user.role), user.notes)) : state.profiles;
    updateSectionSearchCount("users", visibleUsers.length, state.profiles.length);
    list.innerHTML = visibleUsers.map(user => {
      const manageable = canManageAccountUser(user);
      const username = user.username || (String(user.email || "").toLowerCase().endsWith("@cleanit.ar") ? String(user.email).split("@")[0] : "Sin usuario");
      const recoveryEmail = hasRealRecoveryEmail(user) ? user.email : "Sin email real de recuperación";
      return `
      <div class="list-item ${searchTerm ? "search-match-card" : ""}">
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

  function assignmentSuppressedHistorically(assignment, dateString, allAssignments) {
    if ((assignment.assignment_type || "fixed") !== "fixed") return false;
    return (allAssignments || []).some(extra =>
      extra.operator_id === assignment.operator_id &&
      (extra.assignment_type || "fixed") !== "fixed" &&
      extra.suppress_regular_assignments === true &&
      assignmentAppliesHistorically(extra, dateString) &&
      assignmentsOverlap(extra, assignment)
    );
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
        if (assignmentAppliesHistorically(assignment, date) && !assignmentSuppressedHistorically(assignment, date, context.assignments)) {
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
          const coveredOperator = assignment.covered_operator_id ? profilesById.get(assignment.covered_operator_id) : null;
          const assignmentType = assignment.assignment_type || "fixed";
          const notes = [assignment.notes, evalResult.absentEvent?.notes, evalResult.lateEvent?.notes, evalResult.entry?.notes, evalResult.exit?.notes].filter(Boolean).join(" | ");
          const duration = workedDuration(evalResult.entry, evalResult.exit);

          rows.push({
            "Fecha": date,
            "Operario": operator?.full_name || assignment.operator_id || "",
            "Servicio": site?.name || assignment.site_id || "",
            "Tipo de trabajo": assignmentTypeLabel(assignmentType),
            "Cubre a": coveredOperator?.full_name || "",
            "Origen de tarea": assignmentType === "fixed" ? "Asignación fija" : "Tarea extraordinaria cargada por supervisor",
            "Validación": "Validado",
            "Dirección": site?.address || "",
            "Horario programado": `${String(assignment.scheduled_start || "").slice(0, 5)} - ${String(assignment.scheduled_end || "").slice(0, 5)}`,
            "Hora entrada": evalResult.entry ? formatClock(eventTimestamp(evalResult.entry)) : "",
            "Fecha/hora entrada": evalResult.entry ? eventTimestamp(evalResult.entry) : "",
            "Estado entrada": evalResult.entryStatus,
            "Minutos demora": evalResult.lateMinutes ?? "",
            "Entrada dentro radio": eventInsideLabel(evalResult.entry),
            "Distancia entrada (m)": evalResult.entry?.distance_m != null ? Math.round(Number(evalResult.entry.distance_m)) : "",
            "Precisión entrada (m)": evalResult.entry?.gps_accuracy_m != null ? Math.round(Number(evalResult.entry.gps_accuracy_m)) : "",
            "Lat entrada": evalResult.entry?.lat ?? "",
            "Lng entrada": evalResult.entry?.lng ?? "",
            "Hora salida": evalResult.exit ? formatClock(eventTimestamp(evalResult.exit)) : "",
            "Fecha/hora salida": evalResult.exit ? eventTimestamp(evalResult.exit) : "",
            "Duración trabajada": duration.label,
            "Minutos trabajados": duration.minutes ?? "",
            "Horas trabajadas (decimal)": duration.decimalHours ?? "",
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
            "Operator ID": assignment.operator_id,
            "Site ID": assignment.site_id,
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
      const duration = workedDuration(entry, exit);
      rows.push({
        "Fecha": sample.shift_date || "",
        "Operario": operator?.full_name || sample.operator_id || "",
        "Servicio": site?.name || sample.site_id || "",
        "Tipo de trabajo": workTypeLabel(entry?.work_type || sample.work_type || "regular"),
        "Cubre a": "",
        "Origen de tarea": (entry?.entry_source || sample.entry_source) === "operator_extra" ? "Declarado por operario" : "Marcación sin turno reconstruido",
        "Validación": validationLabel(entry?.validation_status || sample.validation_status || "confirmed"),
        "Dirección": site?.address || "",
        "Horario programado": "No reconstruido",
        "Hora entrada": entry ? formatClock(eventTimestamp(entry)) : "",
        "Fecha/hora entrada": entry ? eventTimestamp(entry) : "",
        "Estado entrada": entry ? (entry.is_inside_site === false ? "Entrada fuera de radio" : entry.observed_status === "late" ? "Entrada tarde" : "Entrada registrada") : "Sin entrada",
        "Minutos demora": "",
        "Entrada dentro radio": eventInsideLabel(entry),
        "Distancia entrada (m)": entry?.distance_m != null ? Math.round(Number(entry.distance_m)) : "",
        "Precisión entrada (m)": entry?.gps_accuracy_m != null ? Math.round(Number(entry.gps_accuracy_m)) : "",
        "Lat entrada": entry?.lat ?? "",
        "Lng entrada": entry?.lng ?? "",
        "Hora salida": exit ? formatClock(eventTimestamp(exit)) : "",
        "Fecha/hora salida": exit ? eventTimestamp(exit) : "",
        "Duración trabajada": duration.label,
        "Minutos trabajados": duration.minutes ?? "",
        "Horas trabajadas (decimal)": duration.decimalHours ?? "",
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
        "Operator ID": sample.operator_id || "",
        "Site ID": sample.site_id || "",
        "Assignment ID": sample.assignment_id || "",
        "Shift ID": sample.shift_id || ""
      });
    });

    rows.sort((a, b) => `${a.Fecha}|${a.Operario}|${a.Servicio}`.localeCompare(`${b.Fecha}|${b.Operario}|${b.Servicio}`));
    return { rows, period: resolved };
  }

  function rowWorkedMinutes(row) {
    const value = Number(row?.["Minutos trabajados"]);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  function rowValidationBucket(row) {
    const validation = String(row?.["Validación"] || "Validado").toLowerCase();
    if (validation.includes("rechaz")) return "rejected";
    if (validation.includes("pendiente")) return "pending";
    return "confirmed";
  }

  function outsideIncidentsForRow(row) {
    let count = 0;
    if (String(row?.["Estado entrada"] || "").toLowerCase().includes("fuera de radio")) count++;
    if (String(row?.["Estado salida"] || "").toLowerCase().includes("fuera de radio")) count++;
    return count;
  }


  function rowWorkInterval(row) {
    const startRaw = row?.["Fecha/hora entrada"];
    const endRaw = row?.["Fecha/hora salida"];
    if (!startRaw || !endRaw) return null;
    const start = new Date(startRaw).getTime();
    const end = new Date(endRaw).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    return { start, end };
  }

  function mergedIntervalsMinutes(intervals) {
    const valid = (intervals || []).filter(Boolean).sort((a, b) => a.start - b.start);
    if (!valid.length) return 0;
    let totalMs = 0;
    let currentStart = valid[0].start;
    let currentEnd = valid[0].end;
    for (let i = 1; i < valid.length; i++) {
      const item = valid[i];
      if (item.start <= currentEnd) currentEnd = Math.max(currentEnd, item.end);
      else {
        totalMs += currentEnd - currentStart;
        currentStart = item.start;
        currentEnd = item.end;
      }
    }
    totalMs += currentEnd - currentStart;
    return Math.round((totalMs / 60000) * 100) / 100;
  }

  function operationalSummaryByOperator(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = row.Operario || "Sin identificar";
      if (!map.has(key)) map.set(key, {
        "Operario": key,
        "Coberturas": 0,
        "Jornadas con entrada y salida": 0,
        "Horas confirmadas": "0 h 00 min",
        "Horas confirmadas (decimal)": 0,
        "Minutos confirmados": 0,
        "Horas pendientes validar": "0 h 00 min",
        "Minutos pendientes validar": 0,
        "Ingresos correctos": 0,
        "Llegadas tarde": 0,
        "Minutos demora acumulados": 0,
        "Fichajes fuera de radio": 0,
        "Ausencias / sin entrada": 0,
        "Ausencias registradas": 0,
        "Sin entrada inferido": 0,
        "Salidas anticipadas": 0,
        "Salidas no registradas": 0
      });
      const item = map.get(key);
      item["Coberturas"]++;
      const minutes = rowWorkedMinutes(row);
      const validation = rowValidationBucket(row);
      if (minutes > 0) {
        item["Jornadas con entrada y salida"]++;
        if (validation === "confirmed") item["Minutos confirmados"] += minutes;
        if (validation === "pending") item["Minutos pendientes validar"] += minutes;
      }
      if (row["Estado entrada"] === "Entrada correcta" || row["Estado entrada"] === "Entrada registrada") item["Ingresos correctos"]++;
      if (String(row["Estado entrada"]).includes("tarde") || String(row["Alertas RRHH"]).includes("Llegada tarde")) item["Llegadas tarde"]++;
      item["Minutos demora acumulados"] += Number(row["Minutos demora"] || 0) || 0;
      item["Fichajes fuera de radio"] += outsideIncidentsForRow(row);
      if (String(row["Alertas RRHH"]).includes("Ausencia / sin entrada")) item["Ausencias / sin entrada"]++;
      if (row["Origen del estado"] === "Ausencia registrada") item["Ausencias registradas"]++;
      if (row["Origen del estado"] === "Inferido por programación") item["Sin entrada inferido"]++;
      if (String(row["Alertas RRHH"]).includes("Salida anticipada")) item["Salidas anticipadas"]++;
      if (String(row["Alertas RRHH"]).includes("Salida no registrada")) item["Salidas no registradas"]++;
    });
    const dailyHours = operationalHoursByOperatorDate(rows);
    const netHours = new Map();
    dailyHours.forEach(day => {
      if (!netHours.has(day.Operario)) netHours.set(day.Operario, { confirmed: 0, pending: 0 });
      const total = netHours.get(day.Operario);
      total.confirmed += Number(day["Minutos confirmados"] || 0);
      total.pending += Number(day["Minutos pendientes validar"] || 0);
    });
    return Array.from(map.values()).map(item => {
      const net = netHours.get(item.Operario) || { confirmed: 0, pending: 0 };
      item["Minutos confirmados"] = Math.round(net.confirmed * 100) / 100;
      item["Minutos pendientes validar"] = Math.round(net.pending * 100) / 100;
      item["Horas confirmadas"] = minutesToHoursLabel(item["Minutos confirmados"]);
      item["Horas confirmadas (decimal)"] = Math.round((item["Minutos confirmados"] / 60) * 10000) / 10000;
      item["Horas pendientes validar"] = minutesToHoursLabel(item["Minutos pendientes validar"]);
      item["Minutos demora acumulados"] = Math.round(item["Minutos demora acumulados"] * 100) / 100;
      return item;
    }).sort((a, b) => a.Operario.localeCompare(b.Operario));
  }

  function operationalSummaryByDate(rows) {
    const map = new Map();
    rows.forEach(row => {
      const key = row.Fecha || "Sin fecha";
      if (!map.has(key)) map.set(key, { "Fecha": key, "Coberturas": 0, "Horas confirmadas": "0 h 00 min", "Horas confirmadas (decimal)": 0, "Minutos confirmados": 0, "Ingresos correctos": 0, "Llegadas tarde": 0, "Fichajes fuera de radio": 0, "Ausencias / sin entrada": 0, "Ausencias registradas": 0, "Sin entrada inferido": 0, "Alertas de salida": 0 });
      const item = map.get(key);
      item["Coberturas"]++;
      if (rowValidationBucket(row) === "confirmed") item["Minutos confirmados"] += rowWorkedMinutes(row);
      if (row["Estado entrada"] === "Entrada correcta" || row["Estado entrada"] === "Entrada registrada") item["Ingresos correctos"]++;
      if (String(row["Alertas RRHH"]).includes("Llegada tarde")) item["Llegadas tarde"]++;
      item["Fichajes fuera de radio"] += outsideIncidentsForRow(row);
      if (String(row["Alertas RRHH"]).includes("Ausencia / sin entrada")) item["Ausencias / sin entrada"]++;
      if (row["Origen del estado"] === "Ausencia registrada") item["Ausencias registradas"]++;
      if (row["Origen del estado"] === "Inferido por programación") item["Sin entrada inferido"]++;
      if (/Salida anticipada|Salida no registrada|Salida fuera de radio/.test(String(row["Alertas RRHH"]))) item["Alertas de salida"]++;
    });
    return Array.from(map.values()).map(item => {
      item["Horas confirmadas"] = minutesToHoursLabel(item["Minutos confirmados"]);
      item["Horas confirmadas (decimal)"] = Math.round((item["Minutos confirmados"] / 60) * 10000) / 10000;
      return item;
    }).sort((a, b) => a.Fecha.localeCompare(b.Fecha));
  }

  function operationalHoursByOperatorDate(rows) {
    const map = new Map();
    rows.forEach(row => {
      const operatorKey = row["Operator ID"] || row.Operario || "Sin identificar";
      const key = `${row.Fecha || ""}__${operatorKey}`;
      if (!map.has(key)) map.set(key, {
        "Fecha": row.Fecha || "",
        "Operator ID": row["Operator ID"] || "",
        "Operario": row.Operario || "Sin identificar",
        "Servicios trabajados": new Set(),
        "Turnos con entrada y salida": 0,
        confirmedIntervals: [],
        pendingIntervals: [],
        rejectedIntervals: []
      });
      const item = map.get(key);
      if (row.Servicio && rowWorkedMinutes(row) > 0) item["Servicios trabajados"].add(row.Servicio);
      const interval = rowWorkInterval(row);
      if (interval) {
        item["Turnos con entrada y salida"]++;
        const validation = rowValidationBucket(row);
        if (validation === "confirmed") item.confirmedIntervals.push(interval);
        if (validation === "pending") item.pendingIntervals.push(interval);
        if (validation === "rejected") item.rejectedIntervals.push(interval);
      }
    });
    return Array.from(map.values()).map(item => {
      const confirmed = mergedIntervalsMinutes(item.confirmedIntervals);
      const pending = mergedIntervalsMinutes(item.pendingIntervals);
      const rejected = mergedIntervalsMinutes(item.rejectedIntervals);
      return {
        "Fecha": item.Fecha,
        "Operator ID": item["Operator ID"],
        "Operario": item.Operario,
        "Servicios trabajados": Array.from(item["Servicios trabajados"]).join(" | "),
        "Turnos con entrada y salida": item["Turnos con entrada y salida"],
        "Minutos confirmados": confirmed,
        "Horas confirmadas": minutesToHoursLabel(confirmed),
        "Horas confirmadas (decimal)": Math.round((confirmed / 60) * 10000) / 10000,
        "Minutos pendientes validar": pending,
        "Horas pendientes validar": minutesToHoursLabel(pending),
        "Minutos rechazados": rejected,
        "Horas rechazadas": minutesToHoursLabel(rejected)
      };
    }).sort((a, b) => `${a.Fecha}|${a.Operario}`.localeCompare(`${b.Fecha}|${b.Operario}`));
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
      applyWorksheetUsability(wsDates, [14, 13, 18, 19, 19, 18, 16, 20, 22, 20, 20, 18]);
      window.XLSX.utils.book_append_sheet(wb, wsDates, "Resumen por día");

      const hoursByDay = operationalHoursByOperatorDate(rows);
      const wsHoursByDay = window.XLSX.utils.json_to_sheet(hoursByDay.length ? hoursByDay : [{ "Fecha": "Sin datos" }]);
      applyWorksheetUsability(wsHoursByDay, [14, 30, 42, 22, 20, 19, 24, 24, 24]);
      window.XLSX.utils.book_append_sheet(wb, wsHoursByDay, "Horas por operario y día");

      window.XLSX.writeFile(wb, `estado-operativo-cleanit-${period.label}.xlsx`);
      toast(`${rows.length} cobertura${rows.length === 1 ? "" : "s"} exportada${rows.length === 1 ? "" : "s"} a Excel.`, "success");
    });
  }


  function analyticsServiceValue(row) {
    return String(row?.["Site ID"] || row?.Servicio || "");
  }

  function updateAnalyticsServiceOptions(rows) {
    const select = $("#analyticsService");
    if (!select) return;
    const current = select.value;
    const services = new Map();
    (rows || []).forEach(row => {
      const value = analyticsServiceValue(row);
      if (value && row.Servicio) services.set(value, row.Servicio);
    });
    const options = Array.from(services.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
    select.innerHTML = `<option value="">Todos los servicios</option>` + options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
    if (current && services.has(current)) select.value = current;
  }

  function buildAnalyticsSummary(rows, profiles, includeAllActive = true) {
    const map = new Map();
    const rowOperatorIds = new Set((rows || []).map(row => row["Operator ID"]).filter(Boolean));
    const rowNames = new Map();
    (rows || []).forEach(row => {
      const key = row["Operator ID"] || `name:${row.Operario || "Sin identificar"}`;
      if (!rowNames.has(key)) rowNames.set(key, row.Operario || "Sin identificar");
    });

    if (includeAllActive) {
      (profiles || []).filter(profile => profile.role === "operator" && profile.is_active !== false).forEach(profile => {
        const key = profile.id || `name:${profile.full_name}`;
        map.set(key, {
          operator_id: profile.id || "",
          Operario: profile.full_name || "Sin identificar"
        });
      });
    }
    rowNames.forEach((name, key) => {
      if (!map.has(key)) map.set(key, { operator_id: key.startsWith("name:") ? "" : key, Operario: name });
    });

    map.forEach(item => Object.assign(item, {
      "Coberturas programadas": 0,
      "Jornadas con entrada": 0,
      "Jornadas completas": 0,
      "Minutos confirmados": 0,
      "Horas confirmadas": "0 h 00 min",
      "Horas confirmadas (decimal)": 0,
      "Minutos pendientes validar": 0,
      "Horas pendientes validar": "0 h 00 min",
      "Ausencias / sin entrada": 0,
      "Ausencias registradas": 0,
      "Sin entrada inferido": 0,
      "Llegadas tarde": 0,
      "Minutos demora acumulados": 0,
      "Promedio demora (min)": 0,
      "Entradas fuera de radio": 0,
      "Salidas fuera de radio": 0,
      "Fichajes fuera de radio": 0,
      "Salidas anticipadas": 0,
      "Salidas no registradas": 0,
      "Asistencia %": null,
      "Puntualidad %": null
    }));

    (rows || []).forEach(row => {
      const key = row["Operator ID"] || `name:${row.Operario || "Sin identificar"}`;
      if (!map.has(key)) return;
      const item = map.get(key);
      const scheduled = Boolean(row["Horario programado"] && row["Horario programado"] !== "No reconstruido");
      const hasEntry = Boolean(row["Fecha/hora entrada"]);
      const complete = rowWorkedMinutes(row) > 0;
      const alerts = String(row["Alertas RRHH"] || "");
      if (scheduled) item["Coberturas programadas"]++;
      if (hasEntry) item["Jornadas con entrada"]++;
      if (complete) item["Jornadas completas"]++;
      if (alerts.includes("Ausencia / sin entrada")) item["Ausencias / sin entrada"]++;
      if (row["Origen del estado"] === "Ausencia registrada") item["Ausencias registradas"]++;
      if (row["Origen del estado"] === "Inferido por programación") item["Sin entrada inferido"]++;
      if (alerts.includes("Llegada tarde") || String(row["Estado entrada"] || "").toLowerCase().includes("tarde")) item["Llegadas tarde"]++;
      item["Minutos demora acumulados"] += Number(row["Minutos demora"] || 0) || 0;
      if (String(row["Estado entrada"] || "").toLowerCase().includes("fuera de radio")) item["Entradas fuera de radio"]++;
      if (String(row["Estado salida"] || "").toLowerCase().includes("fuera de radio")) item["Salidas fuera de radio"]++;
      if (alerts.includes("Salida anticipada")) item["Salidas anticipadas"]++;
      if (alerts.includes("Salida no registrada")) item["Salidas no registradas"]++;
    });

    const daily = operationalHoursByOperatorDate(rows || []);
    daily.forEach(day => {
      const key = day["Operator ID"] || `name:${day.Operario || "Sin identificar"}`;
      if (!map.has(key)) return;
      const item = map.get(key);
      item["Minutos confirmados"] += Number(day["Minutos confirmados"] || 0);
      item["Minutos pendientes validar"] += Number(day["Minutos pendientes validar"] || 0);
    });

    return Array.from(map.values()).map(item => {
      item["Minutos confirmados"] = Math.round(item["Minutos confirmados"] * 100) / 100;
      item["Minutos pendientes validar"] = Math.round(item["Minutos pendientes validar"] * 100) / 100;
      item["Horas confirmadas"] = minutesToHoursLabel(item["Minutos confirmados"]);
      item["Horas confirmadas (decimal)"] = Math.round((item["Minutos confirmados"] / 60) * 10000) / 10000;
      item["Horas pendientes validar"] = minutesToHoursLabel(item["Minutos pendientes validar"]);
      item["Minutos demora acumulados"] = Math.round(item["Minutos demora acumulados"] * 100) / 100;
      item["Promedio demora (min)"] = item["Llegadas tarde"] ? Math.round((item["Minutos demora acumulados"] / item["Llegadas tarde"]) * 10) / 10 : 0;
      item["Fichajes fuera de radio"] = item["Entradas fuera de radio"] + item["Salidas fuera de radio"];
      const scheduled = item["Coberturas programadas"];
      item["Asistencia %"] = scheduled ? Math.max(0, Math.round(((scheduled - item["Ausencias / sin entrada"]) / scheduled) * 1000) / 10) : null;
      item["Puntualidad %"] = item["Jornadas con entrada"] ? Math.max(0, Math.round(((item["Jornadas con entrada"] - item["Llegadas tarde"]) / item["Jornadas con entrada"]) * 1000) / 10) : null;
      return item;
    }).sort((a, b) => a.Operario.localeCompare(b.Operario, "es"));
  }

  function analyticsSort(items, metric) {
    const order = $("#analyticsOrder")?.value || "desc";
    const direction = order === "asc" ? 1 : -1;
    return [...items].sort((a, b) => {
      const av = Number(a?.[metric] || 0);
      const bv = Number(b?.[metric] || 0);
      if (av !== bv) return (av - bv) * direction;
      return String(a.Operario || "").localeCompare(String(b.Operario || ""), "es");
    });
  }

  function renderAnalyticsBars(containerId, summary, metric, formatter, tone) {
    const container = $(containerId);
    if (!container) return;
    const sorted = analyticsSort(summary, metric).slice(0, 10);
    const max = Math.max(0, ...sorted.map(item => Number(item[metric] || 0)));
    if (!sorted.length) {
      container.innerHTML = `<p class="muted small">Sin datos para el período seleccionado.</p>`;
      return;
    }
    container.innerHTML = sorted.map((item, index) => {
      const value = Number(item[metric] || 0);
      const width = max > 0 ? Math.max(value > 0 ? 4 : 0, (value / max) * 100) : 0;
      return `<div class="analytics-bar-row">
        <div class="analytics-bar-label"><span>${index + 1}. ${escapeHtml(item.Operario)}</span><strong>${escapeHtml(formatter(value, item))}</strong></div>
        <div class="analytics-bar-track"><span class="analytics-bar-fill tone-${escapeHtml(tone)}" style="width:${width.toFixed(2)}%"></span></div>
      </div>`;
    }).join("");
  }

  function renderAnalyticsRanking(containerId, summary, metric, formatter) {
    const container = $(containerId);
    if (!container) return;
    const sorted = analyticsSort(summary, metric);
    container.innerHTML = sorted.length ? sorted.map((item, index) => `
      <div class="ranking-row">
        <span class="ranking-position">${index + 1}</span>
        <span class="ranking-name">${escapeHtml(item.Operario)}</span>
        <strong class="ranking-value">${escapeHtml(formatter(Number(item[metric] || 0), item))}</strong>
      </div>`).join("") : `<p class="muted small">Sin datos.</p>`;
  }

  function renderAnalyticsFromState() {
    const service = $("#analyticsService")?.value || "";
    const allRows = state.analyticsAllRows || [];
    const serviceRows = service ? allRows.filter(row => analyticsServiceValue(row) === service) : allRows;
    const searchTerm = sectionSearchTerm("analytics");
    const rows = searchTerm ? serviceRows.filter(row => objectMatchesSearch(searchTerm, row)) : serviceRows;
    const summary = buildAnalyticsSummary(rows, state.analyticsProfiles || [], !service && !searchTerm);
    const daily = operationalHoursByOperatorDate(rows);
    updateSectionSearchCount("analytics", rows.length, serviceRows.length);
    state.analyticsRows = rows;
    state.analyticsSummary = summary;
    state.analyticsDaily = daily;

    const totalConfirmed = summary.reduce((acc, item) => acc + Number(item["Minutos confirmados"] || 0), 0);
    const totalPending = summary.reduce((acc, item) => acc + Number(item["Minutos pendientes validar"] || 0), 0);
    const absences = summary.reduce((acc, item) => acc + Number(item["Ausencias / sin entrada"] || 0), 0);
    const lates = summary.reduce((acc, item) => acc + Number(item["Llegadas tarde"] || 0), 0);
    const outside = summary.reduce((acc, item) => acc + Number(item["Fichajes fuera de radio"] || 0), 0);
    const complete = summary.reduce((acc, item) => acc + Number(item["Jornadas completas"] || 0), 0);

    $("#analyticsKpis").innerHTML = `
      ${kpi("Horas confirmadas", minutesToHoursLabel(totalConfirmed), "status-present")}
      ${kpi("Horas pendientes validar", minutesToHoursLabel(totalPending), totalPending ? "status-late" : "status-present")}
      ${kpi("Jornadas completas", complete, "status-present")}
      ${kpi("Ausencias / sin entrada", absences, absences ? "status-absent" : "status-present")}
      ${kpi("Llegadas tarde", lates, lates ? "status-late" : "status-present")}
      ${kpi("Fichajes fuera de radio", outside, outside ? "status-outside" : "status-present")}
    `;

    renderAnalyticsBars("#analyticsHoursChart", summary, "Minutos confirmados", value => minutesToHoursLabel(value), "hours");
    renderAnalyticsBars("#analyticsAbsenceChart", summary, "Ausencias / sin entrada", value => String(value), "absence");
    renderAnalyticsBars("#analyticsLateChart", summary, "Llegadas tarde", value => String(value), "late");
    renderAnalyticsBars("#analyticsOutsideChart", summary, "Fichajes fuera de radio", value => String(value), "outside");
    renderAnalyticsRanking("#analyticsAbsenceRanking", summary, "Ausencias / sin entrada", value => String(value));
    renderAnalyticsRanking("#analyticsLateRanking", summary, "Llegadas tarde", value => String(value));
    renderAnalyticsRanking("#analyticsOutsideRanking", summary, "Fichajes fuera de radio", value => String(value));

    const rowsHtml = [...summary].sort((a, b) => a.Operario.localeCompare(b.Operario, "es")).map(item => `
      <tr class="${searchTerm ? "search-match-row" : ""}">
        <td><strong>${escapeHtml(item.Operario)}</strong></td>
        <td><strong>${escapeHtml(item["Horas confirmadas"])}</strong><br><span class="muted small">${Number(item["Horas confirmadas (decimal)"] || 0).toFixed(2)} h</span></td>
        <td>${escapeHtml(item["Horas pendientes validar"])}</td>
        <td>${item["Jornadas completas"]}</td>
        <td>${item["Ausencias / sin entrada"]}</td>
        <td>${item["Llegadas tarde"]}<br><span class="muted small">${item["Minutos demora acumulados"]} min acum.</span></td>
        <td>${item["Fichajes fuera de radio"]}</td>
        <td>${item["Salidas anticipadas"]}</td>
        <td>${item["Salidas no registradas"]}</td>
        <td>${item["Asistencia %"] == null ? "—" : `${item["Asistencia %"].toFixed(1)}%`}</td>
        <td>${item["Puntualidad %"] == null ? "—" : `${item["Puntualidad %"].toFixed(1)}%`}</td>
      </tr>`).join("");
    $("#analyticsSummaryTable").innerHTML = `<table><thead><tr><th>Operario</th><th>Horas confirmadas</th><th>Horas pendientes</th><th>Jornadas completas</th><th>Ausencias</th><th>Tardanzas</th><th>Fuera de radio</th><th>Salidas anticipadas</th><th>Sin salida</th><th>Asistencia</th><th>Puntualidad</th></tr></thead><tbody>${rowsHtml || `<tr><td colspan="11">Sin datos para el período seleccionado.</td></tr>`}</tbody></table>`;

    const period = state.analyticsPeriodResolved;
    const serviceLabel = service ? ($("#analyticsService")?.selectedOptions?.[0]?.textContent || "Servicio filtrado") : "Todos los servicios";
    $("#analyticsRangeSummary").textContent = period ? `${period.from || "Inicio"} → ${period.to || todayISO()} · ${serviceLabel} · ${rows.length} coberturas analizadas` : "";
  }

  async function loadAnalyticsData() {
    const button = $("#applyAnalyticsBtn");
    await withExportButton(button, "Analizando...", async () => {
      const requested = resolvePeriod("analytics");
      const context = await fetchReportContext(requested);
      const built = buildOperationalExportRows(requested, context);
      state.analyticsAllRows = built.rows;
      state.analyticsProfiles = context.profiles;
      state.analyticsPeriodResolved = built.period;
      state.analyticsLoaded = true;
      updateAnalyticsServiceOptions(built.rows);
      renderAnalyticsFromState();
    });
  }

  function analyticsExportSummaryRows() {
    return (state.analyticsSummary || []).map(item => ({
      "Operario": item.Operario,
      "Horas confirmadas": item["Horas confirmadas"],
      "Horas confirmadas (decimal)": item["Horas confirmadas (decimal)"],
      "Minutos confirmados": item["Minutos confirmados"],
      "Horas pendientes validar": item["Horas pendientes validar"],
      "Coberturas programadas": item["Coberturas programadas"],
      "Jornadas con entrada": item["Jornadas con entrada"],
      "Jornadas completas": item["Jornadas completas"],
      "Ausencias / sin entrada": item["Ausencias / sin entrada"],
      "Ausencias registradas": item["Ausencias registradas"],
      "Sin entrada inferido": item["Sin entrada inferido"],
      "Llegadas tarde": item["Llegadas tarde"],
      "Minutos demora acumulados": item["Minutos demora acumulados"],
      "Promedio demora (min)": item["Promedio demora (min)"],
      "Entradas fuera de radio": item["Entradas fuera de radio"],
      "Salidas fuera de radio": item["Salidas fuera de radio"],
      "Fichajes fuera de radio": item["Fichajes fuera de radio"],
      "Salidas anticipadas": item["Salidas anticipadas"],
      "Salidas no registradas": item["Salidas no registradas"],
      "Asistencia %": item["Asistencia %"],
      "Puntualidad %": item["Puntualidad %"]
    }));
  }

  async function exportAnalyticsCsv() {
    const button = $("#exportAnalyticsCsvBtn");
    await withExportButton(button, "Generando...", async () => {
      await loadAnalyticsData();
      const rows = state.analyticsRows || [];
      const headers = rows.length ? Object.keys(rows[0]) : ["Fecha", "Operario", "Servicio", "Duración trabajada", "Alertas RRHH"];
      const label = state.analyticsPeriodResolved?.label || "periodo";
      downloadCsvObjects(rows, headers, `analisis-presentismo-cleanit-${label}.csv`);
      toast(`${rows.length} registros detallados exportados a CSV.`, "success");
    });
  }

  async function exportAnalyticsExcel() {
    const button = $("#exportAnalyticsExcelBtn");
    await withExportButton(button, "Generando...", async () => {
      if (!window.XLSX) throw new Error("No se pudo cargar el módulo de Excel.");
      await loadAnalyticsData();
      const summary = analyticsExportSummaryRows();
      const daily = state.analyticsDaily || [];
      const detail = state.analyticsRows || [];
      const byDate = operationalSummaryByDate(detail);
      const wb = window.XLSX.utils.book_new();

      const wsSummary = window.XLSX.utils.json_to_sheet(summary.length ? summary : [{ "Operario": "Sin datos" }]);
      applyWorksheetUsability(wsSummary, [30, 20, 22, 20, 24, 20, 20, 20, 22, 22, 20, 18, 24, 22, 22, 22, 22, 22, 22, 16, 16]);
      window.XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen operarios");

      const wsDaily = window.XLSX.utils.json_to_sheet(daily.length ? daily : [{ "Fecha": "Sin datos" }]);
      applyWorksheetUsability(wsDaily, [14, 38, 30, 42, 22, 20, 20, 22, 24, 24, 22, 20]);
      window.XLSX.utils.book_append_sheet(wb, wsDaily, "Horas por operario y día");

      const wsDetail = window.XLSX.utils.json_to_sheet(detail.length ? detail : [{ "Sin datos": "No hay registros en el período seleccionado." }]);
      applyWorksheetUsability(wsDetail, [14, 30, 30, 28, 20, 24, 18, 30, 20, 18, 28, 24, 18, 16, 18, 22, 18, 18, 18, 22, 18, 20, 18, 18, 18, 18, 36, 40, 30, 42]);
      window.XLSX.utils.book_append_sheet(wb, wsDetail, "Detalle RRHH");

      const wsDate = window.XLSX.utils.json_to_sheet(byDate.length ? byDate : [{ "Fecha": "Sin datos" }]);
      applyWorksheetUsability(wsDate, [14, 18, 22, 22, 20, 20, 20, 20, 22, 22, 22, 20]);
      window.XLSX.utils.book_append_sheet(wb, wsDate, "Resumen por día");

      const label = state.analyticsPeriodResolved?.label || "periodo";
      window.XLSX.writeFile(wb, `analisis-presentismo-cleanit-${label}.xlsx`);
      toast("Excel de análisis generado con resumen, horas diarias y detalle RRHH.", "success");
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
      "Tipo de trabajo": workTypeLabel(event.work_type || "regular"),
      "Origen de tarea": event.entry_source === "operator_extra" ? "Declarado por operario" : "Asignación",
      "Validación": validationLabel(event.validation_status || "confirmed"),
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
    const profileSource = state.recordsLoaded ? state.recordsProfiles : state.profiles;
    const siteSource = state.recordsLoaded ? state.recordsSites : state.sites;
    const searchTerm = sectionSearchTerm("records");
    const filteredEvents = searchTerm ? events.filter(event => {
      const op = byId(profileSource, event.operator_id);
      const site = byId(siteSource, event.site_id);
      return valuesMatchSearch(searchTerm, op?.full_name, site?.name, site?.address, site?.zone, workTypeLabel(event.work_type || "regular"), eventTypeLabel(event.event_type), observedStatusLabel(event.observed_status), event.notes, event.shift_date);
    }) : events;
    updateSectionSearchCount("records", filteredEvents.length, events.length);
    const displayLimit = 1000;
    const displayEvents = filteredEvents.slice(0, displayLimit);
    const rows = displayEvents.map(event => {
      const op = byId(profileSource, event.operator_id);
      const site = byId(siteSource, event.site_id);
      return `
        <tr class="${searchTerm ? "search-match-row" : ""}">
          <td>${formatDateTime(eventTimestamp(event) || event.created_at)}</td>
          <td>${escapeHtml(event.shift_date || "—")}</td>
          <td>${escapeHtml(op?.full_name || event.operator_id || "—")}</td>
          <td>${escapeHtml(site?.name || event.site_id || "—")}</td>
          <td>${escapeHtml(workTypeLabel(event.work_type || "regular"))}${event.entry_source === "operator_extra" ? `<br><span class="muted small">Declarado por operario · ${escapeHtml(validationLabel(event.validation_status || "pending"))}</span>` : ""}</td>
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
        <thead><tr><th>Hora registro</th><th>Fecha servicio</th><th>Operario</th><th>Servicio</th><th>Tipo de trabajo</th><th>Marcación</th><th>GPS</th><th>Precisión</th><th>Distancia</th><th>Dentro radio</th><th>Obs.</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="11">No hay marcaciones para el período seleccionado.</td></tr>`}</tbody>
      </table>`;

    const summary = $("#recordsRangeSummary");
    if (summary) {
      let label = "registros cargados";
      try {
        const period = resolvePeriod("records");
        label = period.isAll ? "historial completo" : period.from === period.to ? formatOperationalDate(period.from) : `${formatOperationalDate(period.from)} al ${formatOperationalDate(period.to)}`;
      } catch (_) { /* conserva etiqueta genérica */ }
      const displayNote = filteredEvents.length > displayLimit ? ` · mostrando ${displayLimit} coincidencias en pantalla` : "";
      const searchNote = searchTerm ? ` · ${filteredEvents.length} coincidencia${filteredEvents.length === 1 ? "" : "s"} de ${events.length}` : "";
      summary.textContent = `${events.length} marcación${events.length === 1 ? "" : "es"} · ${label}${searchNote}${displayNote}`;
    }
  }

  async function exportCsv() {
    const button = $("#exportCsvBtn");
    await withExportButton(button, "Generando...", async () => {
      const { period, events, profiles, sites } = await fetchRecordsForSelectedPeriod();
      const headers = ["fecha_hora", "fecha_servicio", "operario", "servicio", "tipo", "tipo_legible", "estado", "estado_legible", "lat", "lng", "precision_m", "distancia_m", "dentro_radio", "observacion", "assignment_id", "shift_id", "tipo_trabajo", "origen_tarea", "validacion"];
      const rows = events.map(event => {
        const op = byId(profiles, event.operator_id);
        const site = byId(sites, event.site_id);
        return {
          fecha_hora: event.created_at || "",
          fecha_servicio: event.shift_date || "",
          operario: op?.full_name || event.operator_id || "",
          servicio: site?.name || event.site_id || "",
          tipo_trabajo: workTypeLabel(event.work_type || "regular"),
          origen_tarea: event.entry_source === "operator_extra" ? "Declarado por operario" : "Asignación",
          validacion: validationLabel(event.validation_status || "confirmed"),
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
    $("#refreshOperatorBtn")?.addEventListener("click", () => renderOperatorView().catch(error => toast(error.message || "No se pudieron actualizar los servicios.")));
    $("#supervisorLogoutBtn").addEventListener("click", logout);
    $("#contextSearchInput")?.addEventListener("input", (event) => {
      const tab = state.activeTab;
      state.sectionSearch[tab] = event.target.value || "";
      syncContextSearchUI(tab);
      renderSectionForContextSearch(tab);
    });
    $("#contextSearchInput")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      focusCurrentSearchResults();
    });
    $("#clearContextSearchBtn")?.addEventListener("click", () => {
      const tab = state.activeTab;
      state.sectionSearch[tab] = "";
      syncContextSearchUI(tab);
      renderSectionForContextSearch(tab);
      $("#contextSearchInput")?.focus();
    });
    $$(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
      renderTab(btn.dataset.tab);
      if (btn.dataset.tab === "records") loadRecordsPeriod().catch(error => toast(error.message || "No se pudieron cargar los registros."));
      if (btn.dataset.tab === "analytics" && !state.analyticsLoaded) loadAnalyticsData().catch(error => toast(error.message || "No se pudo generar el análisis."));
      if (btn.dataset.tab === "fichaje") loadFichajePeriod().catch(error => toast(error.message || "No se pudo cargar el fichaje del período."));
    }));
    $("#refreshDashboardBtn").addEventListener("click", renderSupervisorView);
    $("#dashboardDate").addEventListener("change", async () => {
      syncPeriodControls("live", false);
      await renderSupervisorView();
    });
    $("#liveExportPeriod").addEventListener("change", () => syncPeriodControls("live", false));
    $("#analyticsPeriod")?.addEventListener("change", () => { syncPeriodControls("analytics", false); state.analyticsLoaded = false; });
    $("#applyAnalyticsBtn")?.addEventListener("click", () => loadAnalyticsData().catch(error => toast(error.message || "No se pudo generar el análisis.")));
    $("#analyticsService")?.addEventListener("change", renderAnalyticsFromState);
    $("#analyticsOrder")?.addEventListener("change", renderAnalyticsFromState);
    $("#exportAnalyticsCsvBtn")?.addEventListener("click", () => exportAnalyticsCsv().catch(error => toast(error.message || "No se pudo exportar el análisis a CSV.")));
    $("#exportAnalyticsExcelBtn")?.addEventListener("click", () => exportAnalyticsExcel().catch(error => toast(error.message || "No se pudo exportar el análisis a Excel.")));
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
      const mapButton = event.target.closest("[data-map-event]");
      if (mapButton) return openAttendanceMap(mapButton.dataset.mapEvent);
      const validationButton = event.target.closest("[data-extra-validation]");
      if (validationButton) updateExtraValidation(validationButton.dataset.extraShift, validationButton.dataset.extraValidation).catch(error => toast(error.message || "No se pudo validar el registro."));
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
    $("#siteForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await store.upsertSite(sitePayloadFromForm());
      resetSiteForm();
      toast("Servicio guardado.");
      await renderSupervisorView();
    });
    $("#cancelSiteEditBtn").addEventListener("click", resetSiteForm);
    $("#selectAllSitesBtn").addEventListener("click", () => {
      state.bulkSelectedSiteIds = new Set(state.sites.map(site => site.id));
      renderSites();
    });
    $("#clearSelectedSitesBtn").addEventListener("click", () => {
      state.bulkSelectedSiteIds.clear();
      renderSites();
    });
    $("#bulkSiteScope").addEventListener("change", updateBulkSelectionSummaries);
    $("#applyBulkSitesBtn").addEventListener("click", () => applyBulkSiteRadius().catch(error => toast(error.message || "No se pudo actualizar el radio GPS.")));

    $("#extraAssignmentForm")?.addEventListener("submit", (event) => saveExtraAssignment(event).catch(error => toast(error.message || "No se pudo crear la tarea extraordinaria.")));

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
    $("#selectAllAssignmentsBtn").addEventListener("click", () => {
      state.bulkSelectedAssignmentIds = new Set(state.assignments.map(assignment => assignment.id));
      renderAssignments();
    });
    $("#clearSelectedAssignmentsBtn").addEventListener("click", () => {
      state.bulkSelectedAssignmentIds.clear();
      renderAssignments();
    });
    $("#bulkAssignmentScope").addEventListener("change", updateBulkSelectionSummaries);
    $("#applyBulkAssignmentsBtn").addEventListener("click", () => applyBulkAssignmentSettings().catch(error => toast(error.message || "No se pudieron actualizar las tolerancias.")));

    $("#assignmentAuditFile")?.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      state.assignmentAuditFileName = file?.name || "";
      state.assignmentAuditParsed = null;
      state.assignmentAuditAnalysis = null;
      state.assignmentAuditSelectedKeys.clear();
      if ($("#assignmentAuditFileInfo")) $("#assignmentAuditFileInfo").textContent = file ? `${file.name} listo para analizar.` : "Todavía no cargaste un archivo.";
      renderAssignmentAudit();
    });
    $("#assignmentAuditEffectiveDate")?.addEventListener("change", () => {
      if (state.assignmentAuditParsed) analyzeParsedAssignmentAudit();
    });
    $("#analyzeAssignmentsExcelBtn")?.addEventListener("click", () => analyzeAssignmentAuditFile().catch(error => toast(error.message || "No se pudo analizar el Excel.")));
    $("#clearAssignmentsExcelBtn")?.addEventListener("click", clearAssignmentAudit);
    $("#assignmentAuditFilters")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-audit-filter]");
      if (!button) return;
      state.assignmentAuditFilter = button.dataset.auditFilter || "alerts";
      renderAssignmentAudit();
    });
    $("#selectAuditAlertsBtn")?.addEventListener("click", () => {
      state.assignmentAuditSelectedKeys = new Set(auditSyncableAlertKeys());
      renderAssignmentAudit();
    });
    $("#clearAuditSelectionBtn")?.addEventListener("click", () => {
      state.assignmentAuditSelectedKeys.clear();
      renderAssignmentAudit();
    });
    $("#applySelectedAuditBtn")?.addEventListener("click", () => applyAssignmentAuditKeys([...state.assignmentAuditSelectedKeys]).catch(error => toast(error.message || "No se pudieron sincronizar las diferencias seleccionadas.")));
    $("#applyAllAuditBtn")?.addEventListener("click", () => {
      const keys = auditSyncableAlertKeys();
      const blocked = state.assignmentAuditAnalysis?.stats?.blocked || 0;
      if (!keys.length) return toast(blocked ? "No hay diferencias corregibles automáticamente hasta resolver los bloqueos." : "No hay diferencias para corregir.");
      applyAssignmentAuditKeys(keys).catch(error => toast(error.message || "No se pudieron sincronizar todas las diferencias."));
    });

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
    $("#applyFichajeBtn").addEventListener("click", () => loadFichajePeriod().catch(error => toast(error.message || "No se pudo cargar el fichaje.")));
    $("#exportFichajeBtn").addEventListener("click", () => exportFichajeExcel().catch(error => toast(error.message || "No se pudo exportar el fichaje.")));
  }

  async function init() {
    renderConnectionMode();
    renderLoginMode();
    renderAssignmentSchedule();
    $("#dashboardDate").value = todayISO();
    $("#assignmentValidFrom").value = todayISO();
    if ($("#assignmentAuditEffectiveDate")) $("#assignmentAuditEffectiveDate").value = todayISO();
    if ($("#extraAssignmentDate")) $("#extraAssignmentDate").value = todayISO();
    syncPeriodControls("live", false);
    syncPeriodControls("records", false);
    syncPeriodControls("analytics", false);
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
