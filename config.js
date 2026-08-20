window.APP_CONFIG = {
  // Configuración Supabase de producción.
  SUPABASE_URL: "https://ubdtdangxjjaptkhyqlq.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_jow6AODdziH6cvUx_Wu9xg_cD3lWxdd",

  // Zona horaria operativa para reportes y cálculos visibles.
  TIMEZONE: "America/Argentina/Buenos_Aires",

  // Protección para evitar que un operario registre salida inmediatamente después de la entrada.
  EXIT_PROTECTION_MINUTES: 10,

  // Cierre automático de turnos sin salida. La misma demora está aplicada en la función SQL de Supabase.
  AUTO_CHECKOUT_DELAY_MINUTES: 45,

  // Nombre operativo usado en mensajes al consorcio.
  COMPANY_NAME: "Clean It"
};
