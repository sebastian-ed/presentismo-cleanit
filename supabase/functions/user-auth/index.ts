// Clean It · Presentismo GPS
// Edge Function unificada para cuentas con usuario + email de recuperación opcional.
// Acciones públicas: login, forgot_password.
// Acciones de gestión: create, update, set_password, approve_recovery_email, reject_recovery_email.
// IMPORTANTE: desplegar con --no-verify-jwt. Las acciones sensibles validan
// manualmente el JWT del llamante y nunca exponen SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_RESET_REDIRECT = "https://sebastian-ed.github.io/presentismo-cleanit/";

type Role = "operator" | "supervisor" | "admin";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: unknown) {
  return String(raw || "").trim().toLowerCase();
}

function normalizeUsername(raw: unknown) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

function validRole(raw: unknown): raw is Role {
  return ["operator", "supervisor", "admin"].includes(String(raw));
}

function isSyntheticEmail(email: string) {
  return /@cleanit\.ar$/i.test(email);
}

function safeResetRedirect(raw: unknown) {
  const candidate = String(raw || "").trim();
  if (!candidate) return DEFAULT_RESET_REDIRECT;
  try {
    const url = new URL(candidate);
    const allowed = new URL(DEFAULT_RESET_REDIRECT);
    if (url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname)) {
      return url.toString();
    }
  } catch (_) {
    // Usa el valor seguro por defecto.
  }
  return DEFAULT_RESET_REDIRECT;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return response({ error: "Método no permitido." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
    return response({ error: "Faltan variables de entorno de Supabase en la Edge Function." }, 500);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function resolveIdentity(identifierRaw: unknown) {
    const identifier = String(identifierRaw || "").trim();
    if (!identifier) return null;

    if (identifier.includes("@")) {
      const email = normalizeEmail(identifier);
      const { data: profile } = await admin
        .from("profiles")
        .select("id, username, email, role, is_active")
        .eq("email", email)
        .maybeSingle();
      return profile ? { ...profile, email } : null;
    }

    const username = normalizeUsername(identifier);
    if (!username) return null;
    const { data: profile } = await admin
      .from("profiles")
      .select("id, username, email, role, is_active")
      .eq("username", username)
      .maybeSingle();

    if (!profile) return null;
    let email = normalizeEmail(profile.email);
    if (!email) {
      const { data: authData } = await admin.auth.admin.getUserById(profile.id);
      email = normalizeEmail(authData?.user?.email);
    }
    return { ...profile, email };
  }

  async function getCaller() {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return null;

    const callerClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await callerClient.auth.getUser();
    if (authError || !authData?.user) return null;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError || !profile?.is_active || !["supervisor", "admin"].includes(profile.role)) return null;
    return profile as { id: string; role: Role; is_active: boolean };
  }

  function callerCanManage(callerRole: Role, targetRole: Role) {
    if (callerRole === "admin") return true;
    // Supervisores pueden administrar operarios y otros supervisores,
    // pero no pueden crear ni elevar cuentas a administrador.
    return callerRole === "supervisor" && ["operator", "supervisor"].includes(targetRole);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "login") {
      const identity = await resolveIdentity(body?.identifier);
      const password = String(body?.password || "");
      if (!identity?.email || !identity.is_active || !password) {
        return response({ error: "Usuario o contraseña incorrectos." }, 401);
      }

      const { data, error } = await anon.auth.signInWithPassword({
        email: identity.email,
        password,
      });
      if (error || !data?.session || !data?.user) {
        return response({ error: "Usuario o contraseña incorrectos." }, 401);
      }

      return response({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        },
        user: { id: data.user.id, email: data.user.email },
      });
    }

    if (action === "forgot_password") {
      const identity = await resolveIdentity(body?.identifier);
      if (!identity?.email || !identity.is_active) {
        // Respuesta neutra para no facilitar enumeración de usuarios.
        return response({ success: true, sent: false });
      }

      if (isSyntheticEmail(identity.email)) {
        const recoveryEmail = normalizeEmail(body?.recovery_email);
        if (!recoveryEmail) {
          return response({
            success: true,
            sent: false,
            needs_real_email: true,
            message: "Esta cuenta todavía no tiene email de recuperación. Ingresalo en este formulario para solicitar su aprobación.",
          });
        }
        if (!recoveryEmail.includes("@") || isSyntheticEmail(recoveryEmail)) {
          return response({ error: "Ingresá un email de recuperación válido." }, 400);
        }

        const { data: duplicate } = await admin
          .from("profiles")
          .select("id")
          .eq("email", recoveryEmail)
          .neq("id", identity.id)
          .maybeSingle();
        if (duplicate) return response({ error: "Ese email ya está asociado a otro usuario." }, 400);

        const { error: requestError } = await admin
          .from("profiles")
          .update({ pending_recovery_email: recoveryEmail, recovery_requested_at: new Date().toISOString() })
          .eq("id", identity.id);
        if (requestError) return response({ error: requestError.message || "No se pudo registrar la solicitud de recuperación." }, 400);

        return response({
          success: true,
          sent: false,
          pending_approval: true,
          message: "Email informado. Un supervisor o administrador debe aprobarlo. Una vez aprobado, recibirás el enlace para cambiar la contraseña.",
        });
      }

      const redirectTo = safeResetRedirect(body?.redirect_to);
      const { error } = await anon.auth.resetPasswordForEmail(identity.email, { redirectTo });
      if (error) return response({ error: error.message || "No se pudo enviar el email de recuperación." }, 400);
      return response({ success: true, sent: true });
    }

    const caller = await getCaller();
    if (!caller) return response({ error: "No autorizado. Ingresá nuevamente con una cuenta de gestión." }, 401);

    if (action === "create") {
      const username = normalizeUsername(body?.username);
      const requestedEmail = normalizeEmail(body?.email);
      const password = String(body?.password || "");
      const fullName = String(body?.full_name || "").trim();
      const role = String(body?.role || "operator") as Role;
      const phone = String(body?.phone || "").trim() || null;
      const notes = String(body?.notes || "").trim() || null;

      if (!username || username.length < 3) return response({ error: "El nombre de usuario debe tener al menos 3 caracteres." }, 400);
      if (requestedEmail && (!requestedEmail.includes("@") || isSyntheticEmail(requestedEmail))) return response({ error: "Si cargás un email de recuperación, debe ser un correo real válido." }, 400);
      const email = requestedEmail || `${username}@cleanit.ar`;
      if (password.length < 6) return response({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
      if (!fullName) return response({ error: "Cargá nombre y apellido." }, 400);
      if (!validRole(role)) return response({ error: "Rol inválido." }, 400);
      if (!callerCanManage(caller.role, role)) return response({ error: "Tu rol no puede crear este tipo de usuario." }, 403);

      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, username, role },
      });
      if (createError || !created?.user) {
        const msg = createError?.message || "No se pudo crear el usuario.";
        if (/already|exists|registered/i.test(msg)) {
          return response({ error: requestedEmail ? "El email ya está registrado." : "Ese nombre de usuario ya está registrado." }, 400);
        }
        return response({ error: msg }, 400);
      }

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .insert({
          id: created.user.id,
          username,
          email,
          full_name: fullName,
          role,
          phone,
          notes,
          is_active: true,
        })
        .select("*")
        .single();

      if (profileError) {
        await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
        const msg = profileError.message || "No se pudo crear el perfil.";
        return response({ error: /username|unique|duplicate/i.test(msg) ? "Ese nombre de usuario ya está en uso." : msg }, 400);
      }

      return response({ profile });
    }

    if (action === "update") {
      const profileId = String(body?.profile_id || "").trim();
      if (!profileId) return response({ error: "Falta el usuario a editar." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, username, email, full_name, role, phone, notes, is_active, pending_recovery_email, recovery_requested_at")
        .eq("id", profileId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return response({ error: "Usuario no encontrado." }, 404);

      const role = String(body?.role || target.role) as Role;
      if (!validRole(role)) return response({ error: "Rol inválido." }, 400);
      if (!callerCanManage(caller.role, target.role as Role) || !callerCanManage(caller.role, role)) {
        return response({ error: "Tu rol no puede editar este usuario o asignarle ese rol." }, 403);
      }

      const username = normalizeUsername(body?.username || target.username);
      const requestedEmail = normalizeEmail(body?.email);
      const currentEmail = normalizeEmail(target.email);
      const email = requestedEmail || (isSyntheticEmail(currentEmail) ? `${username}@cleanit.ar` : currentEmail);
      const fullName = String(body?.full_name || target.full_name || "").trim();
      const password = String(body?.password || "");
      const phone = String(body?.phone ?? target.phone ?? "").trim() || null;
      const notes = String(body?.notes ?? target.notes ?? "").trim() || null;

      if (!username || username.length < 3) return response({ error: "El nombre de usuario debe tener al menos 3 caracteres." }, 400);
      if (requestedEmail && (!requestedEmail.includes("@") || isSyntheticEmail(requestedEmail))) return response({ error: "Si cargás un email de recuperación, debe ser un correo real válido." }, 400);
      if (!fullName) return response({ error: "Cargá nombre y apellido." }, 400);
      if (password && password.length < 6) return response({ error: "La nueva contraseña debe tener al menos 6 caracteres." }, 400);

      const authUpdate: Record<string, unknown> = {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, username, role },
      };
      if (password) authUpdate.password = password;

      const { error: authUpdateError } = await admin.auth.admin.updateUserById(profileId, authUpdate);
      if (authUpdateError) return response({ error: authUpdateError.message }, 400);

      const { data: profile, error: profileUpdateError } = await admin
        .from("profiles")
        .update({
          username,
          email,
          full_name: fullName,
          role,
          phone,
          notes,
          is_active: true,
          ...(requestedEmail ? { pending_recovery_email: null, recovery_requested_at: null } : {}),
        })
        .eq("id", profileId)
        .select("*")
        .single();
      if (profileUpdateError) {
        return response({ error: profileUpdateError.message || "No se pudo actualizar el perfil." }, 400);
      }

      return response({ profile });
    }

    if (action === "approve_recovery_email") {
      const profileId = String(body?.profile_id || "").trim();
      if (!profileId) return response({ error: "Falta el usuario." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role, pending_recovery_email, is_active")
        .eq("id", profileId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target?.is_active) return response({ error: "Usuario no encontrado o inactivo." }, 404);
      if (!callerCanManage(caller.role, target.role as Role)) return response({ error: "Tu rol no puede aprobar la recuperación de este usuario." }, 403);

      const recoveryEmail = normalizeEmail(target.pending_recovery_email);
      if (!recoveryEmail || !recoveryEmail.includes("@") || isSyntheticEmail(recoveryEmail)) {
        return response({ error: "No hay un email de recuperación pendiente válido." }, 400);
      }

      const { data: duplicate } = await admin
        .from("profiles")
        .select("id")
        .eq("email", recoveryEmail)
        .neq("id", profileId)
        .maybeSingle();
      if (duplicate) return response({ error: "Ese email ya está asociado a otro usuario." }, 400);

      const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
        email: recoveryEmail,
        email_confirm: true,
      });
      if (authError) return response({ error: authError.message || "No se pudo asociar el email al usuario." }, 400);

      const { error: profileError } = await admin
        .from("profiles")
        .update({ email: recoveryEmail, pending_recovery_email: null, recovery_requested_at: null })
        .eq("id", profileId);
      if (profileError) return response({ error: profileError.message || "No se pudo actualizar el perfil." }, 400);

      const redirectTo = safeResetRedirect(body?.redirect_to);
      const { error: resetError } = await anon.auth.resetPasswordForEmail(recoveryEmail, { redirectTo });
      if (resetError) return response({ error: resetError.message || "El email quedó aprobado, pero no se pudo enviar el enlace de recuperación." }, 400);
      return response({ success: true, sent: true });
    }

    if (action === "reject_recovery_email") {
      const profileId = String(body?.profile_id || "").trim();
      if (!profileId) return response({ error: "Falta el usuario." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role, is_active")
        .eq("id", profileId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target?.is_active) return response({ error: "Usuario no encontrado o inactivo." }, 404);
      if (!callerCanManage(caller.role, target.role as Role)) return response({ error: "Tu rol no puede rechazar la recuperación de este usuario." }, 403);

      const { error } = await admin
        .from("profiles")
        .update({ pending_recovery_email: null, recovery_requested_at: null })
        .eq("id", profileId);
      if (error) return response({ error: error.message || "No se pudo rechazar la solicitud." }, 400);
      return response({ success: true });
    }

    if (action === "set_password") {
      const profileId = String(body?.profile_id || "").trim();
      const password = String(body?.password || "");
      if (!profileId) return response({ error: "Falta el usuario." }, 400);
      if (password.length < 6) return response({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", profileId)
        .maybeSingle();
      if (targetError) throw targetError;
      if (!target) return response({ error: "Usuario no encontrado." }, 404);
      if (!callerCanManage(caller.role, target.role as Role)) return response({ error: "Tu rol no puede cambiar la contraseña de este usuario." }, 403);

      const { error } = await admin.auth.admin.updateUserById(profileId, { password });
      if (error) return response({ error: error.message }, 400);
      return response({ success: true });
    }

    return response({ error: "Acción inválida." }, 400);
  } catch (error) {
    console.error(error);
    return response({ error: error instanceof Error ? error.message : "Error inesperado." }, 500);
  }
});
