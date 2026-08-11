(function () {
  const CONFIG = window.APP_CONFIG || {};

  const todayISO = () => new Date().toISOString().slice(0, 10);

  function isoDay(dateString) {
    const d = new Date(`${dateString}T00:00:00`);
    const day = d.getDay();
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
      return !suppressors.some(extra => extra.operator_id === a.operator_id && assignmentTimesOverlap(extra, a));
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
      const { data, error } = await this.client.auth.getSession();
      if (error) throw error;
      const user = data?.session?.user;
      if (!user) return null;
      const profile = await this.loadProfileForAuthUser(user);
      return { user, profile };
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

      return data;
    }

    async signOut() {
      await this.client.auth.signOut();
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
      const { data, error } = await this.client
        .from("sites")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async listAssignments() {
      const { data, error } = await this.client
        .from("assignments")
        .select("*")
        .eq("is_active", true)
        .order("scheduled_start", { ascending: true });

      if (error) throw error;
      return data || [];
    }

    async listShifts(date) {
      const assignments = await this.listAssignments();
      return materializeShifts(assignments, date || todayISO());
    }

    async listEvents() {
      const { data, error } = await this.client
        .from("attendance_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1500);

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
      const { data, error } = await this.client
        .from("attendance_events")
        .insert(this.clean(payload))
        .select("*")
        .single();

      if (error) throw error;
      return data;
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
