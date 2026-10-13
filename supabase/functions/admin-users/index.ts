// Supabase Edge Function: admin-users
// Invites a user account. Runs on Supabase infrastructure, where the
// service-role key is available as an environment variable; it is never
// sent to the browser. The caller must be an active Super Admin.
//
// Required function secrets (set with `supabase secrets set`):
//   SITE_URL         e.g. https://dtr.example.org  (used for the invite redirect)
//   ALLOWED_ORIGINS  comma-separated list of allowed browser origins
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// automatically by the Supabase Edge runtime.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['super_admin', 'hr_admin', 'supervisor', 'employee'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

// Best-effort per-instance throttle; Supabase Auth applies its own email rate limits.
const recent = new Map<string, number[]>();
function throttled(userId: string): boolean {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(userId, list);
  return list.length > 10;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
  if (origin && allowedOrigins.length && !allowedOrigins.includes(origin)) return json({ error: 'Origin not allowed' }, 403, origin);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const siteUrl = Deno.env.get('SITE_URL');
  if (!url || !anonKey || !serviceKey || !siteUrl) return json({ error: 'Function is not configured (missing SITE_URL or Supabase environment).' }, 500, origin);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401, origin);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'Not signed in' }, 401, origin);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerProfile } = await admin.from('profiles').select('role, status, email').eq('id', userData.user.id).maybeSingle();
  if (!callerProfile || callerProfile.role !== 'super_admin' || callerProfile.status !== 'active') {
    return json({ error: 'Only an active Super Admin can manage user accounts.' }, 403, origin);
  }
  if (throttled(userData.user.id)) return json({ error: 'Too many requests. Wait a minute and try again.' }, 429, origin);

  let body: { action?: unknown; email?: unknown; full_name?: unknown; role?: unknown; employee_id?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin);
  }
  if (body?.action !== 'invite') return json({ error: 'Unsupported action' }, 400, origin);

  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.full_name ?? '').trim().slice(0, 200) || null;
  const role = String(body.role ?? 'employee');
  const employeeId = body.employee_id ? String(body.employee_id) : null;
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: 'Enter a valid email address.' }, 400, origin);
  if (!ROLES.includes(role)) return json({ error: 'Invalid role.' }, 400, origin);
  if (employeeId && !UUID_RE.test(employeeId)) return json({ error: 'Invalid employee reference.' }, 400, origin);

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteUrl.replace(/\/$/, '')}/reset-password`,
    data: { full_name: fullName },
  });
  if (inviteError) {
    const exists = /already|registered|exists/i.test(inviteError.message);
    return json({ error: exists ? 'An account with this email already exists.' : 'The invitation could not be sent.' }, exists ? 409 : 400, origin);
  }

  // The auth trigger always creates the profile as an active 'employee'.
  // Elevate it here, server-side, after verifying the caller above.
  const { error: profileError } = await admin
    .from('profiles')
    .update({ role, full_name: fullName, employee_id: employeeId })
    .eq('id', invited.user.id);

  await admin.from('audit_logs').insert({
    actor_id: userData.user.id,
    actor_email: callerProfile.email,
    action: 'user_invited',
    table_name: 'profiles',
    record_id: invited.user.id,
    new_values: { email, role, employee_id: employeeId, profile_update_error: profileError ? profileError.message : null },
  });

  if (profileError) {
    return json({ error: `Invitation sent, but the role/employee link could not be saved (${profileError.code ?? 'error'}). Edit the user to set them.`, user_id: invited.user.id }, 207, origin);
  }
  return json({ user_id: invited.user.id }, 200, origin);
});
