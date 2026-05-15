(function () {
  const CONFIG = window.APP_CONFIG || {};
  const LS_KEY = "cleanit_presentismo_state_v1";

  const todayISO = () => new Date().toISOString().slice(0, 10);
  const uuid = () => {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  };

  function seedState() {
    const today = todayISO();
    return {
      profiles: [
        { id: "sup-1", full_name: "Supervisor Clean It", role: "supervisor", phone: "+5491100000000", pin: "9999", is_active: true },
        { id: "op-1", full_name: "Gerardo Leal", role: "operator", phone: "+5491111111111", pin: "1001", is_active: true },
        { id: "op-2", full_name: "María López", role: "operator", phone: "+5491122222222", pin: "1002", is_active: true }
      ],
      sites: [
        {
          id: "site-1",
          name: "Consorcio Demo Palermo",
          address: "Av. Santa Fe 3250, CABA",
          lat: -34.5889,
          lng: -58.4103,
          gps_radius_m: 150,
          whatsapp_name: "Administración Palermo",
          whatsapp_phone: "+5491133333333",
          is_active: true
        },
        {
          id: "site-2",
          name: "Consorcio Demo Belgrano",
          address: "Av. Cabildo 1800, CABA",
          lat: -34.5621,
          lng: -58.4566,
          gps_radius_m: 150,
          whatsapp_name: "Administración Belgrano",
          whatsapp_phone: "+5491144444444",
          is_active: true
        }
      ],
      shifts: [
        {
          id: "shift-1",
          shift_date: today,
          operator_id: "op-1",
          site_id: "site-1",
          scheduled_start: "08:00",
          scheduled_end: "12:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          is_active: true
        },
        {
          id: "shift-2",
          shift_date: today,
          operator_id: "op-2",
          site_id: "site-2",
          scheduled_start: "09:00",
          scheduled_end: "13:00",
          grace_minutes: 10,
          absence_after_minutes: 30,
          is_active: true
        }
      ],
      attendance_events: []
    };
  }

  function loadLocalState() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const seeded = seedState();
      localStorage.setItem(LS_KEY, JSON.stringify(seeded));
      return seeded;
    }
    try {
      const parsed = JSON.parse(raw);
      return { ...seedState(), ...parsed };
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
      const profile = this.state.profiles.find(p => p.pin === pin && p.role === desiredRole && p.is_active !== false);
      if (!profile) throw new Error("PIN incorrecto o perfil inactivo.");
      return { user: profile, profile };
    }

    async signOut() { return true; }

    async listProfiles(role) {
      return this.state.profiles.filter(p => p.is_active !== false && (!role || p.role === role));
    }

    async listSites() {
      return this.state.sites.filter(s => s.is_active !== false);
    }

    async listShifts(date) {
      return this.state.shifts.filter(s => s.is_active !== false && (!date || s.shift_date === date));
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
      this.persist();
    }

    async upsertShift(payload) {
      if (payload.id) {
        const index = this.state.shifts.findIndex(s => s.id === payload.id);
        if (index >= 0) this.state.shifts[index] = { ...this.state.shifts[index], ...payload };
        this.persist();
        return this.state.shifts[index];
      }
      const shift = { id: uuid(), is_active: true, ...payload };
      this.state.shifts.push(shift);
      this.persist();
      return shift;
    }

    async deleteShift(id) {
      const shift = this.state.shifts.find(s => s.id === id);
      if (shift) shift.is_active = false;
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
      this.persist();
    }
  }

  class SupabaseStore {
    constructor() {
      this.mode = "supabase";
      this.client = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
      this.session = null;
      this.profile = null;
    }

    async loginWithEmail(email, password, desiredRole) {
      const { data, error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const profile = await this.getProfile(data.user.id);
      if (!profile || profile.role !== desiredRole) throw new Error("El usuario no tiene permisos para esta vista.");
      this.session = data.session;
      this.profile = profile;
      return { user: data.user, profile };
    }

    async getProfile(userId) {
      const { data, error } = await this.client.from("profiles").select("*").eq("id", userId).single();
      if (error) throw error;
      return data;
    }

    async signOut() {
      await this.client.auth.signOut();
    }

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

    async listShifts(date) {
      let query = this.client.from("shifts").select("*").eq("is_active", true).order("scheduled_start");
      if (date) query = query.eq("shift_date", date);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    }

    async listEvents() {
      const { data, error } = await this.client.from("attendance_events").select("*").order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return data || [];
    }

    async createEvent(payload) {
      const { data, error } = await this.client.from("attendance_events").insert(payload).select("*").single();
      if (error) throw error;
      return data;
    }

    async upsertSite(payload) {
      const { data, error } = await this.client.from("sites").upsert(payload).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteSite(id) {
      const { error } = await this.client.from("sites").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    }

    async upsertShift(payload) {
      const { data, error } = await this.client.from("shifts").upsert(payload).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteShift(id) {
      const { error } = await this.client.from("shifts").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    }

    async upsertProfile(payload) {
      const { data, error } = await this.client.from("profiles").upsert(payload).select("*").single();
      if (error) throw error;
      return data;
    }

    async deleteProfile(id) {
      const { error } = await this.client.from("profiles").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    }
  }

  window.StoreFactory = {
    create() {
      return hasSupabaseConfig() ? new SupabaseStore() : new LocalStore();
    },
    hasSupabaseConfig
  };
})();
