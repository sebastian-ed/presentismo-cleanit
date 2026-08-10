import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CreateUserBody = {
  email?: string;
  password?: string;
  full_name?: string;
  role?: "operator" | "supervisor" | "admin";
  phone?: string | null;
  notes?: string | null;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeEmail(email: unknown) {
  return String(email || "").trim().toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método no permitido." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Faltan variables de entorno de Supabase en la Edge Function." }, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) {
      return jsonResponse({ error: "Sesión inválida. Ingresá nuevamente como supervisor." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonResponse({ error: "No se pudo validar la sesión del supervisor." }, 401);
    }

    const { data: callerProfile, error: profileError } = await userClient
      .from("profiles")
      .select("id, role, is_active")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!callerProfile?.is_active || !['supervisor', 'admin'].includes(callerProfile.role)) {
      return jsonResponse({ error: "Solo un supervisor o administrador activo puede crear usuarios." }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as CreateUserBody;
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");
    const fullName = String(body.full_name || "").trim();
    const role = body.role || "operator";
    const phone = String(body.phone || "").trim() || null;
    const notes = String(body.notes || "").trim() || null;

    if (!email || !email.includes("@")) return jsonResponse({ error: "Email inválido." }, 400);
    if (!password || password.length < 6) return jsonResponse({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
    if (!fullName) return jsonResponse({ error: "Cargá nombre y apellido." }, 400);
    if (!['operator', 'supervisor', 'admin'].includes(role)) return jsonResponse({ error: "Rol inválido." }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (createError || !created?.user) {
      return jsonResponse({ error: createError?.message || "No se pudo crear el usuario Auth." }, 400);
    }

    const profilePayload = {
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      phone,
      notes,
      is_active: true,
    };

    const { data: profile, error: profileInsertError } = await adminClient
      .from("profiles")
      .upsert(profilePayload)
      .select("*")
      .single();

    if (profileInsertError) {
      await adminClient.auth.admin.deleteUser(created.user.id);
      throw profileInsertError;
    }

    return jsonResponse({
      user: {
        id: created.user.id,
        email: created.user.email,
      },
      profile,
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : "Error inesperado al crear usuario." }, 500);
  }
});
