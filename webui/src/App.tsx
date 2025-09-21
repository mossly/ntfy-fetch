import { useEffect, useMemo, useState } from 'react';

type Snapshot = {
  system: { uptimeSec: number; schedulerState: 'running'|'stopped'; taskCount: number };
  plugins: Array<{ name: string; enabled: boolean; initialized: boolean; version: string }>;
  tasks: Array<{ name: string; expression: string; description: string; pluginName: string; nextRun: string|null }>;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/snapshot').then(r => r.json()).then(setSnapshot).catch(e => setError(String(e)));

    const ev = new EventSource('/api/events/stream');
    ev.addEventListener('snapshot', (msg) => {
      try { setSnapshot(JSON.parse((msg as MessageEvent).data)); } catch {}
    });
    ev.addEventListener('update', (msg) => {
      // For now, ignore fine-grained updates; fetch full snapshot periodically if needed
    });
    ev.onerror = () => { /* keep open */ };
    return () => ev.close();
  }, []);

  const uptime = useMemo(() => snapshot ? `${Math.floor(snapshot.system.uptimeSec/3600)}h ${Math.floor((snapshot.system.uptimeSec%3600)/60)}m` : '-', [snapshot]);

  if (error) {
    return <div className="p-4 text-error">Error: {error}</div>;
  }

  if (!snapshot) {
    return <div className="h-full flex items-center justify-center"><span className="loading loading-spinner loading-lg"/></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">ntfy-fetch Dashboard</h1>
        <div className="badge badge-outline">Uptime: {uptime}</div>
      </div>

      <div className="stats shadow">
        <div className="stat">
          <div className="stat-title">Scheduler</div>
          <div className="stat-value text-primary capitalize">{snapshot.system.schedulerState}</div>
          <div className="stat-desc">{snapshot.system.taskCount} tasks</div>
        </div>
        <div className="stat">
          <div className="stat-title">Plugins</div>
          <div className="stat-value">{snapshot.plugins.length}</div>
          <div className="stat-desc">enabled and initialized</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card bg-base-200 shadow">
          <div className="card-body">
            <h2 className="card-title">Plugins</h2>
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Version</th>
                    <th>Enabled</th>
                    <th>Initialized</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.plugins.map(p => (
                    <tr key={p.name}>
                      <td>{p.name}</td>
                      <td><div className="badge badge-ghost">{p.version}</div></td>
                      <td>{p.enabled ? <span className="badge badge-success">Yes</span> : <span className="badge">No</span>}</td>
                      <td>{p.initialized ? <span className="badge badge-success">Yes</span> : <span className="badge">No</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="card bg-base-200 shadow">
          <div className="card-body">
            <h2 className="card-title">Scheduled Tasks</h2>
            <div className="overflow-x-auto">
              <table className="table table-zebra">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Plugin</th>
                    <th>Cron</th>
                    <th>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.tasks.map(t => (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td>{t.pluginName}</td>
                      <td><code>{t.expression}</code></td>
                      <td>{t.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

