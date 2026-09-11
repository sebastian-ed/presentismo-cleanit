(function () {
  const CONFIG = window.APP_CONFIG || {};
  const APP_TIME_ZONE = CONFIG.TIMEZONE || CONFIG.TIME_ZONE || "America/Argentina/Buenos_Aires";

  function dateISOInTimeZone(date = new Date(), timeZone = APP_TIME_ZONE) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  const todayISO = () => dateISOInTimeZone(new Date());

  function isoDay(dateString) {
    const day = new Date(`${dateString}T12:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
  }

  function hasSupabaseConfig() {
    return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase);
  }

  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }

  function isAssignmentActiveForDate(assignment, dateString) {
    if (assignment.is_active === false) return false;
    const day = isoDay(dateString);
    const days = Array.isArray(assignment.days_of_week) ? assignment.days_of_week.map(Number) : [];
    if (!days.includes(day)) return false;
    if (assignment.valid_from && assignment.valid_from > dateString) return false;
    if (assignment.valid_to && assignment.valid_to < dateString) return false;
    return true;
  }

  function assignmentTimesOverlap(a, b) {
    const aStart = String(a.scheduled_start || "00:00").slice(0, 5);
    const aEnd = String(a.scheduled_end || "23:59").slice(0, 5);
    const bStart = String(b.scheduled_start || "00:00").slice(0, 5);
    const bEnd = String(b.scheduled_end || "23:59").slice(0, 5);
    return aStart < bEnd && bStart < aEnd;
  }

  function materializeShift(assignment, dateString) {
    return {
      id: `${assignment.id}__${dateString}`,
      assignment_id: assignment.id,
      shift_date: dateString,
      operator_id: assignment.operator_id,
      site_id: assignment.site_id,
      scheduled_start: assignment.scheduled_start,
      scheduled_end: assignment.scheduled_end,
      grace_minutes: assignment.grace_minutes ?? 10,
      absence_after_minutes: assignment.absence_after_minutes ?? 30,
      notes: assignment.notes || "",
      assignment_type: assignment.assignment_type || "fixed",
      covered_operator_id: assignment.covered_operator_id || null,
      created_by: assignment.created_by || null,
      suppress_regular_assignments: assignment.suppress_regular_assignments === true,
      is_active: assignment.is_active !== false
    };
  }

  function materializeShifts(assignments, dateString) {
    const active = assignments.filter(a => isAssignmentActiveForDate(a, dateString));
    const suppressors = active.filter(a => (a.assignment_type || "fixed") !== "fixed" && a.suppress_regular_assignments === true);
    const effective = active.filter(a => {
      if ((a.assignment_type || "fixed") !== "fixed") return true;
      return !suppressors.some(extra => extra.operator_id === a.operator_id && (
        String(extra.assignment_type || "") === "special" || assignmentTimesOverlap(extra, a)
      ));
    });
    return effective
      .map(a => materializeShift(a, dateString))
      .sort((a, b) => `${a.scheduled_start} ${a.site_id}`.localeCompare(`${b.scheduled_start} ${b.site_id}`));
  }

  class SupabaseStore {
    constructor() {
      if (!hasSupabaseConfig()) {
        throw new Error("Falta configurar Supabase. Revisá js/config.js y la carga de @supabase/supabase-js.");
      }

      this.mode = "supabase";
      this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: "cleanit-presentismo-auth"
        }
      });
      this.offlineUserId = null;
      this.OFFLINE_AUTH_KEY = "cleanit-presentismo-offline-auth-v1";
      this.OFFLINE_QUEUE_KEY = "cleanit-presentismo-offline-events-v1";
      this.OFFLINE_ERROR_QUEUE_KEY = "cleanit-presentismo-offline-error-logs-v1";
    }

    isNetworkError(error) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
      const text = String(error?.message || error || "").toLowerCase();
      return text.includes("failed to fetch") || text.includes("network") || text.includes("load failed") || text.includes("fetch");
    }

    readJson(key, fallback = null) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    }

    writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (_) {
        return false;
      }
    }

    offlineDataKey(kind, userId = this.offlineUserId) {
      return `cleanit-presentismo-offline-${kind}-v1-${userId || "unknown"}`;
    }

    cacheOfflineAuth(user, profile) {
      if (!user?.id || !profile?.id) return;
      this.offlineUserId = user.id;
      this.writeJson(this.OFFLINE_AUTH_KEY, {
        user: { id: user.id, email: user.email || null },
        profile,
        cached_at: new Date().toISOString()
      });
    }

    readOfflineAuth() {
      const cached = this.readJson(this.OFFLINE_AUTH_KEY, null);
      if (cached?.user?.id && cached?.profile?.id) this.offlineUserId = cached.user.id;
      return cached;
    }

    clearOfflineAuth() {
      try { window.localStorage.removeItem(this.OFFLINE_AUTH_KEY); } catch (_) { /* noop */ }
      this.offlineUserId = null;
    }

    cacheOfflineData(kind, rows) {
      if (!this.offlineUserId) {
        const cachedAuth = this.readOfflineAuth();
        if (!cachedAuth?.user?.id) return;
      }
      this.writeJson(this.offlineDataKey(kind), { rows: rows || [], cached_at: new Date().toISOString() });
    }

    readOfflineData(kind) {
      const cachedAuth = this.readOfflineAuth();
      const userId = this.offlineUserId || cachedAuth?.user?.id;
      if (!userId) return [];
      return this.readJson(this.offlineDataKey(kind, userId), { rows: [] })?.rows || [];
    }

    readOfflineQueue() {
      const rows = this.readJson(this.OFFLINE_QUEUE_KEY, []);
      return Array.isArray(rows) ? rows : [];
    }

    writeOfflineQueue(rows) {
      this.writeJson(this.OFFLINE_QUEUE_KEY, Array.isArray(rows) ? rows : []);
    }

    queueOfflineEvent(payload) {
      const cleanPayload = this.clean(payload || {});
      if (!cleanPayload.id) cleanPayload.id = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      const queue = this.readOfflineQueue();
      if (!queue.some(item => item?.id === cleanPayload.id)) queue.push(cleanPayload);
      this.writeOfflineQueue(queue);
      const cachedEvents = this.readOfflineData("events");
      const merged = [cleanPayload, ...cachedEvents.filter(item => item?.id !== cleanPayload.id)];
      this.cacheOfflineData("events", merged.slice(0, 1500));
      return { ...cleanPayload, __offline_pending: true };
    }

    async getOfflineQueueCount() {
      const auth = this.readOfflineAuth();
      const userId = this.offlineUserId || auth?.user?.id;
      return this.readOfflineQueue().filter(item => !userId || item?.operator_id === userId).length;
    }

    async flushOfflineQueue() {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { synced: 0, pending: await this.getOfflineQueueCount() };
      const queue = this.readOfflineQueue();
      if (!queue.length) return { synced: 0, pending: 0 };

      let sessionUserId = null;
      try {
        const { data } = await this.client.auth.getSession();
        sessionUserId = data?.session?.user?.id || null;
      } catch (_) { /* noop */ }
      if (!sessionUserId) return { synced: 0, pending: queue.length };

      let synced = 0;
      const remaining = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item?.operator_id !== sessionUserId) {
          remaining.push(item);
          continue;
        }
        try {
          const { error } = await this.client.from("attendance_events").insert(this.clean(item));
          if (error) {
            if (String(error.code || "") === "23505") {
              synced++;
              continue;
            }
            remaining.push(item);
            if (this.isNetworkError(error)) {
              remaining.push(...queue.slice(i + 1));
              break;
            }
            continue;
          }
          synced++;
        } catch (error) {
          remaining.push(item);
          if (this.isNetworkError(error)) {
            remaining.push(...queue.slice(i + 1));
            break;
          }
        }
      }
      this.writeOfflineQueue(remaining);
      return { synced, pending: remaining.filter(item => item?.operator_id === sessionUserId).length };
    }

    clean(payload) {
      const copy = { ...payload };
      Object.keys(copy).forEach(key => {
        if (copy[key] === "") copy[key] = null;
        if (copy[key] === undefined) delete copy[key];
      });
      return copy;
    }

    async loginWithPassword(email, password) {
      const normalizedEmail = normalizeEmail(email);
      const { data, error } = await this.client.auth.signInWithPassword({
        email: normalizedEmail,
        password
      });
      if (error) throw new Error(error.message || "Email o contraseña incorrectos.");
      if (!data?.user) throw new Error("No se pudo obtener el usuario autenticado.");
      const profile = await this.loadProfileForAuthUser(data.user);
      this.cacheOfflineAuth(data.user, profile);
      return { user: data.user, profile };
    }

    async loginWithIdentifier(identifier, password) {
      const raw = String(identifier || "").trim().toLowerCase();
      if (!raw) throw new Error("Ingresá tu usuario o email.");

      // Los emails reales pueden autenticarse directamente. Para nombres de usuario
      // usamos la Edge Function, que resuelve el email sin exponerlo al navegador.
      if (raw.includes("@")) return this.loginWithPassword(raw, password);

      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "login", identifier: raw, password }
      });

      if (error || data?.error || !data?.session?.access_token || !data?.session?.refresh_token) {
        // Compatibilidad transitoria con operarios históricos si todavía no se desplegó user-auth.
        try {
          return await this.loginWithPassword(`${raw}@cleanit.ar`, password);
        } catch (_) {
          throw new Error(data?.error || await this.functionErrorMessage(error, "Usuario o contraseña incorrectos."));
        }
      }

      const { data: sessionData, error: sessionError } = await this.client.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token
      });
      if (sessionError || !sessionData?.user) throw new Error(sessionError?.message || "No se pudo iniciar la sesión.");
      const profile = await this.loadProfileForAuthUser(sessionData.user);
      this.cacheOfflineAuth(sessionData.user, profile);
      return { user: sessionData.user, profile };
    }

    async requestPasswordReset(identifier, recoveryEmail = "") {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: {
          action: "forgot_password",
          identifier: String(identifier || "").trim(),
          recovery_email: String(recoveryEmail || "").trim().toLowerCase(),
          redirect_to: redirectTo
        }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo enviar el email de recuperación."));
      if (data?.error) throw new Error(data.error);
      return data || { success: true };
    }

    async updateCurrentPassword(password) {
      const { data, error } = await this.client.auth.updateUser({ password });
      if (error) throw new Error(error.message || "No se pudo actualizar la contraseña.");
      return data?.user || null;
    }

    onAuthStateChange(callback) {
      return this.client.auth.onAuthStateChange((event, session) => callback(event, session));
    }

    async getSession() {
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    }

    async getCurrentSessionProfile() {
      let user = null;
      try {
        const { data, error } = await this.client.auth.getSession();
        if (error) throw error;
        user = data?.session?.user || null;
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
      }

      if (!user) {
        const cached = this.readOfflineAuth();
        if (cached?.user?.id && typeof navigator !== "undefined" && navigator.onLine === false) {
          return { user: cached.user, profile: cached.profile, offline: true };
        }
        return null;
      }

      this.offlineUserId = user.id;
      try {
        const profile = await this.loadProfileForAuthUser(user);
        this.cacheOfflineAuth(user, profile);
        return { user, profile };
      } catch (error) {
        const cached = this.readOfflineAuth();
        if (this.isNetworkError(error) && cached?.user?.id === user.id && cached?.profile?.id === user.id) {
          return { user: cached.user, profile: cached.profile, offline: true };
        }
        throw error;
      }
    }

    async loadProfileForAuthUser(authUser) {
      const { data, error } = await this.client
        .from("profiles")
        .select("*")
        .eq("id", authUser.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        throw new Error("El usuario existe en Supabase Authentication, pero no tiene un perfil activo en public.profiles con el mismo UUID. Creá el perfil con id = User UID.");
      }

      this.offlineUserId = authUser.id;
      this.cacheOfflineAuth(authUser, data);
      return data;
    }

    async signOut() {
      await this.client.auth.signOut();
      this.clearOfflineAuth();
      return true;
    }

    async listProfiles(role) {
      let query = this.client
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (role) query = query.eq("role", role);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async listSites() {
      try {
        const { data, error } = await this.client
          .from("sites")
          .select("*")
          .eq("is_active", true)
          .order("name", { ascending: true });

        if (error) throw error;
        const rows = data || [];
        this.cacheOfflineData("sites", rows);
        return rows;
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
        const cached = this.readOfflineData("sites");
        if (cached.length) return cached;
        throw new Error("No hay conexión y este teléfono todavía no tiene los servicios guardados para uso sin internet.");
      }
    }

    async listAssignments() {
      try {
        const { data, error } = await this.client
          .from("assignments")
          .select("*")
          .eq("is_active", true)
          .order("scheduled_start", { ascending: true });

        if (error) throw error;
        const rows = data || [];
        this.cacheOfflineData("assignments", rows);
        return rows;
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
        const cached = this.readOfflineData("assignments");
        if (cached.length) return cached;
        throw new Error("No hay conexión y este teléfono todavía no tiene las asignaciones guardadas para uso sin internet.");
      }
    }

    async listShifts(date) {
      const assignments = await this.listAssignments();
      return materializeShifts(assignments, date || todayISO());
    }

    async listEvents() {
      if (typeof navigator !== "undefined" && navigator.onLine !== false) {
        try { await this.flushOfflineQueue(); } catch (_) { /* se mantiene la cola */ }
      }
      try {
        const { data, error } = await this.client
          .from("attendance_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1500);

        if (error) throw error;
        const rows = data || [];
        this.cacheOfflineData("events", rows);
        const pending = this.readOfflineQueue();
        const userId = this.offlineUserId || this.readOfflineAuth()?.user?.id;
        const pendingOwn = pending.filter(item => !userId || item?.operator_id === userId);
        const ids = new Set(pendingOwn.map(item => item?.id));
        return [...pendingOwn.map(item => ({ ...item, __offline_pending: true })), ...rows.filter(item => !ids.has(item?.id))];
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
        const cached = this.readOfflineData("events");
        const pending = this.readOfflineQueue();
        const userId = this.offlineUserId || this.readOfflineAuth()?.user?.id;
        const pendingOwn = pending.filter(item => !userId || item?.operator_id === userId);
        const ids = new Set(pendingOwn.map(item => item?.id));
        return [...pendingOwn.map(item => ({ ...item, __offline_pending: true })), ...cached.filter(item => !ids.has(item?.id))];
      }
    }

    async listFlexibleAttendanceModes() {
      try {
        const { data, error } = await this.client
          .from("flexible_attendance_modes")
          .select("*")
          .order("valid_from", { ascending: false });
        if (error) throw error;
        const rows = data || [];
        this.cacheOfflineData("flexible_modes", rows);
        return rows;
      } catch (error) {
        const code = String(error?.code || "");
        const message = String(error?.message || "").toLowerCase();
        if (code === "42P01" || message.includes("flexible_attendance_modes")) return [];
        if (!this.isNetworkError(error)) throw error;
        return this.readOfflineData("flexible_modes");
      }
    }

    async setFlexibleAttendanceMode(operatorId, enabled, siteId = null, effectiveDate = todayISO()) {
      const { data: activeRows, error: activeError } = await this.client
        .from("flexible_attendance_modes")
        .select("*")
        .eq("operator_id", operatorId)
        .is("valid_to", null)
        .order("valid_from", { ascending: false });
      if (activeError) throw activeError;
      const active = (activeRows || [])[0] || null;

      if (enabled) {
        if (!siteId) throw new Error("Seleccioná el servicio para la jornada flexible.");
        if (active && active.site_id === siteId) return active;

        if (active) {
          if (active.valid_from === effectiveDate) {
            const { data, error } = await this.client
              .from("flexible_attendance_modes")
              .update({ site_id: siteId })
              .eq("id", active.id)
              .select("*")
              .single();
            if (error) throw error;
            return data;
          }
          const yesterday = new Date(`${effectiveDate}T12:00:00Z`);
          yesterday.setUTCDate(yesterday.getUTCDate() - 1);
          const validTo = yesterday.toISOString().slice(0, 10);
          const { error: closeError } = await this.client
            .from("flexible_attendance_modes")
            .update({ valid_to: validTo })
            .eq("id", active.id);
          if (closeError) throw closeError;
        }

        const { data, error } = await this.client
          .from("flexible_attendance_modes")
          .insert({ operator_id: operatorId, site_id: siteId, valid_from: effectiveDate })
          .select("*")
          .single();
        if (error) throw error;
        return data;
      }

      if (!active) return null;
      if (active.valid_from === effectiveDate) {
        const { error } = await this.client
          .from("flexible_attendance_modes")
          .delete()
          .eq("id", active.id);
        if (error) throw error;
        return null;
      }
      const yesterday = new Date(`${effectiveDate}T12:00:00Z`);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      const validTo = yesterday.toISOString().slice(0, 10);
      const { data, error } = await this.client
        .from("flexible_attendance_modes")
        .update({ valid_to: validTo })
        .eq("id", active.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async listLeaveEvents() {
      try {
        const { data, error } = await this.client
          .from("attendance_leaves")
          .select("*")
          .order("start_date", { ascending: false })
          .limit(2000);
        if (error) throw error;
        const rows = data || [];
        this.cacheOfflineData("leaves", rows);
        return rows;
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
        const cached = this.readOfflineData("leaves");
        if (cached.length) return cached;
        return [];
      }
    }

    async upsertLeaveEvent(payload) {
      const { data, error } = await this.client
        .from("attendance_leaves")
        .upsert(this.clean(payload))
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async cancelLeaveEvent(id, updatedBy = null) {
      const { data, error } = await this.client
        .from("attendance_leaves")
        .update(this.clean({ status: "cancelled", updated_by: updatedBy }))
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async listLeaveAudit() {
      const { data, error } = await this.client
        .from("attendance_leave_audit")
        .select("*")
        .order("changed_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data || [];
    }

    async listAllProfiles() {
      const { data, error } = await this.client
        .from("profiles")
        .select("*")
        .order("full_name", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async listAllSites() {
      const { data, error } = await this.client
        .from("sites")
        .select("*")
        .order("name", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async listAllAssignments() {
      const { data, error } = await this.client
        .from("assignments")
        .select("*")
        .order("valid_from", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async listEventsRange(dateFrom = null, dateTo = null) {
      const pageSize = 1000;
      const rows = [];
      let offset = 0;

      while (true) {
        let query = this.client
          .from("attendance_events")
          .select("*")
          .order("created_at", { ascending: false });

        if (dateFrom) query = query.gte("shift_date", dateFrom);
        if (dateTo) query = query.lte("shift_date", dateTo);
        query = query.range(offset, offset + pageSize - 1);

        const { data, error } = await query;
        if (error) throw error;
        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      return rows;
    }

    async createEvent(payload) {
      const cleanPayload = this.clean(payload || {});
      if (!cleanPayload.id) cleanPayload.id = (window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      try {
        const { data, error } = await this.client
          .from("attendance_events")
          .insert(cleanPayload)
          .select("*")
          .single();

        if (error) throw error;
        const cached = this.readOfflineData("events");
        this.cacheOfflineData("events", [data, ...cached.filter(item => item?.id !== data?.id)].slice(0, 1500));
        return data;
      } catch (error) {
        if (!this.isNetworkError(error)) throw error;
        return this.queueOfflineEvent({
          ...cleanPayload,
          notes: [cleanPayload.notes, "Registro realizado sin conexión."].filter(Boolean).join(" · ")
        });
      }
    }

    async updateEventsByShift(shiftId, patch) {
      const cleanPatch = this.clean(patch || {});
      if (!shiftId) throw new Error("Falta identificar el turno.");
      if (!Object.keys(cleanPatch).length) throw new Error("No hay cambios para aplicar.");
      const { data, error } = await this.client
        .from("attendance_events")
        .update(cleanPatch)
        .eq("shift_id", shiftId)
        .select("*");
      if (error) throw error;
      return data || [];
    }

    async updateAttendanceEvent(eventId, patch) {
      if (!eventId) throw new Error("Falta identificar el registro de asistencia.");
      const cleanPatch = this.clean(patch || {});
      if (!Object.keys(cleanPatch).length) throw new Error("No hay cambios para aplicar.");
      const { data, error } = await this.client
        .from("attendance_events")
        .update(cleanPatch)
        .eq("id", eventId)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async listOvertimeAuthorizations(dateFrom = null, dateTo = null) {
      try {
        let query = this.client
          .from("overtime_authorizations")
          .select("*")
          .order("authorized_until", { ascending: false });
        if (dateFrom) query = query.gte("shift_date", dateFrom);
        if (dateTo) query = query.lte("shift_date", dateTo);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      } catch (error) {
        const code = String(error?.code || "");
        const message = String(error?.message || "").toLowerCase();
        if (code === "42P01" || message.includes("overtime_authorizations")) {
          console.warn("Todavía no está instalada la migración de horas extra autorizadas.");
          return [];
        }
        throw error;
      }
    }

    async listOvertimeRequests(dateFrom = null, dateTo = null) {
      try {
        let query = this.client
          .from("overtime_requests")
          .select("*")
          .order("requested_at", { ascending: false });
        if (dateFrom) query = query.gte("shift_date", dateFrom);
        if (dateTo) query = query.lte("shift_date", dateTo);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      } catch (error) {
        const code = String(error?.code || "");
        const message = String(error?.message || "").toLowerCase();
        if (code === "42P01" || message.includes("overtime_requests")) {
          console.warn("Todavía no está instalada la migración de solicitudes de horas extra.");
          return [];
        }
        throw error;
      }
    }

    async requestOvertime(shiftId, requestedUntilIso, reason = "") {
      const { data, error } = await this.client.rpc("request_overtime_extension", {
        p_shift_id: shiftId,
        p_requested_until: requestedUntilIso,
        p_reason: reason || null
      });
      if (error) throw error;
      return data;
    }

    async approveOvertimeRequest(shiftId, authorizedUntilIso, notes = "") {
      const { data, error } = await this.client.rpc("approve_overtime_request", {
        p_shift_id: shiftId,
        p_authorized_until: authorizedUntilIso,
        p_notes: notes || null
      });
      if (error) throw error;
      return data;
    }

    async rejectOvertimeRequest(shiftId, notes = "") {
      const { data, error } = await this.client.rpc("reject_overtime_request", {
        p_shift_id: shiftId,
        p_notes: notes || null
      });
      if (error) throw error;
      return data;
    }

    async setOvertimeAuthorization(shiftId, authorizedUntilIso, notes = "") {
      const { data, error } = await this.client.rpc("set_overtime_authorization", {
        p_shift_id: shiftId,
        p_authorized_until: authorizedUntilIso,
        p_notes: notes || null
      });
      if (error) throw error;
      return data;
    }

    async revokeOvertimeAuthorization(shiftId) {
      const { data, error } = await this.client.rpc("revoke_overtime_authorization", { p_shift_id: shiftId });
      if (error) throw error;
      return data;
    }

    readOfflineErrorQueue() {
      const rows = this.readJson(this.OFFLINE_ERROR_QUEUE_KEY, []);
      return Array.isArray(rows) ? rows : [];
    }

    writeOfflineErrorQueue(rows) {
      this.writeJson(this.OFFLINE_ERROR_QUEUE_KEY, Array.isArray(rows) ? rows : []);
    }

    queueOfflineErrorLog(payload) {
      const cleanPayload = this.clean(payload || {});
      if (!cleanPayload.id) {
        cleanPayload.id = window.crypto?.randomUUID?.() || `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;
      }
      const queue = this.readOfflineErrorQueue();
      if (!queue.some(item => item?.id === cleanPayload.id)) queue.push(cleanPayload);
      this.writeOfflineErrorQueue(queue.slice(-500));
      return { ...cleanPayload, __offline_pending: true };
    }

    async createAppErrorLog(payload) {
      const cleanPayload = this.clean(payload || {});
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return this.queueOfflineErrorLog(cleanPayload);
      }
      try {
        const { error } = await this.client.from("app_error_logs").insert(cleanPayload);
        if (error) {
          if (this.isNetworkError(error)) return this.queueOfflineErrorLog(cleanPayload);
          throw error;
        }
        return cleanPayload;
      } catch (error) {
        if (this.isNetworkError(error)) return this.queueOfflineErrorLog(cleanPayload);
        throw error;
      }
    }

    async flushOfflineErrorQueue() {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return { synced: 0, pending: this.readOfflineErrorQueue().length };
      const queue = this.readOfflineErrorQueue();
      if (!queue.length) return { synced: 0, pending: 0 };
      let sessionUserId = null;
      try {
        const { data } = await this.client.auth.getSession();
        sessionUserId = data?.session?.user?.id || null;
      } catch (_) { /* noop */ }
      if (!sessionUserId) return { synced: 0, pending: queue.length };

      let synced = 0;
      const remaining = [];
      for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item?.operator_id && item.operator_id !== sessionUserId) {
          remaining.push(item);
          continue;
        }
        try {
          const { error } = await this.client.from("app_error_logs").insert(this.clean(item));
          if (error) {
            if (String(error.code || "") === "23505") { synced++; continue; }
            remaining.push(item);
            if (this.isNetworkError(error)) {
              remaining.push(...queue.slice(i + 1));
              break;
            }
            continue;
          }
          synced++;
        } catch (error) {
          remaining.push(item);
          if (this.isNetworkError(error)) {
            remaining.push(...queue.slice(i + 1));
            break;
          }
        }
      }
      this.writeOfflineErrorQueue(remaining);
      return { synced, pending: remaining.length };
    }

    async listAppErrorLogs(dateFrom = null, dateTo = null, status = "all") {
      let query = this.client
        .from("app_error_logs")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(1500);
      if (dateFrom) query = query.gte("occurred_at", new Date(`${dateFrom}T00:00:00-03:00`).toISOString());
      if (dateTo) query = query.lte("occurred_at", new Date(`${dateTo}T23:59:59.999-03:00`).toISOString());
      if (status && status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async reviewAppErrorLog(id, note = "") {
      const { data: sessionData } = await this.client.auth.getSession();
      const reviewerId = sessionData?.session?.user?.id || null;
      const { data, error } = await this.client
        .from("app_error_logs")
        .update({
          status: "reviewed",
          reviewed_at: new Date().toISOString(),
          reviewed_by: reviewerId,
          review_note: note || null
        })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async reopenAppErrorLog(id) {
      const { data, error } = await this.client
        .from("app_error_logs")
        .update({ status: "new", reviewed_at: null, reviewed_by: null, review_note: null })
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }

    async runAutomaticCheckouts() {
      try {
        const { data, error } = await this.client.rpc("auto_close_overdue_shifts");
        if (error) throw error;
        return Number(data || 0);
      } catch (error) {
        // Si todavía no se ejecutó la migración o no hay conexión, el fichaje normal sigue funcionando.
        console.warn("No se pudo ejecutar el cierre automático de salidas", error);
        return 0;
      }
    }

    async markShiftDayOff(payload) {
      const params = {
        p_shift_id: payload.shift_id,
        p_assignment_id: payload.assignment_id || null,
        p_shift_date: payload.shift_date,
        p_operator_id: payload.operator_id,
        p_site_id: payload.site_id,
        p_work_type: payload.work_type || "regular",
        p_notes: payload.notes || null
      };
      const { data, error } = await this.client.rpc("mark_shift_day_off", params);
      if (error) throw error;
      return data;
    }

    async clearShiftDayOff(shiftId) {
      const { data, error } = await this.client.rpc("clear_shift_day_off", { p_shift_id: shiftId });
      if (error) throw error;
      return Number(data || 0);
    }

    async deleteAttendanceEvents(ids, confirmation) {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      if (!uniqueIds.length) return 0;
      let deleted = 0;
      const chunkSize = 250;
      for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const chunk = uniqueIds.slice(i, i + chunkSize);
        const { data, error } = await this.client.rpc("secure_delete_attendance_events", {
          p_ids: chunk,
          p_confirmation: confirmation
        });
        if (error) throw error;
        deleted += Number(data || 0);
      }
      return deleted;
    }

    async upsertSite(payload) {
      const { data, error } = await this.client
        .from("sites")
        .upsert(this.clean(payload))
        .select("*")
        .single();

      if (error) throw error;
      return data;
    }

    async bulkUpdateSites(ids, patch) {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      if (!uniqueIds.length) return 0;
      const cleanPatch = this.clean(patch || {});
      if (!Object.keys(cleanPatch).length) throw new Error("No hay cambios para aplicar a los servicios.");

      const chunkSize = 150;
      for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const chunk = uniqueIds.slice(i, i + chunkSize);
        const { error } = await this.client
          .from("sites")
          .update(cleanPatch)
          .in("id", chunk)
          .eq("is_active", true);
        if (error) throw error;
      }
      return uniqueIds.length;
    }

    async deleteSite(id) {
      const { error: siteError } = await this.client
        .from("sites")
        .update({ is_active: false })
        .eq("id", id);
      if (siteError) throw siteError;

      const { error: assignmentError } = await this.client
        .from("assignments")
        .update({ is_active: false })
        .eq("site_id", id);
      if (assignmentError) throw assignmentError;
    }

    async upsertAssignment(payload) {
      const { data, error } = await this.client
        .from("assignments")
        .upsert(this.clean(payload))
        .select("*")
        .single();

      if (error) throw error;
      return data;
    }

    async bulkUpdateAssignments(ids, patch) {
      const uniqueIds = [...new Set((ids || []).filter(Boolean))];
      if (!uniqueIds.length) return 0;
      const cleanPatch = this.clean(patch || {});
      if (!Object.keys(cleanPatch).length) throw new Error("No hay cambios para aplicar a las asignaciones.");

      const chunkSize = 150;
      for (let i = 0; i < uniqueIds.length; i += chunkSize) {
        const chunk = uniqueIds.slice(i, i + chunkSize);
        const { error } = await this.client
          .from("assignments")
          .update(cleanPatch)
          .in("id", chunk)
          .eq("is_active", true);
        if (error) throw error;
      }
      return uniqueIds.length;
    }

    async applyAssignmentSync(payload = {}) {
      const updates = Array.isArray(payload.updates) ? payload.updates : [];
      const inserts = Array.isArray(payload.inserts) ? payload.inserts : [];

      // Las actualizaciones tienen patches distintos, por eso se ejecutan por lotes chicos.
      const updateChunkSize = 20;
      for (let i = 0; i < updates.length; i += updateChunkSize) {
        const chunk = updates.slice(i, i + updateChunkSize);
        const results = await Promise.all(chunk.map(async item => {
          if (!item?.id) throw new Error("Falta identificar una asignación a actualizar.");
          const patch = this.clean(item.patch || {});
          if (!Object.keys(patch).length) return true;
          const { error } = await this.client
            .from("assignments")
            .update(patch)
            .eq("id", item.id);
          if (error) throw error;
          return true;
        }));
        if (results.some(result => result !== true)) throw new Error("No se pudo completar la actualización de asignaciones.");
      }

      const insertChunkSize = 100;
      for (let i = 0; i < inserts.length; i += insertChunkSize) {
        const chunk = inserts.slice(i, i + insertChunkSize).map(item => this.clean(item));
        if (!chunk.length) continue;
        const { error } = await this.client
          .from("assignments")
          .insert(chunk);
        if (error) throw error;
      }

      return { updated: updates.length, inserted: inserts.length };
    }

    async deleteAssignment(id) {
      const { error } = await this.client
        .from("assignments")
        .update({ is_active: false })
        .eq("id", id);

      if (error) throw error;
    }

    async upsertProfile(payload) {
      const cleanPayload = this.clean(payload);
      if (!cleanPayload.id) throw new Error("Falta el UUID del usuario de Supabase Auth.");

      const { data, error } = await this.client
        .from("profiles")
        .upsert(cleanPayload)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    }

    async deleteProfile(id) {
      const { error: profileError } = await this.client
        .from("profiles")
        .update({ is_active: false })
        .eq("id", id);
      if (profileError) throw profileError;

      const { error: assignmentError } = await this.client
        .from("assignments")
        .update({ is_active: false })
        .eq("operator_id", id);
      if (assignmentError) throw assignmentError;
    }

    async functionErrorMessage(error, fallback) {
      // supabase-js pone el JSON de error de la función en error.context (Response),
      // no en error.message — hay que leerlo aparte para mostrar algo útil.
      try {
        const body = await error?.context?.json?.();
        if (body?.error) return body.error;
      } catch (_) { /* noop */ }
      return error?.message || fallback;
    }

    async createManagedUser(payload) {
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "create", ...payload }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo crear el usuario."));
      if (data?.error) throw new Error(data.error);
      return data.profile;
    }

    async updateManagedUser(profileId, payload) {
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "update", profile_id: profileId, ...payload }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo actualizar el usuario."));
      if (data?.error) throw new Error(data.error);
      return data.profile;
    }

    async approveRecoveryEmail(profileId) {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "approve_recovery_email", profile_id: profileId, redirect_to: redirectTo }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo aprobar el email de recuperación."));
      if (data?.error) throw new Error(data.error);
      return data;
    }

    async rejectRecoveryEmail(profileId) {
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "reject_recovery_email", profile_id: profileId }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo rechazar el email de recuperación."));
      if (data?.error) throw new Error(data.error);
      return data;
    }

    async setManagedUserPassword(profileId, password) {
      const { data, error } = await this.client.functions.invoke("user-auth", {
        body: { action: "set_password", profile_id: profileId, password }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo cambiar la contraseña."));
      if (data?.error) throw new Error(data.error);
      return true;
    }

    // Compatibilidad con código antiguo.
    async createOperator({ username, dni, full_name, phone, email }) {
      return this.createManagedUser({ username, email, password: dni, full_name, phone, role: "operator" });
    }

    async resetOperatorPassword(profileId, password) {
      return this.setManagedUserPassword(profileId, password);
    }
  }

  window.StoreFactory = {
    create() {
      return new SupabaseStore();
    },
    hasSupabaseConfig,
    materializeShifts,
    isoDay
  };
})();
