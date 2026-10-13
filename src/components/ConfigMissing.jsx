export function ConfigMissing() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="max-w-lg rounded-lg border border-amber-300 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Supabase is not configured</h1>
        <p className="mt-2 text-sm text-slate-700">
          Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> (see <code>.env.example</code> and the README), then restart the
          dev server or redeploy. Only the public anon/publishable key belongs in these variables — never the service-role key.
        </p>
      </div>
    </main>
  );
}
