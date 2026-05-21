import { useState, useEffect, useRef } from "react";
import Icon from "@/components/ui/icon";

// ─── Types ───────────────────────────────────────────────────────────────────
type TabId = "dmx" | "audio" | "library" | "settings" | "history" | "scene3d";

interface DmxChannel {
  id: number;
  name: string;
  value: number;
  color: string;
}

interface Preset {
  id: number;
  name: string;
  genre: string;
  bpm: number;
  color: string;
  channels: number[];
}

interface HistoryEvent {
  id: number;
  time: string;
  type: "auto" | "manual" | "ai";
  message: string;
}

interface Light3D {
  id: number;
  name: string;
  x: number;
  y: number;
  active: boolean;
  color: string;
  intensity: number;
}

// ─── Data ─────────────────────────────────────────────────────────────────────
const INITIAL_CHANNELS: DmxChannel[] = Array.from({ length: 16 }, (_, i) => ({
  id: i + 1,
  name: `CH ${i + 1}`,
  value: Math.floor(Math.random() * 200),
  color: ["cyan", "purple", "amber", "green"][i % 4],
}));

const PRESETS: Preset[] = [
  { id: 1, name: "Rave Storm", genre: "Techno", bpm: 140, color: "cyan", channels: [255, 0, 180, 0, 255, 100, 0, 200] },
  { id: 2, name: "Jazz Club", genre: "Jazz", bpm: 90, color: "amber", channels: [180, 120, 60, 0, 80, 40, 0, 100] },
  { id: 3, name: "Rock Anthem", genre: "Rock", bpm: 120, color: "red", channels: [255, 200, 0, 180, 255, 0, 160, 200] },
  { id: 4, name: "Ambient Flow", genre: "Ambient", bpm: 60, color: "purple", channels: [80, 0, 180, 120, 40, 200, 0, 60] },
  { id: 5, name: "Pop Shine", genre: "Pop", bpm: 110, color: "green", channels: [200, 180, 100, 60, 180, 120, 80, 160] },
  { id: 6, name: "Deep House", genre: "House", bpm: 128, color: "blue", channels: [120, 0, 255, 80, 100, 200, 0, 180] },
];

const HISTORY: HistoryEvent[] = [
  { id: 1, time: "23:47:12", type: "ai", message: "AI распознал Techno 138 BPM — активирован пресет 'Rave Storm'" },
  { id: 2, time: "23:46:55", type: "auto", message: "Автоматический переход: CH4 → 180 по темпу" },
  { id: 3, time: "23:45:30", type: "manual", message: "Пользователь изменил CH1: 120 → 255" },
  { id: 4, time: "23:44:18", type: "ai", message: "AI обнаружил смену жанра: Jazz → Techno" },
  { id: 5, time: "23:43:02", type: "auto", message: "Синхронизация Beat: 12 каналов обновлены по BPM 138" },
  { id: 6, time: "23:42:44", type: "manual", message: "Загружен пресет 'Jazz Club'" },
  { id: 7, time: "23:41:11", type: "ai", message: "Уровень энергии: HIGH — усилены стробы CH7, CH8" },
  { id: 8, time: "23:40:05", type: "auto", message: "Art-Net соединение восстановлено: 192.168.1.10:6454" },
];

const LIGHTS_3D: Light3D[] = [
  { id: 1, name: "LED Par L1", x: 15, y: 12, active: true, color: "cyan", intensity: 90 },
  { id: 2, name: "LED Par L2", x: 35, y: 12, active: true, color: "purple", intensity: 70 },
  { id: 3, name: "Spot C", x: 50, y: 8, active: true, color: "amber", intensity: 100 },
  { id: 4, name: "LED Par R2", x: 65, y: 12, active: false, color: "cyan", intensity: 0 },
  { id: 5, name: "LED Par R1", x: 85, y: 12, active: true, color: "green", intensity: 60 },
  { id: 6, name: "Moving Head L", x: 25, y: 30, active: true, color: "cyan", intensity: 80 },
  { id: 7, name: "Moving Head R", x: 75, y: 30, active: true, color: "purple", intensity: 80 },
  { id: 8, name: "Strobe L", x: 10, y: 45, active: true, color: "amber", intensity: 45 },
  { id: 9, name: "Strobe R", x: 90, y: 45, active: false, color: "amber", intensity: 0 },
  { id: 10, name: "Wash C", x: 50, y: 62, active: true, color: "red", intensity: 55 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function StatusDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${active ? "bg-green-400 animate-pulse" : "bg-zinc-600"}`} />
  );
}

function PanelHeader({ title, icon, accent }: { title: string; icon: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 mb-4 pb-3 border-b border-zinc-800">
      <Icon name={icon as Parameters<typeof Icon>[0]["name"]} size={16} style={{ color: accent }} />
      <h2 className="font-display text-xs font-semibold tracking-[0.25em] uppercase" style={{ color: accent }}>{title}</h2>
      <div className="flex-1" />
      <StatusDot active />
    </div>
  );
}

// ─── DMX Panel ────────────────────────────────────────────────────────────────
function DmxPanel() {
  const [channels, setChannels] = useState<DmxChannel[]>(INITIAL_CHANNELS);
  const [masterValue, setMasterValue] = useState(255);
  const [blackout, setBlackout] = useState(false);

  const updateChannel = (id: number, value: number) => {
    setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, value } : ch));
  };

  const neonColors: Record<string, string> = {
    cyan: "#00ffff",
    purple: "#a855f7",
    amber: "#f59e0b",
    green: "#22c55e",
  };

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="DMX Control" icon="Sliders" accent="#00ffff" />

      <div className="flex items-center gap-4 mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded">
        <div className="flex-1">
          <div className="flex justify-between mb-1">
            <span className="font-mono-tech text-[10px] text-zinc-500 tracking-widest">MASTER</span>
            <span className="font-mono-tech text-[10px]" style={{ color: "#00ffff" }}>{masterValue}</span>
          </div>
          <input type="range" min={0} max={255} value={masterValue}
            onChange={e => setMasterValue(+e.target.value)}
            className="w-full h-1 appearance-none bg-zinc-800 rounded cursor-pointer"
            style={{ accentColor: "#00ffff" }}
          />
        </div>
        <button onClick={() => setBlackout(v => !v)}
          className="px-4 py-2 font-display text-[10px] tracking-widest border rounded transition-all"
          style={{
            borderColor: blackout ? "#ef4444" : "#3f3f46",
            color: blackout ? "#ef4444" : "#71717a",
            background: blackout ? "rgba(239,68,68,0.1)" : "transparent",
          }}
        >
          {blackout ? "▪ BLACKOUT" : "BLACKOUT"}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-8 gap-2 h-full min-h-[200px]">
          {channels.map(ch => {
            const col = neonColors[ch.color];
            const displayVal = blackout ? 0 : ch.value;
            return (
              <div key={ch.id} className="flex flex-col items-center gap-1">
                <span className="font-mono-tech text-[10px]" style={{ color: col }}>
                  {String(displayVal).padStart(3, "0")}
                </span>
                <div className="flex-1 relative w-full flex justify-center min-h-[120px]">
                  <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full pointer-events-none transition-all duration-100"
                    style={{
                      height: `${(displayVal / 255) * 100}%`,
                      background: `${col}66`,
                      boxShadow: `0 0 6px ${col}88`,
                    }}
                  />
                  <input type="range" min={0} max={255} value={ch.value}
                    onChange={e => updateChannel(ch.id, +e.target.value)}
                    disabled={blackout}
                    className="dmx-fader"
                    style={{ opacity: blackout ? 0.3 : 1 }}
                  />
                </div>
                <span className="font-mono-tech text-[9px] text-zinc-600">{ch.name}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {["FULL", "HALF", "SCENE A", "SCENE B"].map(label => (
          <button key={label}
            className="py-1.5 border border-zinc-800 text-zinc-500 hover:border-cyan-500/40 hover:text-cyan-400 font-display text-[10px] tracking-widest rounded transition-all"
            onClick={() => {
              if (label === "FULL") setChannels(prev => prev.map(c => ({ ...c, value: 255 })));
              if (label === "HALF") setChannels(prev => prev.map(c => ({ ...c, value: 127 })));
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Audio Panel ──────────────────────────────────────────────────────────────
function AudioPanel() {
  const [bars, setBars] = useState<number[]>(Array.from({ length: 32 }, () => Math.random() * 0.5 + 0.1));
  const [genre, setGenre] = useState("Techno");
  const [bpm, setBpm] = useState(138);
  const [energy, setEnergy] = useState(0.82);
  const [aiActive, setAiActive] = useState(true);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setBars(prev => prev.map(v => {
        const target = Math.random() * 0.9 + 0.05;
        return v + (target - v) * 0.12;
      }));
      if (Math.random() > 0.95) setBpm(prev => prev + (Math.random() > 0.5 ? 1 : -1));
      setEnergy(prev => Math.max(0.1, Math.min(1, prev + (Math.random() - 0.5) * 0.04)));
      animRef.current = requestAnimationFrame(tick);
    };
    if (aiActive) { animRef.current = requestAnimationFrame(tick); }
    return () => cancelAnimationFrame(animRef.current);
  }, [aiActive]);

  const barColors = ["#3b82f6", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"];
  const genres = ["Techno", "House", "Jazz", "Rock", "Pop", "Ambient", "DnB"];

  const energyGradient = energy > 0.7
    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
    : energy > 0.4
    ? "linear-gradient(90deg, #22c55e, #f59e0b)"
    : "linear-gradient(90deg, #3b82f6, #22c55e)";

  const energyLabel = energy > 0.7 ? "#ef4444" : energy > 0.4 ? "#f59e0b" : "#22c55e";

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Audio Analysis" icon="Activity" accent="#a855f7" />

      <div className="flex items-center gap-3 mb-4 p-3 bg-zinc-900 border border-zinc-800 rounded" style={{ borderColor: "rgba(168,85,247,0.3)" }}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${aiActive ? "bg-green-400 animate-pulse" : "bg-zinc-600"}`} />
        <span className="font-display text-[10px] tracking-widest text-zinc-500">AI ENGINE</span>
        <button onClick={() => setAiActive(v => !v)}
          className="px-3 py-1 text-[10px] font-display tracking-widest border rounded transition-all"
          style={{
            borderColor: aiActive ? "rgba(34,197,94,0.5)" : "#3f3f46",
            color: aiActive ? "#22c55e" : "#71717a",
            background: aiActive ? "rgba(34,197,94,0.08)" : "transparent",
          }}
        >
          {aiActive ? "ACTIVE" : "INACTIVE"}
        </button>
        <div className="flex-1" />
        <span className="font-mono-tech text-sm" style={{ color: "#a855f7" }}>{bpm}</span>
        <span className="font-mono-tech text-[10px] text-zinc-500">BPM</span>
      </div>

      {/* Spectrum */}
      <div className="flex items-end gap-0.5 px-1 bg-black/50 rounded border border-zinc-800 mb-4"
        style={{ height: 130 }}>
        {bars.map((v, i) => (
          <div key={i} className="flex-1 rounded-t-sm"
            style={{
              height: `${v * 100}%`,
              background: barColors[Math.floor(i / (bars.length / barColors.length))],
              opacity: 0.65 + v * 0.35,
              transition: "height 0.06s ease-out",
              boxShadow: `0 -3px 8px ${barColors[Math.floor(i / (bars.length / barColors.length))]}55`,
            }}
          />
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "ЖАНР", value: genre, color: "#06b6d4" },
          { label: "ТЕМП", value: `${bpm} BPM`, color: "#f59e0b" },
          { label: "ЭНЕРГИЯ", value: `${Math.round(energy * 100)}%`, color: energyLabel },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 p-2 rounded text-center">
            <div className="font-display text-[9px] tracking-widest text-zinc-500 mb-1">{label}</div>
            <div className="font-mono-tech text-xs" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="font-display text-[9px] tracking-widest text-zinc-500">УРОВЕНЬ ЭНЕРГИИ</span>
          <span className="font-mono-tech text-[10px] text-zinc-500">{Math.round(energy * 100)}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-200"
            style={{ width: `${energy * 100}%`, background: energyGradient, boxShadow: `0 0 8px ${energyLabel}88` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {genres.map(g => (
          <button key={g} onClick={() => setGenre(g)}
            className="px-2 py-0.5 text-[10px] font-display tracking-widest border rounded transition-all"
            style={{
              borderColor: genre === g ? "rgba(168,85,247,0.6)" : "#3f3f46",
              color: genre === g ? "#a855f7" : "#71717a",
              background: genre === g ? "rgba(168,85,247,0.1)" : "transparent",
            }}
          >
            {g}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Library Panel ────────────────────────────────────────────────────────────
function LibraryPanel() {
  const [active, setActive] = useState<number | null>(1);
  const [search, setSearch] = useState("");

  const genreColors: Record<string, string> = {
    Techno: "#06b6d4", Jazz: "#f59e0b", Rock: "#ef4444",
    Ambient: "#a855f7", Pop: "#22c55e", House: "#3b82f6",
  };

  const filtered = PRESETS.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.genre.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Library" icon="BookOpen" accent="#f59e0b" />

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Поиск пресета..."
        className="w-full mb-3 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-sm font-body text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/40"
      />

      <div className="flex-1 overflow-y-auto space-y-2">
        {filtered.map(preset => {
          const col = genreColors[preset.genre] || "#06b6d4";
          const isActive = active === preset.id;
          return (
            <div key={preset.id} onClick={() => setActive(preset.id)}
              className="p-3 border rounded cursor-pointer transition-all"
              style={{
                borderColor: isActive ? `${col}44` : "#27272a",
                background: isActive ? `${col}08` : "transparent",
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-display text-sm font-semibold" style={{ color: col }}>{preset.name}</span>
                <span className="text-[10px] font-display tracking-widest px-1.5 py-0.5 rounded border"
                  style={{ color: `${col}bb`, borderColor: `${col}33` }}>
                  {preset.genre}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono-tech text-xs text-zinc-500">{preset.bpm} BPM</span>
                <div className="flex gap-0.5 flex-1">
                  {preset.channels.map((v, i) => (
                    <div key={i} className="flex-1 rounded-sm"
                      style={{ height: 12, background: `${col}${Math.floor((v / 255) * 0.8 * 255 + 30).toString(16).padStart(2, "0")}` }}
                    />
                  ))}
                </div>
              </div>
              {isActive && (
                <div className="mt-2 flex gap-2">
                  <button className="flex-1 py-1.5 text-[10px] font-display tracking-widest border rounded transition-all"
                    style={{ borderColor: `${col}50`, color: col, background: `${col}12` }}>
                    ЗАГРУЗИТЬ
                  </button>
                  <button className="px-3 py-1.5 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 rounded">
                    ИЗМЕНИТЬ
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button className="mt-3 w-full py-2 border border-dashed border-amber-500/25 text-amber-500/50 hover:border-amber-500/50 hover:text-amber-400 text-[10px] font-display tracking-widest rounded transition-all">
        + НОВЫЙ ПРЕСЕТ
      </button>
    </div>
  );
}

// ─── Settings Panel ───────────────────────────────────────────────────────────
function SettingsPanel() {
  const [ip, setIp] = useState("192.168.1.10");
  const [port, setPort] = useState("6454");
  const [universe, setUniverse] = useState("0");
  const [aiSensitivity, setAiSensitivity] = useState(75);
  const [beatSync, setBeatSync] = useState(true);
  const [autoPreset, setAutoPreset] = useState(true);
  const [smoothing, setSmoothing] = useState(40);
  const [connected, setConnected] = useState(true);

  function Toggle({ value, onChange, accent }: { value: boolean; onChange: () => void; accent: string }) {
    return (
      <button onClick={onChange}
        className="w-10 h-5 rounded-full border relative transition-all"
        style={{ borderColor: value ? `${accent}55` : "#3f3f46", background: value ? `${accent}22` : "transparent" }}
      >
        <span className="absolute top-0.5 w-4 h-4 rounded-full transition-all"
          style={{ [value ? "right" : "left"]: "2px", background: value ? accent : "#52525b" }}
        />
      </button>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto gap-3">
      <PanelHeader title="Settings" icon="Settings" accent="#22c55e" />

      <div className="bg-zinc-900 border rounded p-3" style={{ borderColor: "rgba(6,182,212,0.25)" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-xs tracking-widest text-cyan-400">ART-NET</span>
          <div className="flex items-center gap-2">
            <StatusDot active={connected} />
            <span className="font-mono-tech text-[10px]" style={{ color: connected ? "#22c55e" : "#ef4444" }}>
              {connected ? "CONNECTED" : "OFFLINE"}
            </span>
          </div>
        </div>
        {([["IP Address", ip, setIp], ["Port", port, setPort], ["Universe", universe, setUniverse]] as [string, string, (v: string) => void][]).map(([label, val, setter]) => (
          <div key={label} className="flex items-center gap-3 mb-2">
            <label className="font-display text-[10px] tracking-widest text-zinc-500 w-24 shrink-0">{label}</label>
            <input value={val} onChange={e => setter(e.target.value)}
              className="flex-1 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded font-mono-tech text-xs text-zinc-100 focus:outline-none focus:border-cyan-500/40"
            />
          </div>
        ))}
        <div className="flex gap-2 mt-3">
          <button onClick={() => setConnected(v => !v)}
            className="flex-1 py-1.5 text-[10px] font-display tracking-widest border rounded transition-all"
            style={{
              borderColor: connected ? "rgba(34,197,94,0.5)" : "rgba(6,182,212,0.5)",
              color: connected ? "#22c55e" : "#06b6d4",
              background: connected ? "rgba(34,197,94,0.08)" : "rgba(6,182,212,0.08)",
            }}
          >
            {connected ? "DISCONNECT" : "CONNECT"}
          </button>
          <button className="px-3 py-1.5 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 rounded">PING</button>
        </div>
      </div>

      <div className="bg-zinc-900 border rounded p-3" style={{ borderColor: "rgba(168,85,247,0.25)" }}>
        <span className="font-display text-xs tracking-widest text-purple-400 block mb-3">AI ENGINE</span>
        <div className="space-y-3">
          {[
            { label: "ЧУВСТВИТЕЛЬНОСТЬ", value: aiSensitivity, set: setAiSensitivity, max: 100, unit: "%", color: "#a855f7" },
            { label: "СГЛАЖИВАНИЕ", value: smoothing, set: setSmoothing, max: 500, unit: "ms", color: "#f59e0b" },
          ].map(({ label, value, set, max, unit, color }) => (
            <div key={label}>
              <div className="flex justify-between mb-1">
                <span className="font-display text-[9px] tracking-widest text-zinc-500">{label}</span>
                <span className="font-mono-tech text-[10px]" style={{ color }}>{value}{unit}</span>
              </div>
              <input type="range" min={0} max={max} value={value}
                onChange={e => set(+e.target.value)}
                className="w-full h-1 appearance-none bg-zinc-800 rounded cursor-pointer"
                style={{ accentColor: color }}
              />
            </div>
          ))}
          {[
            { label: "Синхронизация BPM", value: beatSync, set: () => setBeatSync(v => !v), accent: "#06b6d4" },
            { label: "Авто-пресеты по жанру", value: autoPreset, set: () => setAutoPreset(v => !v), accent: "#a855f7" },
          ].map(({ label, value, set, accent }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="font-display text-[10px] tracking-widest text-zinc-500">{label}</span>
              <Toggle value={value} onChange={set} accent={accent} />
            </div>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
        <span className="font-display text-xs tracking-widest text-amber-400 block mb-3">КАЛИБРОВКА</span>
        <div className="grid grid-cols-2 gap-2">
          {["DMX Test", "Latency Test", "Reset AI", "Factory Reset"].map(label => (
            <button key={label}
              className="py-2 text-[10px] font-display tracking-widest border rounded transition-all"
              style={{
                borderColor: label === "Factory Reset" ? "rgba(239,68,68,0.35)" : "#27272a",
                color: label === "Factory Reset" ? "#ef4444" : "#71717a",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────
function HistoryPanel() {
  const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
    ai: { label: "AI", color: "#a855f7", icon: "Cpu" },
    auto: { label: "AUTO", color: "#06b6d4", icon: "Zap" },
    manual: { label: "USER", color: "#f59e0b", icon: "User" },
  };

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Event Log" icon="Clock" accent="#3b82f6" />

      <div className="flex gap-2 mb-3">
        {(["ai", "auto", "manual"] as const).map(type => {
          const c = typeConfig[type];
          return (
            <div key={type} className="flex items-center gap-1.5 px-2 py-1 border rounded"
              style={{ borderColor: `${c.color}33` }}>
              <Icon name={c.icon as Parameters<typeof Icon>[0]["name"]} size={10} style={{ color: c.color }} />
              <span className="font-display text-[9px] tracking-widest" style={{ color: c.color }}>{c.label}</span>
            </div>
          );
        })}
        <div className="flex-1" />
        <button className="px-2 py-1 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 hover:border-red-500/30 hover:text-red-400 rounded transition-all">
          ОЧИСТИТЬ
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {HISTORY.map((event, i) => {
          const c = typeConfig[event.type];
          return (
            <div key={event.id}
              className="flex gap-3 p-2.5 border border-zinc-800 rounded hover:bg-zinc-900/50 transition-all"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="shrink-0 pt-0.5">
                <Icon name={c.icon as Parameters<typeof Icon>[0]["name"]} size={13} style={{ color: c.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-display text-[9px] tracking-widest" style={{ color: c.color }}>{c.label}</span>
                  <span className="font-mono-tech text-[10px] text-zinc-600">{event.time}</span>
                </div>
                <p className="font-body text-xs text-zinc-300 leading-snug">{event.message}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 p-2 bg-zinc-900 border border-zinc-800 rounded text-center">
        <span className="font-mono-tech text-[10px] text-zinc-600">{HISTORY.length} событий · сессия 01:23:45</span>
      </div>
    </div>
  );
}

// ─── 3D Scene Panel ───────────────────────────────────────────────────────────
function Scene3DPanel() {
  const [selected, setSelected] = useState<number | null>(null);
  const [lights, setLights] = useState<Light3D[]>(LIGHTS_3D);

  const colorHex: Record<string, string> = {
    cyan: "#06b6d4", purple: "#a855f7", amber: "#f59e0b",
    green: "#22c55e", red: "#ef4444", blue: "#3b82f6",
  };

  const selectedLight = lights.find(l => l.id === selected);

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="3D Scene" icon="Box" accent="#06b6d4" />

      <div className="relative flex-1 bg-black/60 border border-zinc-800 rounded overflow-hidden mb-3" style={{ minHeight: 200 }}>
        <div className="absolute bottom-0 left-0 right-0 h-1/3"
          style={{ background: "linear-gradient(to top, rgba(9,9,11,0.8), transparent)", borderTop: "1px solid #18181b" }}
        />
        <svg className="absolute inset-0 w-full h-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid3d" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#06b6d4" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid3d)" />
        </svg>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 font-display text-[9px] tracking-[0.3em] text-zinc-700">СЦЕНА</div>

        {lights.map(light => {
          const col = colorHex[light.color];
          return (
            <div key={light.id}
              onClick={() => setSelected(light.id === selected ? null : light.id)}
              className="absolute cursor-pointer group"
              style={{ left: `${light.x}%`, top: `${light.y}%`, transform: "translate(-50%, -50%)" }}
            >
              {light.active && (
                <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none"
                  style={{
                    width: `${light.intensity / 3.5}px`,
                    height: `${light.intensity * 0.7}px`,
                    background: `linear-gradient(to bottom, ${col}66, transparent)`,
                    clipPath: "polygon(25% 0%, 75% 0%, 100% 100%, 0% 100%)",
                  }}
                />
              )}
              <div
                className="w-4 h-4 rounded-sm border relative z-10 transition-transform"
                style={{
                  background: light.active ? `${col}33` : "#18181b",
                  borderColor: light.active ? col : "#27272a",
                  boxShadow: light.active ? `0 0 ${Math.floor(light.intensity / 8)}px ${col}` : "none",
                  transform: selected === light.id ? "scale(1.3)" : "scale(1)",
                }}
              />
              <div className="absolute top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                <span className="font-mono-tech text-[8px] text-zinc-500 bg-black/90 px-1 py-0.5 rounded">{light.name}</span>
              </div>
            </div>
          );
        })}
      </div>

      {selectedLight ? (
        <div className="bg-zinc-900 border rounded p-3 mb-2 animate-fade-in"
          style={{ borderColor: `${colorHex[selectedLight.color]}44` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="font-display text-xs tracking-widest" style={{ color: colorHex[selectedLight.color] }}>
              {selectedLight.name}
            </span>
            <button
              onClick={() => setLights(prev => prev.map(l => l.id === selectedLight.id ? { ...l, active: !l.active } : l))}
              className="px-2 py-0.5 text-[10px] font-display tracking-widest border rounded"
              style={{
                borderColor: `${colorHex[selectedLight.color]}44`,
                color: colorHex[selectedLight.color],
              }}
            >
              {selectedLight.active ? "ON" : "OFF"}
            </button>
          </div>
          <div className="flex justify-between mb-1">
            <span className="font-display text-[9px] tracking-widest text-zinc-500">ИНТЕНСИВНОСТЬ</span>
            <span className="font-mono-tech text-[10px]" style={{ color: colorHex[selectedLight.color] }}>{selectedLight.intensity}%</span>
          </div>
          <input type="range" min={0} max={100} value={selectedLight.intensity}
            onChange={e => setLights(prev => prev.map(l => l.id === selectedLight.id ? { ...l, intensity: +e.target.value } : l))}
            className="w-full h-1 appearance-none bg-zinc-800 rounded cursor-pointer"
            style={{ accentColor: colorHex[selectedLight.color] }}
          />
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center mb-2">
          <span className="font-display text-[10px] tracking-widest text-zinc-600">Выберите прибор на сцене</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5 max-h-24 overflow-y-auto">
        {lights.map(l => (
          <div key={l.id}
            onClick={() => setSelected(l.id === selected ? null : l.id)}
            className="flex items-center gap-2 px-2 py-1 border border-zinc-800 rounded cursor-pointer hover:bg-zinc-900 transition-all"
          >
            <div className="w-2 h-2 rounded-full shrink-0"
              style={{ background: l.active ? colorHex[l.color] : "#27272a", boxShadow: l.active ? `0 0 4px ${colorHex[l.color]}` : "none" }}
            />
            <span className="font-mono-tech text-[9px] text-zinc-500 truncate">{l.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
const TABS: { id: TabId; label: string; icon: string; accent: string }[] = [
  { id: "dmx", label: "DMX", icon: "Sliders", accent: "#06b6d4" },
  { id: "audio", label: "Аудио", icon: "Activity", accent: "#a855f7" },
  { id: "library", label: "Библиотека", icon: "BookOpen", accent: "#f59e0b" },
  { id: "settings", label: "Настройки", icon: "Settings", accent: "#22c55e" },
  { id: "history", label: "История", icon: "Clock", accent: "#3b82f6" },
  { id: "scene3d", label: "3D Сцена", icon: "Box", accent: "#06b6d4" },
];

export default function Index() {
  const [activeTab, setActiveTab] = useState<TabId>("dmx");
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const panels: Record<TabId, JSX.Element> = {
    dmx: <DmxPanel />,
    audio: <AudioPanel />,
    library: <LibraryPanel />,
    settings: <SettingsPanel />,
    history: <HistoryPanel />,
    scene3d: <Scene3DPanel />,
  };

  return (
    <div className="h-screen w-screen bg-zinc-950 flex flex-col overflow-hidden" style={{ fontFamily: "'Rajdhani', sans-serif" }}>
      {/* Top Bar */}
      <header className="flex items-center px-4 py-2 border-b border-zinc-800 bg-black/70 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded border border-cyan-500/50 flex items-center justify-center"
            style={{ boxShadow: "0 0 8px rgba(6,182,212,0.3)" }}>
            <Icon name="Zap" size={12} style={{ color: "#06b6d4" }} />
          </div>
          <h1 className="font-display text-sm font-bold tracking-[0.3em]" style={{ color: "#06b6d4", textShadow: "0 0 12px rgba(6,182,212,0.5)" }}>
            LUMINA
          </h1>
          <span className="font-display text-[9px] tracking-widest text-zinc-600">AI LIGHT CONTROL</span>
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-5 mr-5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-mono-tech text-[10px] text-green-400">ART-NET OK</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icon name="Cpu" size={11} style={{ color: "#a855f7" }} />
            <span className="font-mono-tech text-[10px] text-purple-400">AI ACTIVE</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Icon name="Music" size={11} style={{ color: "#f59e0b" }} />
            <span className="font-mono-tech text-[10px] text-amber-400">138 BPM</span>
          </div>
        </div>

        <span className="font-mono-tech text-xs text-zinc-600">
          {time.toLocaleTimeString("ru-RU")}
        </span>
      </header>

      {/* Navigation */}
      <nav className="flex border-b border-zinc-800 bg-zinc-950/90 shrink-0">
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5 border-r border-zinc-800 transition-all font-display text-[10px] tracking-widest"
              style={{
                color: isActive ? tab.accent : "#52525b",
                background: isActive ? `${tab.accent}0d` : "transparent",
                borderBottom: isActive ? `2px solid ${tab.accent}` : "2px solid transparent",
              }}
            >
              <Icon name={tab.icon as Parameters<typeof Icon>[0]["name"]} size={13} style={{ color: isActive ? tab.accent : "#52525b" }} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* Main */}
      <main className="flex-1 overflow-hidden p-4">
        <div key={activeTab} className="h-full animate-fade-in">
          {panels[activeTab]}
        </div>
      </main>

      {/* Status bar */}
      <footer className="flex items-center px-4 py-1 border-t border-zinc-800 bg-black/60 shrink-0">
        <span className="font-mono-tech text-[10px] text-zinc-700">
          LUMINA v1.0.0 · Universe 0 · 512 каналов · 16 активных
        </span>
        <div className="flex-1" />
        <span className="font-mono-tech text-[10px] text-green-500">● СИСТЕМА ГОТОВА</span>
      </footer>
    </div>
  );
}