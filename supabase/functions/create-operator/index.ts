// Clean It · Presentismo GPS
// Edge Function: alta de operarios (usuario + DNI) y reseteo de contraseña,
// desde el panel supervisor de la app, sin pasar por el SQL Editor.
//
// Usa la Service Role Key (inyectada automáticamente por Supabase en runtime,
// nunca expuesta al navegador) para crear el usuario en auth.users y su
// perfil en public.profiles en una sola operación controlada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function normalizeUsername(raw: string) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // saca acentos (diacríticos tras normalize NFD)
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._-]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization") || "";

    // Cliente "como el llamante" — valida el JWT que mandó la app.
    const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !callerData?.user) {
      return jsonResponse({ error: "No autenticado." }, 401);
    }

    // Cliente admin — Service Role, bypassa RLS. Nunca se expone al navegador.
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", callerData.user.id)
      .maybeSingle();

    if (callerProfileError) throw callerProfileError;
    if (!callerProfile || callerProfile.role !== "supervisor" || !callerProfile.is_active) {
      return jsonResponse({ error: "Solo un supervisor puede realizar esta acción." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "create") {
      const username = normalizeUsername(body?.username);
      const dni = String(body?.dni || "").trim();
      const fullName = String(body?.full_name || "").trim();
      const phone = String(body?.phone || "").trim();

      if (!username) return jsonResponse({ error: "Falta el nombre de usuario." }, 400);
      if (!dni || dni.length < 6) return jsonResponse({ error: "El DNI debe tener al menos 6 dígitos." }, 400);
      if (!fullName) return jsonResponse({ error: "Falta el nombre completo." }, 400);

      const email = `${username}@cleanit.ar`;

      const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password: dni,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

      if (createError) {
        const already = /already been registered|already exists/i.test(createError.message || "");
        return jsonResponse(
          { error: already ? `Ya existe un usuario con el nombre "${username}".` : createError.message },
          already ? 409 : 400
        );
      }

      const newUserId = createdUser.user.id;

      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .insert({
          id: newUserId,
          full_name: fullName,
          role: "operator",
          phone: phone || null,
          is_active: true,
        })
        .select("*")
        .single();

      if (profileError) {
        // Rollback: no dejar un usuario de Auth huérfano sin perfil.
        await admin.auth.admin.deleteUser(newUserId).catch(() => {});
        return jsonResponse({ error: `No se pudo crear el perfil: ${profileError.message}` }, 400);
      }

      return jsonResponse({ profile });
    }

    if (action === "reset_password") {
      const profileId = String(body?.profile_id || "").trim();
      const dni = String(body?.dni || "").trim();

      if (!profileId) return jsonResponse({ error: "Falta el perfil a actualizar." }, 400);
      if (!dni || dni.length < 6) return jsonResponse({ error: "El DNI debe tener al menos 6 dígitos." }, 400);

      const { data: targetProfile, error: targetError } = await admin
        .from("profiles")
        .select("id, role")
        .eq("id", profileId)
        .maybeSingle();

      if (targetError) throw targetError;
      if (!targetProfile || targetProfile.role !== "operator") {
        return jsonResponse({ error: "El usuario no existe o no es un operario." }, 404);
      }

      const { error: updateError } = await admin.auth.admin.updateUserById(profileId, { password: dni });
      if (updateError) return jsonResponse({ error: updateError.message }, 400);

      return jsonResponse({ success: true });
    }

    return jsonResponse({ error: "Acción inválida." }, 400);
  } catch (error) {
    return jsonResponse({ error: error?.message || "Error inesperado." }, 500);
  }
});
