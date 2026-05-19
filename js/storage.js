(function () {
  const CONFIG = window.APP_CONFIG || {};
  const LS_KEY = "cleanit_presentismo_state_v2";

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uuid = () => {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  function isoDay(dateString) {
    const d = new Date(`${dateString}T00:00:00`);
    const day = d.getDay();
    return day === 0 ? 7 : day;
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

  function seedState() {
    const today = todayISO();
    return {
      profiles: [
        { id: "sup-1", full_name: "Supervisor Clean It", role: "supervisor", phone: "+5491100000000", pin: "9999", notes: "Usuario demo supervisor", is_active: true },
        { id: "op-1", full_name: "Chaves Rosana", role: "operator", phone: "+5491111111111", pin: "1001", notes: "Demo", is_active: true },
        { id: "op-2", full_name: "Toledo Camilo", role: "operator", phone: "+5491122222222", pin: "1002", notes: "Demo", is_active: true },
        { id: "op-3", full_name: "La Capria Paola", role: "operator", phone: "+5491133333333", pin: "1003", notes: "Demo", is_active: true },
        { id: "op-4", full_name: "Zerpa Sabrina", role: "operator", phone: "+5491144444444", pin: "1004", notes: "Demo", is_active: true },
        { id: "op-5", full_name: "Camila Zalazar", role: "operator", phone: "+5491155555555", pin: "1005", notes: "Demo", is_active: true }
      ],
      sites: [
        {
          id: "site-1",
          name: "Alvarez Thomas 550 - Colegiales",
          address: "Alvarez Thomas 550, CABA",
          zone: "Colegiales",
          supervisor_name: "Sup. José",
          service_type: "fixed",
          lat: -34.57525,
          lng: -58.44878,
          gps_radius_m: 150,
          whatsapp_name: "Administración Alvarez Thomas",
          whatsapp_phone: "+5491133333333",
          is_active: true
        },
        {
          id: "site-2",
          name: "America Tampas - P. Industrial Pilar",
          address: "Parque industrial, C. 9 1761, B1629 Pilar",
          zone: "Pilar",
          supervisor_name: "Sup. José",
          service_type: "fixed",
          lat: -34.45715,
          lng: -58.88288,
          gps_radius_m: 220,
          whatsapp_name: "Administración America Tampas",
          whatsapp_phone: "+5491144444444",
          is_active: true
        },
        {
          id: "site-3",
          name: "Cons. Agrelo 3641 - Boedo",
          address: "Agrelo 3641, CABA",
          zone: "Boedo",
          supervisor_name: "Sup. José",
          service_type: "fixed",
          lat: -34.62395,
          lng: -58.41605,
          gps_radius_m: 120,
          whatsapp_name: "Administración Agrelo",
          whatsapp_phone: "+5491155555555",
          is_active: true
        },
        {
          id: "site-4",
          name: "Cons Cabildo 2659",
          address: "Cabildo 2659, CABA",
          zone: "Belgrano",
          supervisor_name: "Sup. José",
          service_type: "fixed",
          lat: -34.55785,
          lng: -58.46391,
          gps_radius_m: 120,
          whatsapp_name: "Administración Cabildo",
          whatsapp_phone: "+5491166666666",
          is_active: true
        }
      ],
      assignments: [
        {
          id: "asg-1",
          operator_id: "op-1",
          site_id: "site-1",
          days_of_week: [1, 2, 3, 4, 5],
          scheduled_start: "13:00",
          scheduled_end: "17:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Cobertura semanal fija",
          is_active: true
        },
        {
          id: "asg-2",
          operator_id: "op-1",
          site_id: "site-1",
          days_of_week: [6],
          scheduled_start: "08:00",
          scheduled_end: "12:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Sábado mañana",
          is_active: true
        },
        {
          id: "asg-3",
          operator_id: "op-4",
          site_id: "site-1",
          days_of_week: [6],
          scheduled_start: "08:00",
          scheduled_end: "12:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Refuerzo sábado",
          is_active: true
        },
        {
          id: "asg-4",
          operator_id: "op-2",
          site_id: "site-2",
          days_of_week: [1, 2, 3, 4, 5],
          scheduled_start: "08:00",
          scheduled_end: "16:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Cobertura semanal fija",
          is_active: true
        },
        {
          id: "asg-5",
          operator_id: "op-2",
          site_id: "site-2",
          days_of_week: [6],
          scheduled_start: "08:00",
          scheduled_end: "12:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Sábado reducido",
          is_active: true
        },
        {
          id: "asg-6",
          operator_id: "op-3",
          site_id: "site-3",
          days_of_week: [1, 3, 5],
          scheduled_start: "11:30",
          scheduled_end: "13:30",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Lunes, miércoles y viernes",
          is_active: true
        },
        {
          id: "asg-7",
          operator_id: "op-5",
          site_id: "site-4",
          days_of_week: [1, 2, 3, 4, 5],
          scheduled_start: "12:00",
          scheduled_end: "15:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          valid_from: today,
          valid_to: null,
          notes: "Cobertura semanal fija",
          is_active: true
        }
      ],
      attendance_events: []
    };
  }

  function normalizeState(rawState) {
    const seeded = seedState();
    const state = { ...seeded, ...rawState };
    state.profiles = Array.isArray(state.profiles) ? state.profiles : seeded.profiles;
    state.sites = Array.isArray(state.sites) ? state.sites : seeded.sites;
    state.assignments = Array.isArray(state.assignments) ? state.assignments : [];
    state.attendance_events = Array.isArray(state.attendance_events) ? state.attendance_events : [];

    // Migración mínima desde la versión vieja que tenía turnos por fecha.
    if (!state.assignments.length && Array.isArray(rawState?.shifts) && rawState.shifts.length) {
      state.assignments = rawState.shifts.map(shift => ({
        id: shift.id || uuid(),
        operator_id: shift.operator_id,
        site_id: shift.site_id,
        days_of_week: [isoDay(shift.shift_date || todayISO())],
        scheduled_start: shift.scheduled_start,
        scheduled_end: shift.scheduled_end,
        grace_minutes: shift.grace_minutes ?? 10,
        absence_after_minutes: shift.absence_after_minutes ?? 30,
        valid_from: shift.shift_date || todayISO(),
        valid_to: shift.shift_date || todayISO(),
        notes: "Migrado desde turno puntual",
        is_active: shift.is_active !== false
      }));
    }

    if (!state.assignments.length) state.assignments = seeded.assignments;
    return state;
  }

  function loadLocalState() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const seeded = seedState();
      localStorage.setItem(LS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    try {
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("Estado local inválido. Se reinicia demo.", error);
      const seeded = seedState();
      localStorage.setItem(LS_KEY, JSON.stringify(seeded));
      return seeded;
    }
  }

  function saveLocalState(state) {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }

  function hasSupabaseConfig() {
    return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase);
  }

  class LocalStore {
    constructor() {
      this.mode = "local";
      this.state = loadLocalState();
    }

    persist() { saveLocalState(this.state); }

    async loginWithPin(pin, desiredRole) {
      const profile = this.state.profiles.find(p => String(p.pin || "") === String(pin) && p.role === desiredRole && p.is_active !== false);
      if (!profile) throw new Error("PIN incorrecto o perfil inactivo.");
      return { user: profile, profile };
    }

    async signOut() { return true; }

    async listProfiles(role) {
      return this.state.profiles
        .filter(p => p.is_active !== false && (!role || p.role === role))
        .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
    }

    async listSites() {
      return this.state.sites
        .filter(s => s.is_active !== false)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    async listAssignments() {
      return this.state.assignments
        .filter(a => a.is_active !== false)
        .sort((a, b) => `${a.site_id} ${a.scheduled_start}`.localeCompare(`${b.site_id} ${b.scheduled_start}`));
    }

    async listShifts(date) {
      const assignments = await this.listAssignments();
      return materializeShifts(assignments, date || todayISO());
    }

    async listEvents() {
      return [...this.state.attendance_events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    async createEvent(payload) {
      const event = { id: uuid(), created_at: new Date().toISOString(), ...payload };
      this.state.attendance_events.push(event);
      this.persist();
      return event;
    }

    async upsertSite(payload) {
      if (payload.id) {
        const index = this.state.sites.findIndex(s => s.id === payload.id);
        if (index >= 0) this.state.sites[index] = { ...this.state.sites[index], ...payload };
        this.persist();
        return this.state.sites[index];
      }
      const site = { id: uuid(), is_active: true, ...payload };
      this.state.sites.push(site);
      this.persist();
      return site;
    }

    async deleteSite(id) {
      const site = this.state.sites.find(s => s.id === id);
      if (site) site.is_active = false;
      this.state.assignments.forEach(a => { if (a.site_id === id) a.is_active = false; });
      this.persist();
    }

    async upsertAssignment(payload) {
      if (payload.id) {
        const index = this.state.assignments.findIndex(s => s.id === payload.id);
        if (index >= 0) this.state.assignments[index] = { ...this.state.assignments[index], ...payload };
        this.persist();
        return this.state.assignments[index];
      }
      const assignment = { id: uuid(), is_active: true, ...payload };
      this.state.assignments.push(assignment);
      this.persist();
      return assignment;
    }

    async deleteAssignment(id) {
      const assignment = this.state.assignments.find(a => a.id === id);
      if (assignment) assignment.is_active = false;
      this.persist();
    }

    async upsertProfile(payload) {
      if (payload.id) {
        const index = this.state.profiles.findIndex(p => p.id === payload.id);
        if (index >= 0) this.state.profiles[index] = { ...this.state.profiles[index], ...payload };
        this.persist();
        return this.state.profiles[index];
      }
      const profile = { id: uuid(), role: "operator", is_active: true, ...payload };
      this.state.profiles.push(profile);
      this.persist();
      return profile;
    }

    async deleteProfile(id) {
      const profile = this.state.profiles.find(p => p.id === id);
      if (profile) profile.is_active = false;
      this.state.assignments.forEach(a => { if (a.operator_id === id) a.is_active = false; });
      this.persist();
    }
  }

  class SupabaseStore {
    constructor() {
      this.mode = "supabase";
      this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }

    clean(payload) {
      const copy = { ...payload };
      Object.keys(copy).forEach(key => {
        if (copy[key] === "") copy[key] = null;
        if (copy[key] === undefined) delete copy[key];
      });
      return copy;
    }

    async loginWithPin(pin, desiredRole) {
      const { data, error } = await this.client
        .from("profiles")
        .select("*")
        .eq("pin", String(pin))
        .eq("role", desiredRole)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("PIN incorrecto o perfil inactivo.");
      return { user: data, profile: data };
    }

    async signOut() { return true; }

    async listProfiles(role) {
      let query = this.client.from("profiles").select("*").eq("is_active", true).order("full_name");
      if (role) query = query.eq("role", role);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async listSites() {
      const { data, error } = await this.client.from("sites").select("*").eq("is_active", true).order("name");
      if (error) throw error;
      return data || [];
    }

    async listAssignments() {
      const { data, error } = await this.client.from("assignments").select("*").eq("is_active", true).order("scheduled_start");
      if (error) throw error;
      return data || [];
    }

    async listShifts(date) {
      const assignments = await this.listAssignments();
      return materializeShifts(assignments, date || todayISO());
    }

    async listEvents() {
      const { data, error } = await this.client.from("attendance_events").select("*").order("created_at", { ascending: false }).limit(1000);
      if (error) throw error;
      return data || [];
    }

    async createEvent(payload) {
      const { data, error } = await this.client.from("attendance_events").insert(this.clean(payload)).select("*").single();
      if (error) throw error;
      return data;
    }

    async upsertSite(payload) {
      const { data, error } = await this.client.from("sites").upsert(this.clean(payload)).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteSite(id) {
      const { error: siteError } = await this.client.from("sites").update({ is_active: false }).eq("id", id);
      if (siteError) throw siteError;
      const { error: assignmentError } = await this.client.from("assignments").update({ is_active: false }).eq("site_id", id);
      if (assignmentError) throw assignmentError;
    }

    async upsertAssignment(payload) {
      const { data, error } = await this.client.from("assignments").upsert(this.clean(payload)).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteAssignment(id) {
      const { error } = await this.client.from("assignments").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    }

    async upsertProfile(payload) {
      const { data, error } = await this.client.from("profiles").upsert(this.clean(payload)).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteProfile(id) {
      const { error: profileError } = await this.client.from("profiles").update({ is_active: false }).eq("id", id);
      if (profileError) throw profileError;
      const { error: assignmentError } = await this.client.from("assignments").update({ is_active: false }).eq("operator_id", id);
      if (assignmentError) throw assignmentError;
    }
  }

  window.StoreFactory = {
    create() {
      return hasSupabaseConfig() ? new SupabaseStore() : new LocalStore();
    },
    hasSupabaseConfig,
    materializeShifts,
    isoDay
  };
})();
