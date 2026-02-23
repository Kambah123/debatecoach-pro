import { DebateArena } from '@/components/DebateArena';
import './App.css';

// Backend URL - configurable via environment variable
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8080';

function App() {
  return (
    <div className="min-h-screen bg-slate-950">
      <DebateArena backendUrl={BACKEND_URL} />
    </div>
  );
}

export default App;
