import { useEffect, useMemo, useState } from 'react';

type Snapshot = {
  system: { uptimeSec: number; schedulerState: 'running'|'stopped'; taskCount: number };
  plugins: Array<{ name: string; enabled: boolean; initialized: boolean; version: string; description: string }>;
  tasks: Array<{ name: string; expression: string; description: string; pluginName: string; nextRun: string|null; paused: boolean }>;
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
      // Refresh snapshot on any update
      fetch('/api/snapshot').then(r => r.json()).then(setSnapshot).catch(() => {});
    });
    ev.onerror = () => { /* keep open */ };
    return () => ev.close();
  }, []);

  const toggleTask = async (taskName: string) => {
    try {
      await fetch(`/api/tasks/${encodeURIComponent(taskName)}/toggle`, { method: 'POST' });
      // Refresh snapshot
      const snap = await fetch('/api/snapshot').then(r => r.json());
      setSnapshot(snap);
    } catch (e) {
      console.error('Failed to toggle task:', e);
    }
  };

  const togglePlugin = async (pluginName: string) => {
    try {
      await fetch(`/api/plugins/${encodeURIComponent(pluginName)}/toggle`, { method: 'POST' });
      // Refresh snapshot
      const snap = await fetch('/api/snapshot').then(r => r.json());
      setSnapshot(snap);
    } catch (e) {
      alert('Plugin toggling requires manual config file edit');
    }
  };

  const uptime = useMemo(() => {
    if (!snapshot) return '-';

    const totalSec = snapshot.system.uptimeSec;
    const years = Math.floor(totalSec / (365 * 24 * 3600));
    const weeks = Math.floor((totalSec % (365 * 24 * 3600)) / (7 * 24 * 3600));
    const days = Math.floor((totalSec % (7 * 24 * 3600)) / (24 * 3600));
    const hours = Math.floor((totalSec % (24 * 3600)) / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);

    const parts = [];
    if (years > 0) parts.push(`${years}y`);
    if (weeks > 0) parts.push(`${weeks}w`);
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || (parts.length === 0 && minutes === 0)) parts.push(`${hours}h`);
    if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

    return parts.join(' ');
  }, [snapshot]);

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
                    <th>Description</th>
                    <th>Version</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.plugins.map(p => (
                    <tr key={p.name}>
                      <td className="font-semibold">{p.name}</td>
                      <td className="text-sm opacity-70">{p.description || '-'}</td>
                      <td><div className="badge badge-ghost">{p.version}</div></td>
                      <td>
                        <div className="flex gap-2">
                          {p.enabled ? <span className="badge badge-success">Enabled</span> : <span className="badge">Disabled</span>}
                          {p.initialized ? <span className="badge badge-info">Initialized</span> : <span className="badge badge-warning">Not Init</span>}
                        </div>
                      </td>
                      <td>
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => togglePlugin(p.name)}
                          disabled
                          title="Plugin toggling requires config file edit"
                        >
                          Toggle
                        </button>
                      </td>
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
                    <th>Plugin</th>
                    <th>Description</th>
                    <th>Cron</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.tasks.map(t => (
                    <tr key={t.name}>
                      <td className="font-semibold">{t.pluginName}</td>
                      <td>{t.description}</td>
                      <td><code className="text-xs">{t.expression}</code></td>
                      <td>
                        {t.paused ? (
                          <span className="badge badge-warning">Paused</span>
                        ) : (
                          <span className="badge badge-success">Running</span>
                        )}
                      </td>
                      <td>
                        <button
                          className={`btn btn-xs ${t.paused ? 'btn-success' : 'btn-warning'}`}
                          onClick={() => toggleTask(t.name)}
                        >
                          {t.paused ? 'Resume' : 'Pause'}
                        </button>
                      </td>
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

