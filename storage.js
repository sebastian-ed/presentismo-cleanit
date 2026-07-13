(function () {
  const CONFIG = window.APP_CONFIG || {};

  const localDateISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const todayISO = () => localDateISO(new Date());

  function addDaysISO(dateString, days) {
    const d = new Date(`${dateString}T00:00:00`);
    d.setDate(d.getDate() + days);
    return localDateISO(d);
  }

  function isOvernightAssignment(assignment) {
    return String(assignment?.scheduled_end || "").slice(0, 5) < String(assignment?.scheduled_start || "").slice(0, 5);
  }

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
      is_active: assignment.is_active !== false
    };
  }

  function materializeShifts(assignments, dateString) {
    return assignments
      .filter(a => isAssignmentActiveForDate(a, dateString))
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
      const targetDate = date || todayISO();
      const previousDate = addDaysISO(targetDate, -1);
      const previousOvernight = assignments
        .filter(assignment => isAssignmentActiveForDate(assignment, previousDate) && isOvernightAssignment(assignment))
        .map(assignment => materializeShift(assignment, previousDate));
      const current = materializeShifts(assignments, targetDate);
      return [...previousOvernight, ...current]
        .sort((a, b) => `${a.shift_date} ${a.scheduled_start} ${a.site_id}`.localeCompare(`${b.shift_date} ${b.scheduled_start} ${b.site_id}`));
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

    async createEvent(payload) {
      const { data, error } = await this.client
        .from("attendance_events")
        .insert(this.clean(payload))
        .select("*")
        .single();

      if (error) throw error;
      return data;
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

    async createOperator({ username, dni, full_name, phone }) {
      const { data, error } = await this.client.functions.invoke("create-operator", {
        body: { action: "create", username, dni, full_name, phone }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo crear el usuario."));
      if (data?.error) throw new Error(data.error);
      return data.profile;
    }

    async resetOperatorPassword(profileId, dni) {
      const { data, error } = await this.client.functions.invoke("create-operator", {
        body: { action: "reset_password", profile_id: profileId, dni }
      });
      if (error) throw new Error(await this.functionErrorMessage(error, "No se pudo restablecer la contraseña."));
      if (data?.error) throw new Error(data.error);
      return true;
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
