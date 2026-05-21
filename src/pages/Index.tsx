import React, { useState, useEffect, useCallback, useRef, createContext, useContext } from "react";
import Icon from "@/components/ui/icon";
import { useWebAudio } from "@/hooks/useWebAudio";
import type { AudioAnalysis, MoodType, TrackStructure } from "@/hooks/useWebAudio";
import { generateScene, getDefaultSceneFixtures, getSmallRigFixtures, validateFixtures, nextChannel } from "@/hooks/useSceneEngine";
import type { GeneratedScene, FixtureInScene, FixtureGroup, EventType, VenueSize, ShowPolicy, DirectorMode } from "@/hooks/useSceneEngine";
import { presetsApi, historyApi, settingsApi, artnetApi, type ApiPreset, type ApiEvent, type ApiSettings } from "@/lib/api";

// ─── Audio Context — единственный экземпляр useWebAudio на всё приложение ────
// Это решает проблему: смена вкладки → размонтирование компонента → остановка микрофона.
// Все компоненты читают одно и то же состояние через useAudioContext().

interface AudioContextValue {
  analysis: AudioAnalysis;
  start: () => Promise<void>;
  stop: () => void;
  triggerShazam: () => void;
}

const AudioCtx = createContext<AudioContextValue | null>(null);

function useAudioContext(): AudioContextValue {
  const ctx = useContext(AudioCtx);
  if (!ctx) throw new Error("useAudioContext must be used inside AudioProvider");
  return ctx;
}

// ─── Types ───────────────────────────────────────────────────────────────────
type TabId = "dmx" | "audio" | "library" | "settings" | "history" | "scene3d" | "autoscene";

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
  type: "par" | "moving" | "strobe" | "wash" | "spot" | "laser" | "hazer";
  x: number;
  y: number;
  active: boolean;
  color: string;      // hex цвет (обновляется из AI Director)
  intensity: number;  // 0-100
  liveColor?: string; // hex цвет из живой сцены (override)
}

// ─── Fixture Library Types ────────────────────────────────────────────────────
interface DmxAttribute {
  name: string;
  channel: number;
  defaultVal: number;
  min: number;
  max: number;
}

interface FixtureProfile {
  id: number;
  manufacturer: string;
  model: string;
  type: "LED Par" | "Moving Head" | "Strobe" | "Wash" | "Spot" | "Laser";
  channels: number;
  dmxProfile: DmxAttribute[];
  power: number;
  description: string;
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

const FIXTURE_LIBRARY: FixtureProfile[] = [
  {
    id: 1, manufacturer: "Chauvet", model: "SlimPAR Pro H USB", type: "LED Par",
    channels: 8, power: 60, description: "LED PAR с RGBAW+UV, 8 каналов DMX",
    dmxProfile: [
      { name: "Димер", channel: 1, defaultVal: 255, min: 0, max: 255 },
      { name: "Красный", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Зелёный", channel: 3, defaultVal: 0, min: 0, max: 255 },
      { name: "Синий", channel: 4, defaultVal: 255, min: 0, max: 255 },
      { name: "Белый", channel: 5, defaultVal: 0, min: 0, max: 255 },
      { name: "Янтарный", channel: 6, defaultVal: 0, min: 0, max: 255 },
      { name: "UV", channel: 7, defaultVal: 0, min: 0, max: 255 },
      { name: "Strobo", channel: 8, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 2, manufacturer: "Robe", model: "ROBIN 100 LEDBeam", type: "Moving Head",
    channels: 14, power: 90, description: "Движущаяся голова с зумом 4-60°",
    dmxProfile: [
      { name: "Pan", channel: 1, defaultVal: 128, min: 0, max: 255 },
      { name: "Pan Fine", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Tilt", channel: 3, defaultVal: 128, min: 0, max: 255 },
      { name: "Tilt Fine", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Скорость PT", channel: 5, defaultVal: 0, min: 0, max: 255 },
      { name: "Димер", channel: 6, defaultVal: 255, min: 0, max: 255 },
      { name: "Strobo", channel: 7, defaultVal: 0, min: 0, max: 255 },
      { name: "Красный", channel: 8, defaultVal: 0, min: 0, max: 255 },
      { name: "Зелёный", channel: 9, defaultVal: 0, min: 0, max: 255 },
      { name: "Синий", channel: 10, defaultVal: 255, min: 0, max: 255 },
      { name: "Белый", channel: 11, defaultVal: 0, min: 0, max: 255 },
      { name: "Зум", channel: 12, defaultVal: 128, min: 0, max: 255 },
      { name: "Фокус", channel: 13, defaultVal: 128, min: 0, max: 255 },
      { name: "Сброс", channel: 14, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 3, manufacturer: "Martin", model: "Atomic 3000 LED", type: "Strobe",
    channels: 5, power: 640, description: "Профессиональный LED-строб",
    dmxProfile: [
      { name: "Интенсивность", channel: 1, defaultVal: 255, min: 0, max: 255 },
      { name: "Частота", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Режим", channel: 3, defaultVal: 0, min: 0, max: 255 },
      { name: "Случайность", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Цвет", channel: 5, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 4, manufacturer: "ETC", model: "Source Four LED Lustr+", type: "Spot",
    channels: 6, power: 100, description: "Профиль с системой смешивания X8 цветов",
    dmxProfile: [
      { name: "Интенсивность", channel: 1, defaultVal: 255, min: 0, max: 255 },
      { name: "Красный", channel: 2, defaultVal: 255, min: 0, max: 255 },
      { name: "Зелёный", channel: 3, defaultVal: 200, min: 0, max: 255 },
      { name: "Синий", channel: 4, defaultVal: 100, min: 0, max: 255 },
      { name: "Индиго", channel: 5, defaultVal: 0, min: 0, max: 255 },
      { name: "Цикл", channel: 6, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 5, manufacturer: "Clay Paky", model: "Sharpy", type: "Moving Head",
    channels: 16, power: 189, description: "Beam-прибор с призмами и гобо",
    dmxProfile: [
      { name: "Pan", channel: 1, defaultVal: 128, min: 0, max: 255 },
      { name: "Pan Fine", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Tilt", channel: 3, defaultVal: 128, min: 0, max: 255 },
      { name: "Tilt Fine", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Скорость", channel: 5, defaultVal: 0, min: 0, max: 255 },
      { name: "Цвет", channel: 6, defaultVal: 0, min: 0, max: 255 },
      { name: "Гобо", channel: 7, defaultVal: 0, min: 0, max: 255 },
      { name: "Вращение гобо", channel: 8, defaultVal: 0, min: 0, max: 255 },
      { name: "Призма", channel: 9, defaultVal: 0, min: 0, max: 255 },
      { name: "Вращение призмы", channel: 10, defaultVal: 0, min: 0, max: 255 },
      { name: "Фокус", channel: 11, defaultVal: 128, min: 0, max: 255 },
      { name: "Строб/Шаттер", channel: 12, defaultVal: 255, min: 0, max: 255 },
      { name: "Димер", channel: 13, defaultVal: 255, min: 0, max: 255 },
      { name: "Зум", channel: 14, defaultVal: 0, min: 0, max: 255 },
      { name: "Эффекты", channel: 15, defaultVal: 0, min: 0, max: 255 },
      { name: "Сброс", channel: 16, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 6, manufacturer: "Cameo", model: "HYDRABEAM 400 RGBW", type: "Moving Head",
    channels: 9, power: 80, description: "Компактная движущаяся голова RGBW для клубов",
    dmxProfile: [
      { name: "Pan", channel: 1, defaultVal: 128, min: 0, max: 255 },
      { name: "Tilt", channel: 2, defaultVal: 128, min: 0, max: 255 },
      { name: "Скорость", channel: 3, defaultVal: 0, min: 0, max: 255 },
      { name: "Красный", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Зелёный", channel: 5, defaultVal: 0, min: 0, max: 255 },
      { name: "Синий", channel: 6, defaultVal: 255, min: 0, max: 255 },
      { name: "Белый", channel: 7, defaultVal: 0, min: 0, max: 255 },
      { name: "Строб", channel: 8, defaultVal: 0, min: 0, max: 255 },
      { name: "Режим", channel: 9, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 7, manufacturer: "Eurolite", model: "LED TMH-X4", type: "Wash",
    channels: 7, power: 40, description: "Wash прибор 4-в-1 RGBW 10W",
    dmxProfile: [
      { name: "Красный", channel: 1, defaultVal: 0, min: 0, max: 255 },
      { name: "Зелёный", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Синий", channel: 3, defaultVal: 255, min: 0, max: 255 },
      { name: "Белый", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Димер", channel: 5, defaultVal: 255, min: 0, max: 255 },
      { name: "Строб", channel: 6, defaultVal: 0, min: 0, max: 255 },
      { name: "Режим", channel: 7, defaultVal: 0, min: 0, max: 255 },
    ],
  },
  {
    id: 8, manufacturer: "Laserworld", model: "EL-200RGB", type: "Laser",
    channels: 6, power: 35, description: "RGB лазер 200мВт для клубов",
    dmxProfile: [
      { name: "Включение", channel: 1, defaultVal: 255, min: 0, max: 255 },
      { name: "Паттерн", channel: 2, defaultVal: 0, min: 0, max: 255 },
      { name: "Размер", channel: 3, defaultVal: 128, min: 0, max: 255 },
      { name: "Вращение", channel: 4, defaultVal: 0, min: 0, max: 255 },
      { name: "Скорость", channel: 5, defaultVal: 128, min: 0, max: 255 },
      { name: "Цвет", channel: 6, defaultVal: 0, min: 0, max: 255 },
    ],
  },
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
  { id: 1,  name: "LED Par L1",     type: "par",    x: 15, y: 10, active: true,  color: "#06b6d4", intensity: 90 },
  { id: 2,  name: "LED Par L2",     type: "par",    x: 35, y: 10, active: true,  color: "#a855f7", intensity: 70 },
  { id: 3,  name: "Spot C",         type: "spot",   x: 50, y: 7,  active: true,  color: "#f59e0b", intensity: 100 },
  { id: 4,  name: "LED Par R2",     type: "par",    x: 65, y: 10, active: false, color: "#06b6d4", intensity: 0 },
  { id: 5,  name: "LED Par R1",     type: "par",    x: 85, y: 10, active: true,  color: "#22c55e", intensity: 60 },
  { id: 6,  name: "Moving Head L",  type: "moving", x: 25, y: 28, active: true,  color: "#06b6d4", intensity: 80 },
  { id: 7,  name: "Moving Head R",  type: "moving", x: 75, y: 28, active: true,  color: "#a855f7", intensity: 80 },
  { id: 8,  name: "Strobe L",       type: "strobe", x: 10, y: 44, active: true,  color: "#ffffff", intensity: 45 },
  { id: 9,  name: "Strobe R",       type: "strobe", x: 90, y: 44, active: false, color: "#ffffff", intensity: 0 },
  { id: 10, name: "Wash C",         type: "wash",   x: 50, y: 60, active: true,  color: "#ef4444", intensity: 55 },
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
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const updateChannel = (id: number, value: number) => {
    setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, value } : ch));
  };

  const neonColors: Record<string, string> = {
    cyan: "#00ffff",
    purple: "#a855f7",
    amber: "#f59e0b",
    green: "#22c55e",
  };

  const handleSendArtNet = async () => {
    setSending(true);
    setSendResult(null);
    const dmxValues = channels.map(ch => blackout ? 0 : Math.round(ch.value * masterValue / 255));
    const res = await artnetApi.send(dmxValues);
    setSendResult(res.ok
      ? { ok: true, msg: `Отправлено ${dmxValues.length} каналов` }
      : { ok: false, msg: res.error || "Ошибка" }
    );
    if (res.ok) {
      await historyApi.add("manual", `DMX отправлен: ${dmxValues.length} каналов через Art-Net`);
    }
    setSending(false);
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

      {/* Art-Net send */}
      <div className="mt-2 flex gap-2 items-center">
        <button onClick={handleSendArtNet} disabled={sending}
          className="flex-1 py-2 font-display text-[10px] tracking-widest border rounded transition-all flex items-center justify-center gap-2"
          style={{ borderColor: "rgba(0,255,255,0.4)", color: "#00ffff", background: "rgba(0,255,255,0.06)" }}
        >
          <Icon name="Send" size={12} />
          {sending ? "ОТПРАВКА..." : "ОТПРАВИТЬ ART-NET"}
        </button>
        {sendResult && (
          <span className="font-mono-tech text-[10px]" style={{ color: sendResult.ok ? "#22c55e" : "#ef4444" }}>
            {sendResult.msg}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Audio Panel ──────────────────────────────────────────────────────────────
function AudioPanel() {
  const { analysis, start, stop } = useAudioContext();
  const { bars, bpm, energy, genre, mood, structure, energyTrend, isListening, error } = analysis;

  const barColors = ["#3b82f6", "#06b6d4", "#22c55e", "#f59e0b", "#ef4444", "#a855f7"];

  const energyGradient = energy > 0.7
    ? "linear-gradient(90deg, #f59e0b, #ef4444)"
    : energy > 0.4
    ? "linear-gradient(90deg, #22c55e, #f59e0b)"
    : "linear-gradient(90deg, #3b82f6, #22c55e)";

  const energyColor = energy > 0.7 ? "#ef4444" : energy > 0.4 ? "#f59e0b" : "#22c55e";

  const energyLabel =
    energy > 0.75 ? "CRITICAL" :
    energy > 0.55 ? "HIGH" :
    energy > 0.35 ? "MED" : "LOW";

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Audio Analysis" icon="Activity" accent="#a855f7" />

      {/* Control bar */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-zinc-900 border rounded"
        style={{ borderColor: isListening ? "rgba(168,85,247,0.4)" : "rgba(63,63,70,0.8)" }}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${isListening ? "bg-green-400 animate-pulse" : "bg-zinc-600"}`} />
        <span className="font-display text-[10px] tracking-widest text-zinc-500">
          {isListening ? "ЗАХВАТ АУДИО" : "МИК ОТКЛЮЧЁН"}
        </span>
        <button
          onClick={isListening ? stop : start}
          className="px-3 py-1 text-[10px] font-display tracking-widest border rounded transition-all"
          style={{
            borderColor: isListening ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)",
            color: isListening ? "#ef4444" : "#22c55e",
            background: isListening ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
          }}
        >
          {isListening ? "■ СТОП" : "▶ СЛУШАТЬ"}
        </button>
        <div className="flex-1" />
        {bpm > 0 ? (
          <>
            <span className="font-mono-tech text-sm" style={{ color: "#a855f7" }}>{bpm}</span>
            <span className="font-mono-tech text-[10px] text-zinc-500">BPM</span>
          </>
        ) : (
          <span className="font-mono-tech text-[10px] text-zinc-600">— BPM</span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 px-3 py-2 bg-red-950/40 border border-red-500/30 rounded">
          <span className="font-mono-tech text-[10px] text-red-400">⚠ {error}</span>
        </div>
      )}

      {/* Spectrum visualizer */}
      <div className="relative flex items-end gap-0.5 px-1 bg-black/60 rounded border border-zinc-800 mb-4 overflow-hidden"
        style={{ height: 130 }}>
        {/* Reflection */}
        <div className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
          style={{ background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }} />
        {bars.map((v, i) => {
          const colIdx = Math.floor(i / (bars.length / barColors.length));
          const col = barColors[colIdx];
          return (
            <div key={i} className="flex-1 flex flex-col-reverse">
              <div className="rounded-t-sm"
                style={{
                  height: `${Math.max(v * 100, 2)}%`,
                  background: col,
                  opacity: isListening ? 0.6 + v * 0.4 : 0.15,
                  transition: "height 0.05s ease-out, opacity 0.3s",
                  boxShadow: isListening && v > 0.5 ? `0 -4px 10px ${col}66` : "none",
                }}
              />
            </div>
          );
        })}
        {!isListening && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-display text-[10px] tracking-widest text-zinc-600">НАЖМИТЕ СЛУШАТЬ</span>
          </div>
        )}
      </div>

      {/* AI Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { label: "ЖАНР", value: genre, color: "#06b6d4" },
          { label: "ТЕМП", value: bpm > 0 ? `${bpm} BPM` : "—", color: "#f59e0b" },
          { label: "ЭНЕРГИЯ", value: energyLabel, color: energyColor },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 p-2 rounded text-center">
            <div className="font-display text-[9px] tracking-widest text-zinc-500 mb-1">{label}</div>
            <div className="font-mono-tech text-xs" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Mood + Structure */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-zinc-900 border p-2 rounded" style={{ borderColor: `${MOOD_COLORS[mood] || "#27272a"}44` }}>
          <div className="font-display text-[9px] tracking-widest text-zinc-500 mb-1">НАСТРОЕНИЕ</div>
          <div className="font-mono-tech text-xs" style={{ color: MOOD_COLORS[mood] || "#52525b" }}>
            {MOOD_LABELS[mood] || mood}
          </div>
        </div>
        <div className="bg-zinc-900 border p-2 rounded" style={{ borderColor: `${STRUCTURE_COLORS[structure] || "#27272a"}44` }}>
          <div className="font-display text-[9px] tracking-widest text-zinc-500 mb-1">СТРУКТУРА</div>
          <div className="flex items-center gap-1.5">
            <div className="font-mono-tech text-xs" style={{ color: STRUCTURE_COLORS[structure] || "#52525b" }}>
              {STRUCTURE_LABELS[structure] || structure}
            </div>
            <span className="font-mono-tech text-[10px] text-zinc-600">
              {energyTrend === "rising" ? "↑" : energyTrend === "falling" ? "↓" : "→"}
            </span>
          </div>
        </div>
      </div>

      {/* Energy bar */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="font-display text-[9px] tracking-widest text-zinc-500">УРОВЕНЬ ЭНЕРГИИ</span>
          <span className="font-mono-tech text-[10px]" style={{ color: energyColor }}>{Math.round(energy * 100)}%</span>
        </div>
        <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-150"
            style={{
              width: `${energy * 100}%`,
              background: energyGradient,
              boxShadow: isListening ? `0 0 8px ${energyColor}88` : "none",
            }}
          />
        </div>
      </div>

      {/* Frequency bands */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "BASS", range: [0, 10], color: "#3b82f6" },
          { label: "MID", range: [10, 22], color: "#22c55e" },
          { label: "HIGH", range: [22, 32], color: "#a855f7" },
        ].map(({ label, range, color }) => {
          const avg = bars.slice(range[0], range[1]).reduce((a, b) => a + b, 0) / (range[1] - range[0]);
          return (
            <div key={label} className="bg-zinc-900 border border-zinc-800 p-2 rounded">
              <div className="flex justify-between mb-1">
                <span className="font-display text-[9px] tracking-widest text-zinc-600">{label}</span>
                <span className="font-mono-tech text-[9px]" style={{ color }}>{Math.round(avg * 100)}%</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-100"
                  style={{ width: `${avg * 100}%`, background: color, boxShadow: `0 0 4px ${color}88` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Library Panel ────────────────────────────────────────────────────────────
const TYPE_COLORS: Record<string, string> = {
  "LED Par": "#06b6d4",
  "Moving Head": "#a855f7",
  "Strobe": "#ef4444",
  "Wash": "#22c55e",
  "Spot": "#f59e0b",
  "Laser": "#3b82f6",
};

const GENRE_COLORS: Record<string, string> = {
  Techno: "#06b6d4", Jazz: "#f59e0b", Rock: "#ef4444",
  Ambient: "#a855f7", Pop: "#22c55e", House: "#3b82f6",
};

function FixtureCard({ fixture, isSelected, onSelect }: {
  fixture: FixtureProfile;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [channelValues, setChannelValues] = useState<number[]>(
    fixture.dmxProfile.map(a => a.defaultVal)
  );
  const col = TYPE_COLORS[fixture.type] || "#06b6d4";

  const updateChannel = (idx: number, val: number) => {
    setChannelValues(prev => { const n = [...prev]; n[idx] = val; return n; });
  };

  const exportDMX = useCallback(() => {
    const lines = [
      `# ${fixture.manufacturer} ${fixture.model}`,
      `# Тип: ${fixture.type} | ${fixture.channels}ch | ${fixture.power}W`,
      "",
      ...fixture.dmxProfile.map((a, i) => `CH${String(a.channel).padStart(3, "0")} ${String(channelValues[i]).padStart(3, " ")}  ; ${a.name}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fixture.manufacturer}_${fixture.model.replace(/\s+/g, "_")}.dmx`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fixture, channelValues]);

  return (
    <div className="border rounded overflow-hidden transition-all cursor-pointer"
      style={{ borderColor: isSelected ? `${col}55` : "#27272a", background: isSelected ? `${col}06` : "transparent" }}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="w-1.5 h-8 rounded-full shrink-0" style={{ background: `${col}66` }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-display text-xs font-semibold" style={{ color: col }}>{fixture.model}</span>
            <span className="font-display text-[9px] tracking-widest px-1.5 py-0.5 rounded border"
              style={{ color: `${col}99`, borderColor: `${col}33` }}>{fixture.type}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono-tech text-[10px] text-zinc-600">{fixture.manufacturer}</span>
            <span className="font-mono-tech text-[10px] text-zinc-700">{fixture.channels}ch</span>
            <span className="font-mono-tech text-[10px] text-zinc-700">{fixture.power}W</span>
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); exportDMX(); }}
          className="px-2 py-1 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 hover:border-amber-500/40 hover:text-amber-400 rounded transition-all"
          title="Скачать DMX профиль"
        >
          <Icon name="Download" size={11} />
        </button>
      </div>

      {/* Expanded: DMX channel editor */}
      {isSelected && (
        <div className="px-3 pb-3 border-t border-zinc-800/60 pt-3 animate-fade-in"
          onClick={e => e.stopPropagation()}>
          <div className="text-[9px] font-display tracking-widest text-zinc-600 mb-2">DMX ПРОФИЛЬ — НАСТРОЙКА КАНАЛОВ</div>
          <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
            {fixture.dmxProfile.map((attr, idx) => (
              <div key={attr.channel} className="flex items-center gap-3">
                <span className="font-mono-tech text-[9px] w-5 text-zinc-700">{attr.channel}</span>
                <span className="font-display text-[10px] text-zinc-400 w-24 shrink-0 truncate">{attr.name}</span>
                <input type="range" min={attr.min} max={attr.max} value={channelValues[idx]}
                  onChange={e => updateChannel(idx, +e.target.value)}
                  className="flex-1 h-1 appearance-none bg-zinc-800 rounded cursor-pointer"
                  style={{ accentColor: col }}
                />
                <span className="font-mono-tech text-[10px] w-8 text-right" style={{ color: col }}>
                  {channelValues[idx]}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={exportDMX}
              className="flex-1 py-1.5 text-[10px] font-display tracking-widest border rounded flex items-center justify-center gap-1.5 transition-all hover:opacity-90"
              style={{ borderColor: `${col}44`, color: col, background: `${col}10` }}>
              <Icon name="Download" size={11} />
              СКАЧАТЬ DMX ПРОФИЛЬ
            </button>
            <button
              onClick={() => setChannelValues(fixture.dmxProfile.map(a => a.defaultVal))}
              className="px-3 py-1.5 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 rounded hover:text-zinc-300 transition-all"
            >
              СБРОС
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function LibraryPanel() {
  const [tab, setTab] = useState<"presets" | "fixtures">("presets");
  const [activePreset, setActivePreset] = useState<number | null>(1);
  const [activeFixture, setActiveFixture] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");

  const [presets, setPresets] = useState<ApiPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);

  useEffect(() => {
    presetsApi.list().then(data => { setPresets(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    await presetsApi.delete(id);
    setPresets(prev => prev.filter(p => p.id !== id));
    if (activePreset === id) setActivePreset(null);
    setDeleting(null);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const created = await presetsApi.create({
      name: newName.trim(), genre: "Custom", bpm: 120, color: "cyan",
      channels: Array(8).fill(0),
    });
    setPresets(prev => [...prev, created]);
    setActivePreset(created.id);
    setNewName("");
    setCreating(false);
  };

  const filteredPresets = presets.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.genre.toLowerCase().includes(search.toLowerCase())
  );

  const fixtureTypes = ["ALL", ...Array.from(new Set(FIXTURE_LIBRARY.map(f => f.type)))];
  const filteredFixtures = FIXTURE_LIBRARY.filter(f => {
    const matchSearch = f.model.toLowerCase().includes(search.toLowerCase()) ||
      f.manufacturer.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === "ALL" || f.type === typeFilter;
    return matchSearch && matchType;
  });

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Library" icon="BookOpen" accent="#f59e0b" />

      {/* Tab switcher */}
      <div className="flex gap-1 mb-3 p-1 bg-zinc-900 border border-zinc-800 rounded">
        {([["presets", "Пресеты"], ["fixtures", "Приборы"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => { setTab(id); setSearch(""); }}
            className="flex-1 py-1.5 text-[10px] font-display tracking-widest rounded transition-all"
            style={{
              background: tab === id ? "#f59e0b1a" : "transparent",
              color: tab === id ? "#f59e0b" : "#71717a",
              border: tab === id ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)}
        placeholder={tab === "presets" ? "Поиск пресета..." : "Поиск прибора..."}
        className="w-full mb-3 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded text-sm font-body text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/40"
      />

      {/* Presets tab */}
      {tab === "presets" && (
        <>
          <div className="flex-1 overflow-y-auto space-y-2">
            {loading && <div className="text-center py-8"><span className="font-mono-tech text-[10px] text-zinc-600 animate-pulse">ЗАГРУЗКА...</span></div>}
            {!loading && filteredPresets.map(preset => {
              const col = GENRE_COLORS[preset.genre] || "#06b6d4";
              const isActive = activePreset === preset.id;
              return (
                <div key={preset.id} onClick={() => setActivePreset(isActive ? null : preset.id)}
                  className="p-3 border rounded cursor-pointer transition-all"
                  style={{ borderColor: isActive ? `${col}44` : "#27272a", background: isActive ? `${col}08` : "transparent" }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-sm font-semibold" style={{ color: col }}>{preset.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-display tracking-widest px-1.5 py-0.5 rounded border"
                        style={{ color: `${col}bb`, borderColor: `${col}33` }}>{preset.genre}</span>
                      <button onClick={e => handleDelete(preset.id, e)}
                        className="text-zinc-700 hover:text-red-400 transition-colors"
                        style={{ opacity: deleting === preset.id ? 0.4 : 1 }}>
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-mono-tech text-xs text-zinc-500">{preset.bpm} BPM</span>
                    <div className="flex gap-0.5 flex-1">
                      {preset.channels.map((v, i) => (
                        <div key={i} className="flex-1 rounded-sm"
                          style={{ height: 12, background: `${col}${Math.floor((v / 255) * 0.7 * 255 + 40).toString(16).padStart(2, "0")}` }}
                        />
                      ))}
                    </div>
                  </div>
                  {isActive && (
                    <div className="mt-2">
                      <button className="w-full py-1.5 text-[10px] font-display tracking-widest border rounded"
                        style={{ borderColor: `${col}50`, color: col, background: `${col}12` }}>
                        ЗАГРУЗИТЬ В DMX
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
              placeholder="Имя нового пресета..."
              className="flex-1 px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-sm font-body text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/40"
            />
            <button onClick={handleCreate} disabled={creating || !newName.trim()}
              className="px-3 py-1.5 text-[10px] font-display tracking-widest border rounded transition-all"
              style={{
                borderColor: newName.trim() ? "rgba(245,158,11,0.5)" : "#27272a",
                color: newName.trim() ? "#f59e0b" : "#52525b",
                background: newName.trim() ? "rgba(245,158,11,0.08)" : "transparent",
              }}>
              {creating ? "..." : "+ СОЗДАТЬ"}
            </button>
          </div>
        </>
      )}

      {/* Fixtures tab */}
      {tab === "fixtures" && (
        <>
          {/* Type filter */}
          <div className="flex gap-1 mb-3 flex-wrap">
            {fixtureTypes.map(type => (
              <button key={type} onClick={() => setTypeFilter(type)}
                className="px-2 py-0.5 text-[9px] font-display tracking-widest border rounded transition-all"
                style={{
                  borderColor: typeFilter === type ? `${TYPE_COLORS[type] || "#f59e0b"}55` : "#27272a",
                  color: typeFilter === type ? (TYPE_COLORS[type] || "#f59e0b") : "#52525b",
                  background: typeFilter === type ? `${TYPE_COLORS[type] || "#f59e0b"}10` : "transparent",
                }}
              >
                {type}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {filteredFixtures.map(fixture => (
              <FixtureCard key={fixture.id} fixture={fixture}
                isSelected={activeFixture === fixture.id}
                onSelect={() => setActiveFixture(activeFixture === fixture.id ? null : fixture.id)}
              />
            ))}
          </div>

          <div className="mt-2 px-2 py-1.5 bg-zinc-900/60 border border-zinc-800 rounded text-center">
            <span className="font-mono-tech text-[9px] text-zinc-600">{FIXTURE_LIBRARY.length} приборов в базе · Нажмите для настройки DMX</span>
          </div>
        </>
      )}
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
  const [connected, setConnected] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    settingsApi.get().then((cfg: ApiSettings) => {
      if (cfg.artnet_ip)       setIp(cfg.artnet_ip);
      if (cfg.artnet_port)     setPort(cfg.artnet_port);
      if (cfg.artnet_universe) setUniverse(cfg.artnet_universe);
      if (cfg.ai_sensitivity)  setAiSensitivity(Number(cfg.ai_sensitivity));
      if (cfg.ai_smoothing)    setSmoothing(Number(cfg.ai_smoothing));
      if (cfg.beat_sync)       setBeatSync(cfg.beat_sync === "true");
      if (cfg.auto_preset)     setAutoPreset(cfg.auto_preset === "true");
    }).catch(() => {});
  }, []);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      await settingsApi.save({
        artnet_ip: ip, artnet_port: port, artnet_universe: universe,
        ai_sensitivity: String(aiSensitivity), ai_smoothing: String(smoothing),
        beat_sync: String(beatSync), auto_preset: String(autoPreset),
      });
      setSaving(false);
      setSavedAt(new Date().toLocaleTimeString("ru-RU"));
    }, 800);
  }, [ip, port, universe, aiSensitivity, smoothing, beatSync, autoPreset]);

  useEffect(() => { scheduleSave(); }, [scheduleSave]);

  const handlePing = async () => {
    setPinging(true);
    setPingResult(null);
    const res = await artnetApi.test(ip, Number(port), Number(universe));
    setConnected(res.ok);
    setPingResult(res.ok ? `OK → ${ip}:${port}` : `Ошибка: ${res.error}`);
    if (res.ok) {
      await historyApi.add("auto", `Art-Net PING OK → ${ip}:${port} universe ${universe}`);
    }
    setPinging(false);
  };

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
        {pingResult && (
          <div className="mb-2 px-2 py-1 rounded text-[10px] font-mono-tech"
            style={{ background: connected ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                     color: connected ? "#22c55e" : "#ef4444", border: `1px solid ${connected ? "#22c55e" : "#ef4444"}22` }}>
            {pingResult}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <button onClick={handlePing} disabled={pinging}
            className="flex-1 py-1.5 text-[10px] font-display tracking-widest border rounded transition-all"
            style={{ borderColor: "rgba(6,182,212,0.5)", color: "#06b6d4", background: "rgba(6,182,212,0.08)" }}
          >
            {pinging ? "PING..." : "PING / TEST"}
          </button>
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

      {/* Save status */}
      <div className="px-3 py-2 bg-zinc-900 border border-zinc-800 rounded flex items-center justify-between">
        <span className="font-display text-[9px] tracking-widest text-zinc-600">АВТОСОХРАНЕНИЕ В БД</span>
        <span className="font-mono-tech text-[10px]" style={{ color: saving ? "#f59e0b" : "#22c55e" }}>
          {saving ? "СОХРАНЕНИЕ..." : savedAt ? `OK ${savedAt}` : "—"}
        </span>
      </div>
    </div>
  );
}

// ─── History Panel ────────────────────────────────────────────────────────────
function HistoryPanel() {
  const typeConfig: Record<string, { label: string; color: string; icon: string }> = {
    ai:     { label: "AI",   color: "#a855f7", icon: "Cpu"  },
    auto:   { label: "AUTO", color: "#06b6d4", icon: "Zap"  },
    manual: { label: "USER", color: "#f59e0b", icon: "User" },
  };

  const [events, setEvents] = useState<ApiEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [clearing, setClearing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const params = typeFilter !== "all" ? { type: typeFilter, limit: 100 } : { limit: 100 };
    const res = await historyApi.list(params);
    setEvents(res.events);
    setTotal(res.total);
    setLoading(false);
  }, [typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleClear = async () => {
    setClearing(true);
    await historyApi.clear();
    setEvents([]);
    setTotal(0);
    setClearing(false);
  };

  const formatTime = (iso: string) => {
    try { return new Date(iso).toLocaleTimeString("ru-RU"); } catch { return iso; }
  };

  return (
    <div className="h-full flex flex-col">
      <PanelHeader title="Event Log" icon="Clock" accent="#3b82f6" />

      <div className="flex gap-2 mb-3 flex-wrap">
        {([["all", "ВСЕ", "#52525b"], ["ai", "AI", "#a855f7"], ["auto", "AUTO", "#06b6d4"], ["manual", "USER", "#f59e0b"]] as const).map(([id, label, col]) => (
          <button key={id} onClick={() => setTypeFilter(id)}
            className="flex items-center gap-1.5 px-2 py-1 border rounded transition-all"
            style={{
              borderColor: typeFilter === id ? `${col}55` : `${col}22`,
              background: typeFilter === id ? `${col}12` : "transparent",
              color: typeFilter === id ? col : `${col}88`,
            }}>
            <span className="font-display text-[9px] tracking-widest">{label}</span>
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={handleClear} disabled={clearing}
          className="px-2 py-1 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 hover:border-red-500/30 hover:text-red-400 rounded transition-all">
          {clearing ? "..." : "ОЧИСТИТЬ"}
        </button>
        <button onClick={load}
          className="px-2 py-1 text-[10px] font-display tracking-widest border border-zinc-800 text-zinc-500 hover:border-cyan-500/30 hover:text-cyan-400 rounded transition-all">
          <Icon name="RefreshCw" size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2">
        {loading && <div className="text-center py-8"><span className="font-mono-tech text-[10px] text-zinc-600 animate-pulse">ЗАГРУЗКА...</span></div>}
        {!loading && events.length === 0 && (
          <div className="text-center py-8">
            <span className="font-mono-tech text-[10px] text-zinc-700">ИСТОРИЯ ПУСТА</span>
          </div>
        )}
        {!loading && events.map((event, i) => {
          const c = typeConfig[event.event_type] || typeConfig.manual;
          return (
            <div key={event.id}
              className="flex gap-3 p-2.5 border border-zinc-800 rounded hover:bg-zinc-900/50 transition-all"
              style={{ animationDelay: `${i * 0.03}s` }}
            >
              <div className="shrink-0 pt-0.5">
                <Icon name={c.icon as Parameters<typeof Icon>[0]["name"]} size={13} style={{ color: c.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="font-display text-[9px] tracking-widest" style={{ color: c.color }}>{c.label}</span>
                  <span className="font-mono-tech text-[10px] text-zinc-600">{formatTime(event.created_at)}</span>
                </div>
                <p className="font-body text-xs text-zinc-300 leading-snug">{event.message}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 p-2 bg-zinc-900 border border-zinc-800 rounded text-center">
        <span className="font-mono-tech text-[10px] text-zinc-600">{total} событий в базе</span>
      </div>
    </div>
  );
}

// ─── Auto Scene Panel ─────────────────────────────────────────────────────────

const MOOD_LABELS: Record<MoodType, string> = {
  aggressive:  "АГРЕССИВНОЕ",
  euphoric:    "ЭЙФОРИЯ",
  dark:        "ТЁМНОЕ",
  melancholic: "МЕЛАНХОЛИЯ",
  tense:       "НАПРЯЖЕНИЕ",
  relaxed:     "РАССЛАБЛЕНИЕ",
  hypnotic:    "ГИПНОЗ",
  energetic:   "ЭНЕРГИЯ",
};

const MOOD_COLORS: Record<MoodType, string> = {
  aggressive:  "#ef4444",
  euphoric:    "#06b6d4",
  dark:        "#6366f1",
  melancholic: "#3b82f6",
  tense:       "#f97316",
  relaxed:     "#22c55e",
  hypnotic:    "#a855f7",
  energetic:   "#f59e0b",
};

const STRUCTURE_LABELS: Record<TrackStructure, string> = {
  intro:      "ИНТРО",
  buildup:    "BUILD-UP",
  drop:       "DROP",
  breakdown:  "BREAKDOWN",
  outro:      "АУТРО",
  unknown:    "АНАЛИЗ...",
};

const STRUCTURE_COLORS: Record<TrackStructure, string> = {
  intro:      "#3b82f6",
  buildup:    "#f97316",
  drop:       "#ef4444",
  breakdown:  "#6366f1",
  outro:      "#22c55e",
  unknown:    "#52525b",
};

const RISK_COLORS = { low: "#22c55e", medium: "#f59e0b", high: "#ef4444" };
const ROLE_LABELS: Record<string, string> = {
  support: "ПОДДЕРЖКА", accent: "АКЦЕНТ", build: "НАГНЕТАНИЕ",
  release: "РАЗРЯДКА", reset: "СБРОС",
};
const PHASE_LABELS: Record<string, string> = {
  exposition: "ЭКСПОЗИЦИЯ", development: "РАЗВИТИЕ", tension: "НАПРЯЖЕНИЕ",
  climax: "КУЛЬМИНАЦИЯ", release: "РАЗРЯДКА", resolution: "ЗАВЕРШЕНИЕ",
};

function AutoScenePanel() {
  const { analysis, start, stop, triggerShazam } = useAudioContext();
  const { mood, structure, structureProgress, energyTrend, bpm, energy, genre, trackFeatures, shazam, isListening, error } = analysis;

  // ─── Director parameters ──
  const [eventType, setEventType] = useState<EventType>("club");
  const [venueSize, setVenueSize] = useState<VenueSize>("medium");
  const [showPolicy, setShowPolicy] = useState<ShowPolicy>("balanced");
  const [directorMode, setDirectorMode] = useState<DirectorMode>("auto");
  const [artistStyle, setArtistStyle] = useState("Electronic / Club");
  const [crowdLevel, setCrowdLevel] = useState(0.6);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // RapidAPI ключ — хранится в localStorage
  const [rapidApiKey, setRapidApiKey] = useState<string>(() => localStorage.getItem("rapidapi_key") ?? "");
  const [keyInputOpen, setKeyInputOpen] = useState(false);
  const saveApiKey = (val: string) => {
    setRapidApiKey(val);
    localStorage.setItem("rapidapi_key", val);
  };

  const [autoSend, setAutoSend] = useState(false);
  const [fixtures, setFixtures] = useState<FixtureInScene[]>(getDefaultSceneFixtures);
  const [scene, setScene] = useState<GeneratedScene | null>(null);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [sendInterval, setSendInterval] = useState(2000);

  const lastSceneKeyRef = useRef<string>("");
  const autoSendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const directorOptions = {
    event_type: eventType,
    venue_size: venueSize,
    show_policy: showPolicy,
    mode: directorMode,
    artist_style: artistStyle,
    crowd_level: crowdLevel,
    current_scene: scene?.name ?? "none",
  };

  // Генерируем сцену через AI-режиссёра
  useEffect(() => {
    if (!isListening) return;
    const newScene = generateScene(analysis, fixtures, directorOptions);
    setScene(newScene);
    // Прокидываем цвета в 3D-сцену через глобальный объект
    if (newScene.fixtureStates.length > 0) {
      const colorMap: Record<string, string> = {};
      newScene.fixtureStates.forEach((fs, idx) => {
        colorMap[String(idx)] = fs.color;
        colorMap[String(fs.fixtureId)] = fs.color;
      });
      (window as Record<string, unknown>).__aiSceneColors = colorMap;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, fixtures, eventType, venueSize, showPolicy, directorMode, artistStyle, crowdLevel, isListening]);

  // Авто-отправка DMX
  useEffect(() => {
    if (autoSendTimerRef.current) clearInterval(autoSendTimerRef.current);
    if (!autoSend || !isListening) return;

    autoSendTimerRef.current = setInterval(async () => {
      if (!scene) return;
      const key = `${scene.mood}_${scene.structure}`;
      const channels = scene.dmxValues.slice(0, 16);
      setSending(true);
      const res = await artnetApi.send(channels);
      if (res.ok) {
        setLastSent(new Date().toLocaleTimeString("ru-RU"));
        if (key !== lastSceneKeyRef.current) {
          lastSceneKeyRef.current = key;
          const ds = scene.directorScene;
          await historyApi.add("ai",
            `[AI Director] ${scene.name} · ${ds.analysis.dramaturgy_phase} · confidence ${Math.round(ds.confidence * 100)}%`,
            { mood: scene.mood, structure: scene.structure, bpm, phase: ds.analysis.dramaturgy_phase, risk: ds.analysis.risk_level }
          );
        }
      }
      setSending(false);
    }, sendInterval);

    return () => {
      if (autoSendTimerRef.current) clearInterval(autoSendTimerRef.current);
    };
  }, [autoSend, isListening, scene, sendInterval, bpm]);

  const handleManualSend = async () => {
    if (!scene) return;
    setSending(true);
    const channels = scene.dmxValues.slice(0, 16);
    const res = await artnetApi.send(channels);
    if (res.ok) {
      setLastSent(new Date().toLocaleTimeString("ru-RU"));
      await historyApi.add("manual",
        `Ручная отправка: ${scene.name}`,
        { mood: scene.mood, structure: scene.structure, policy: showPolicy }
      );
    }
    setSending(false);
  };

  const moodColor = MOOD_COLORS[mood] || "#52525b";
  const structureColor = STRUCTURE_COLORS[structure] || "#52525b";
  const ds = scene?.directorScene;

  return (
    <div className="h-full flex flex-col gap-2.5 overflow-y-auto pr-0.5">
      <PanelHeader title="AI Director" icon="Sparkles" accent="#a855f7" />

      {/* ─── Статус + управление микрофоном ─── */}
      <div className="flex items-center gap-3 p-2.5 bg-zinc-900 border rounded"
        style={{ borderColor: isListening ? "rgba(168,85,247,0.4)" : "rgba(63,63,70,0.8)" }}>
        <div className={`w-2 h-2 rounded-full shrink-0 ${isListening ? "bg-green-400 animate-pulse" : "bg-zinc-600"}`} />
        <div className="flex-1">
          <div className="font-display text-[10px] tracking-widest text-zinc-500">
            {isListening ? "AI DIRECTOR · ACTIVE" : "AI DIRECTOR · STANDBY"}
          </div>
          {isListening && ds && (
            <div className="font-mono-tech text-[9px] text-zinc-600 mt-0.5">
              confidence {Math.round(ds.confidence * 100)}% · {ds.analysis.dominant_signal.replace(/_/g, " ")}
            </div>
          )}
        </div>
        <button onClick={isListening ? stop : start}
          className="px-3 py-1 text-[10px] font-display tracking-widest border rounded transition-all"
          style={{
            borderColor: isListening ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)",
            color: isListening ? "#ef4444" : "#22c55e",
            background: isListening ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
          }}>
          {isListening ? "■ СТОП" : "▶ СЛУШАТЬ"}
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-950/40 border border-red-500/30 rounded">
          <span className="font-mono-tech text-[10px] text-red-400">⚠ {error}</span>
        </div>
      )}

      {/* ─── Shazam ─── */}
      <div className="bg-zinc-900 border rounded overflow-hidden"
        style={{ borderColor: shazam.status === "matched" ? "rgba(34,197,94,0.3)" : "rgba(63,63,70,0.7)" }}>

        {/* Заголовок + название трека */}
        <div className="px-2.5 pt-2 pb-1.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-display text-[9px] tracking-widest"
                style={{ color: shazam.status === "matched" ? "#22c55e" : shazam.status === "loading" ? "#f59e0b" : shazam.status === "error" ? "#ef4444" : "#52525b" }}>
                SHAZAM
              </span>
              {shazam.status === "loading" && <span className="font-mono-tech text-[8px] text-amber-400 animate-pulse">СЛУШАЮ...</span>}
              {shazam.status === "no_match" && <span className="font-mono-tech text-[8px] text-zinc-600">НЕ НАЙДЕНО</span>}
              {shazam.status === "error" && (
                <span className="font-mono-tech text-[8px] text-red-400 cursor-pointer" onClick={() => setKeyInputOpen(v => !v)}>⚠ КЛЮЧ?</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setKeyInputOpen(v => !v)}
                className="px-1.5 py-0.5 font-display text-[7px] tracking-widest border border-zinc-700 rounded text-zinc-600 hover:text-zinc-400 transition-colors">
                KEY
              </button>
              <button onClick={triggerShazam}
                disabled={shazam.status === "loading" || !isListening || !rapidApiKey}
                className="px-2 py-0.5 font-display text-[8px] tracking-widest border rounded transition-all disabled:opacity-35"
                style={{ borderColor: "rgba(34,197,94,0.4)", color: "#22c55e", background: "rgba(34,197,94,0.06)" }}>
                ⚡
              </button>
            </div>
          </div>

          {/* Название трека — всегда видно если есть результат */}
          {shazam.track ? (
            <div className="flex items-center gap-2 mt-0.5">
              {shazam.track.cover_url && (
                <img src={shazam.track.cover_url} alt="cover"
                  className="w-8 h-8 rounded object-cover shrink-0 border border-zinc-700" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-mono-tech text-[11px] text-white font-bold truncate leading-tight">
                  {shazam.track.title}
                </div>
                <div className="font-body text-[10px] text-zinc-400 truncate leading-tight">
                  {shazam.track.artist}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {shazam.track.genre && <span className="font-display text-[7px] tracking-widest text-cyan-500">{shazam.track.genre}</span>}
                  {shazam.track.bpm > 0 && <span className="font-mono-tech text-[7px] text-amber-400">{shazam.track.bpm} BPM</span>}
                  {shazam.track.key && <span className="font-mono-tech text-[7px] text-purple-400">{shazam.track.key}</span>}
                </div>
              </div>
            </div>
          ) : (
            <div className="font-display text-[8px] tracking-widest text-zinc-700 mt-0.5">
              {!rapidApiKey ? "Нажми KEY → добавь RapidAPI ключ" :
               !isListening ? "Включи микрофон" :
               shazam.status === "idle" ? "Первое распознавание через 8 сек..." :
               shazam.status === "loading" ? "Анализирую..." :
               "Трек не определён"}
            </div>
          )}
        </div>

        {/* Поле ввода ключа */}
        {keyInputOpen && (
          <div className="px-2.5 pb-2 border-t border-zinc-800 pt-2">
            <div className="font-display text-[8px] tracking-widest text-zinc-600 mb-1">
              RAPIDAPI KEY — <a href="https://rapidapi.com/search/shazam-core" target="_blank" rel="noreferrer" className="text-cyan-700 hover:text-cyan-500">получить на rapidapi.com</a>
            </div>
            <div className="flex gap-1.5">
              <input
                type="password"
                value={rapidApiKey}
                onChange={e => saveApiKey(e.target.value)}
                placeholder="Вставь X-RapidAPI-Key..."
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] font-mono-tech text-zinc-300 focus:outline-none focus:border-green-500/50"
              />
              <button onClick={() => { saveApiKey(rapidApiKey); setKeyInputOpen(false); }}
                className="px-2 py-1 font-display text-[8px] tracking-widest border border-green-500/40 rounded text-green-400 hover:bg-green-500/10 transition-colors">
                ✓
              </button>
            </div>
            {rapidApiKey && <div className="font-mono-tech text-[8px] text-green-600 mt-1">✓ Ключ сохранён в браузере</div>}
          </div>
        )}

        {/* Нет ключа — подсказка */}
        {!rapidApiKey && !keyInputOpen && (
          <div className="px-2.5 pb-2.5">
            <button onClick={() => setKeyInputOpen(true)}
              className="w-full py-1.5 font-display text-[8px] tracking-widest border border-dashed border-zinc-700 rounded text-zinc-600 hover:text-zinc-400 hover:border-zinc-500 transition-colors">
              + ДОБАВИТЬ RAPIDAPI KEY ДЛЯ РАСПОЗНАВАНИЯ
            </button>
          </div>
        )}


      </div>

      {/* ─── Музыкальный анализ ─── */}
      <div className="grid grid-cols-2 gap-2">
        <div className="p-2.5 bg-zinc-900 border rounded flex flex-col gap-1"
          style={{ borderColor: `${moodColor}33` }}>
          <span className="font-display text-[9px] tracking-widest text-zinc-500">НАСТРОЕНИЕ</span>
          <span className="font-mono-tech text-sm font-bold" style={{ color: moodColor }}>{MOOD_LABELS[mood] || mood}</span>
          <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${energy * 100}%`, background: moodColor }} />
          </div>
        </div>
        <div className="p-2.5 bg-zinc-900 border rounded flex flex-col gap-1"
          style={{ borderColor: `${structureColor}33` }}>
          <span className="font-display text-[9px] tracking-widest text-zinc-500">СТРУКТУРА</span>
          <span className="font-mono-tech text-sm font-bold" style={{ color: structureColor }}>{STRUCTURE_LABELS[structure] || structure}</span>
          <div className="h-0.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${structureProgress * 100}%`, background: structureColor }} />
          </div>
        </div>
      </div>

      {/* ─── Музыкальные параметры ─── */}
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: "BPM",     value: bpm > 0 ? String(bpm) : "—", color: "#f59e0b" },
          { label: "ЖАНР",    value: genre,                         color: "#06b6d4" },
          { label: "ЭНЕРГИЯ", value: `${Math.round(energy * 100)}%`, color: "#22c55e" },
          { label: "ТРЕНД",   value: energyTrend === "rising" ? "↑ РОСТ" : energyTrend === "falling" ? "↓ СПАД" : "→ СТАБ", color: "#a855f7" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-zinc-900 border border-zinc-800 p-1.5 rounded text-center">
            <div className="font-display text-[8px] tracking-widest text-zinc-600 mb-0.5">{label}</div>
            <div className="font-mono-tech text-[10px]" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ─── Track Features ─── */}
      {isListening && (
        <div className="p-2.5 bg-zinc-900 border border-zinc-800 rounded">
          <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-2">TRACK FEATURES</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {[
              { label: "KICK",     value: trackFeatures.kick_density,        color: "#ef4444" },
              { label: "BASS",     value: trackFeatures.bass_energy,         color: "#3b82f6" },
              { label: "SNARE",    value: trackFeatures.snare_density,       color: "#f97316" },
              { label: "VOCAL",    value: trackFeatures.vocal_presence,      color: "#22c55e" },
              { label: "BRIGHT",   value: trackFeatures.spectral_brightness, color: "#06b6d4" },
              { label: "DROP %",   value: trackFeatures.drop_probability,    color: "#a855f7" },
              { label: "FLUX",     value: trackFeatures.spectral_flux,       color: "#e879f9" },
              { label: "ONSET",    value: trackFeatures.onset_strength,      color: "#fbbf24" },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center gap-2">
                <span className="font-display text-[8px] tracking-widest text-zinc-600 w-10">{label}</span>
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-200"
                    style={{ width: `${value * 100}%`, background: color }} />
                </div>
                <span className="font-mono-tech text-[8px] w-6 text-right" style={{ color }}>{Math.round(value * 100)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── AI Director Analysis ─── */}
      {ds && isListening && (
        <div className="p-2.5 bg-zinc-900 border rounded" style={{ borderColor: "rgba(168,85,247,0.25)" }}>
          <div className="font-display text-[9px] tracking-widest text-purple-400 mb-2">ДРАМАТУРГИЯ</div>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <div className="bg-zinc-800/60 p-1.5 rounded text-center">
              <div className="font-display text-[8px] tracking-widest text-zinc-600">ФАЗА</div>
              <div className="font-mono-tech text-[9px] text-purple-300 mt-0.5">
                {PHASE_LABELS[ds.analysis.dramaturgy_phase] || ds.analysis.dramaturgy_phase}
              </div>
            </div>
            <div className="bg-zinc-800/60 p-1.5 rounded text-center">
              <div className="font-display text-[8px] tracking-widest text-zinc-600">РОЛЬ</div>
              <div className="font-mono-tech text-[9px] text-cyan-300 mt-0.5">
                {ROLE_LABELS[ds.analysis.lighting_role] || ds.analysis.lighting_role}
              </div>
            </div>
            <div className="bg-zinc-800/60 p-1.5 rounded text-center">
              <div className="font-display text-[8px] tracking-widest text-zinc-600">РИСК</div>
              <div className="font-mono-tech text-[9px] mt-0.5"
                style={{ color: RISK_COLORS[ds.analysis.risk_level] }}>
                {ds.analysis.risk_level.toUpperCase()}
              </div>
            </div>
          </div>
          {/* Цветовая палитра */}
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-display text-[8px] tracking-widest text-zinc-600">ПАЛИТРА</span>
            <div className="flex gap-1">
              {ds.parameters.color_palette.slice(0, 6).map((c, i) => (
                <div key={i} className="w-4 h-4 rounded border border-zinc-700"
                  style={{ background: c, boxShadow: `0 0 4px ${c}88` }} />
              ))}
            </div>
          </div>
          {/* Параметры */}
          <div className="grid grid-cols-3 gap-1">
            {[
              { label: "ДВИЖЕНИЕ", value: ds.parameters.movement.toUpperCase() },
              { label: "ТУМАН",    value: ds.parameters.fog.toUpperCase() },
              { label: "СТРОБ",    value: ds.parameters.strobe ? "ON" : "OFF" },
              { label: "ПЛОТНОСТЬ", value: ds.parameters.visual_density.toUpperCase() },
              { label: "ЛУЧ",     value: ds.parameters.beam_width.toUpperCase() },
              { label: "BPM SYNC", value: ds.parameters.tempo_sync ? "ON" : "OFF" },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <div className="font-display text-[7px] tracking-widest text-zinc-600">{label}</div>
                <div className="font-mono-tech text-[9px] text-zinc-300">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Активная сцена + приборы ─── */}
      {scene && isListening ? (
        <div className="p-2.5 bg-zinc-900 border rounded" style={{ borderColor: "rgba(168,85,247,0.3)" }}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-display text-[9px] tracking-widest text-purple-400">АКТИВНАЯ СЦЕНА</span>
            {sending && <span className="font-mono-tech text-[9px] text-amber-400 animate-pulse">TX...</span>}
            {lastSent && !sending && <span className="font-mono-tech text-[9px] text-green-500">✓ {lastSent}</span>}
          </div>
          <div className="font-mono-tech text-sm font-bold text-white mb-0.5">{scene.name}</div>
          <div className="font-body text-[10px] text-zinc-500 mb-2 leading-snug">{scene.description}</div>

          {/* Hint оператора */}
          {ds && (directorMode === "hybrid" || directorMode === "manual_hint") && (
            <div className="mb-2 px-2 py-1.5 bg-amber-950/30 border border-amber-500/20 rounded">
              <span className="font-mono-tech text-[9px] text-amber-400">
                ⚡ {ds.safety.manual_override_hint}
              </span>
            </div>
          )}

          {/* Safety restrictions */}
          {ds && ds.safety.restrictions_applied.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {ds.safety.restrictions_applied.map(r => (
                <span key={r} className="font-display text-[7px] tracking-widest px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded">
                  {r.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* Приборы */}
          <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
            {scene.fixtureStates.map(fs => (
              <div key={fs.fixtureId} className="flex items-center gap-2 px-2 py-1 bg-zinc-800/60 rounded">
                <div className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: fs.color, boxShadow: `0 0 5px ${fs.color}99` }} />
                <span className="font-mono-tech text-[9px] text-zinc-400 flex-1 truncate">{fs.fixtureName}</span>
                <span className="font-display text-[7px] tracking-widest text-zinc-600">{fs.fixtureType}</span>
                <span className="font-mono-tech text-[9px]" style={{ color: fs.color }}>{fs.intensity}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-4 bg-zinc-900 border border-zinc-800 rounded text-center">
          <span className="font-display text-[10px] tracking-widest text-zinc-600">
            {isListening ? "Инициализация AI режиссёра..." : "Включите микрофон для запуска AI"}
          </span>
        </div>
      )}

      {/* ─── Настройки шоу (сворачиваемые) ─── */}
      <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
        <button
          onClick={() => setSettingsOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors"
        >
          <span className="font-display text-[9px] tracking-widest text-zinc-500">ПАРАМЕТРЫ ШОУ</span>
          <Icon name={settingsOpen ? "ChevronUp" : "ChevronDown"} size={12} style={{ color: "#52525b" }} />
        </button>
        {settingsOpen && (
          <div className="px-3 pb-3 space-y-3 border-t border-zinc-800">
            {/* Event type */}
            <div>
              <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-1.5 mt-2">ТИП СОБЫТИЯ</div>
              <div className="flex flex-wrap gap-1">
                {(["club", "festival", "concert", "theatre", "party"] as EventType[]).map(et => (
                  <button key={et} onClick={() => setEventType(et)}
                    className="px-2 py-0.5 text-[9px] font-display tracking-widest border rounded transition-all"
                    style={{
                      borderColor: eventType === et ? "rgba(168,85,247,0.6)" : "rgba(63,63,70,0.8)",
                      color: eventType === et ? "#a855f7" : "#52525b",
                      background: eventType === et ? "rgba(168,85,247,0.1)" : "transparent",
                    }}>
                    {et.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Venue size */}
            <div>
              <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-1.5">РАЗМЕР ПЛОЩАДКИ</div>
              <div className="flex gap-1">
                {(["small", "medium", "large", "arena"] as VenueSize[]).map(vs => (
                  <button key={vs} onClick={() => setVenueSize(vs)}
                    className="flex-1 py-1 text-[9px] font-display tracking-widest border rounded transition-all"
                    style={{
                      borderColor: venueSize === vs ? "rgba(6,182,212,0.6)" : "rgba(63,63,70,0.8)",
                      color: venueSize === vs ? "#06b6d4" : "#52525b",
                      background: venueSize === vs ? "rgba(6,182,212,0.1)" : "transparent",
                    }}>
                    {vs.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Show policy */}
            <div>
              <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-1.5">ШОУ-ПОЛИТИКА</div>
              <div className="flex flex-wrap gap-1">
                {(["aggressive", "balanced", "theatrical", "safe"] as ShowPolicy[]).map(sp => {
                  const policyColors: Record<ShowPolicy, string> = {
                    aggressive: "#ef4444", balanced: "#22c55e",
                    theatrical: "#a855f7", safe: "#3b82f6",
                  };
                  return (
                    <button key={sp} onClick={() => setShowPolicy(sp)}
                      className="px-2 py-0.5 text-[9px] font-display tracking-widest border rounded transition-all"
                      style={{
                        borderColor: showPolicy === sp ? `${policyColors[sp]}88` : "rgba(63,63,70,0.8)",
                        color: showPolicy === sp ? policyColors[sp] : "#52525b",
                        background: showPolicy === sp ? `${policyColors[sp]}18` : "transparent",
                      }}>
                      {sp.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Director mode */}
            <div>
              <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-1.5">РЕЖИМ РЕЖИССЁРА</div>
              <div className="flex gap-1">
                {(["auto", "hybrid", "manual_hint"] as DirectorMode[]).map(dm => (
                  <button key={dm} onClick={() => setDirectorMode(dm)}
                    className="flex-1 py-1 text-[9px] font-display tracking-widest border rounded transition-all"
                    style={{
                      borderColor: directorMode === dm ? "rgba(245,158,11,0.6)" : "rgba(63,63,70,0.8)",
                      color: directorMode === dm ? "#f59e0b" : "#52525b",
                      background: directorMode === dm ? "rgba(245,158,11,0.1)" : "transparent",
                    }}>
                    {dm === "auto" ? "АВТО" : dm === "hybrid" ? "ГИБРИД" : "ПОДСКАЗКИ"}
                  </button>
                ))}
              </div>
            </div>

            {/* Crowd level */}
            <div>
              <div className="flex justify-between mb-1">
                <span className="font-display text-[9px] tracking-widest text-zinc-600">УРОВЕНЬ ЗАЛА</span>
                <span className="font-mono-tech text-[10px] text-green-400">{Math.round(crowdLevel * 100)}%</span>
              </div>
              <input type="range" min={0} max={100} value={Math.round(crowdLevel * 100)}
                onChange={e => setCrowdLevel(+e.target.value / 100)}
                className="w-full h-1 appearance-none bg-zinc-800 rounded cursor-pointer"
                style={{ accentColor: "#22c55e" }}
              />
            </div>

            {/* Artist style */}
            <div>
              <div className="font-display text-[9px] tracking-widest text-zinc-600 mb-1">СТИЛЬ АРТИСТА</div>
              <input
                type="text"
                value={artistStyle}
                onChange={e => setArtistStyle(e.target.value)}
                placeholder="Dark Techno, Melodic House..."
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[10px] font-mono-tech text-zinc-300 focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Автопилот DMX ─── */}
      <div className="p-2.5 bg-zinc-900 border rounded" style={{ borderColor: "rgba(6,182,212,0.25)" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-display text-[10px] tracking-widest text-cyan-400">АВТОПИЛОТ DMX</span>
          <div className="flex items-center gap-2">
            <span className="font-mono-tech text-[9px] text-zinc-600">{sendInterval}ms</span>
            <button onClick={() => setAutoSend(v => !v)}
              className="px-3 py-1 text-[10px] font-display tracking-widest border rounded transition-all"
              style={{
                borderColor: autoSend ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)",
                color: autoSend ? "#ef4444" : "#22c55e",
                background: autoSend ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
              }}>
              {autoSend ? "■ СТОП" : "▶ СТАРТ"}
            </button>
          </div>
        </div>
        <input type="range" min={500} max={5000} step={500} value={sendInterval}
          onChange={e => setSendInterval(+e.target.value)}
          className="w-full h-0.5 appearance-none bg-zinc-800 rounded cursor-pointer"
          style={{ accentColor: "#06b6d4" }}
        />
      </div>

      {/* ─── Кнопки управления ─── */}
      <div className="flex gap-2">
        <button onClick={handleManualSend} disabled={sending || !scene || !isListening}
          className="flex-1 py-2 font-display text-[10px] tracking-widest border rounded transition-all flex items-center justify-center gap-2"
          style={{
            borderColor: scene && isListening ? "rgba(168,85,247,0.5)" : "rgba(63,63,70,0.5)",
            color: scene && isListening ? "#a855f7" : "#52525b",
            background: scene && isListening ? "rgba(168,85,247,0.08)" : "transparent",
          }}>
          <Icon name="Send" size={11} />
          ОТПРАВИТЬ СЦЕНУ
        </button>
      </div>

      {/* ─── Конфигуратор приборов ─── */}
      <FixtureConfigurator fixtures={fixtures} onFixturesChange={setFixtures} scene={scene} />
    </div>
  );
}

// ─── Конфигуратор приборов (вынесен отдельно) ────────────────────────────────

const FIXTURE_TYPE_OPTIONS = [
  { value: "LED Par",          label: "LED Par (8ch)",        channels: 8  },
  { value: "LED Par 4ch",      label: "LED Par (4ch)",        channels: 4  },
  { value: "Moving Head",      label: "Moving Head (16ch)",   channels: 16 },
  { value: "Moving Head Wash", label: "MH Wash (16ch)",        channels: 16 },
  { value: "Strobe",           label: "Strobe (5ch)",         channels: 5  },
  { value: "Spot",             label: "Spot (8ch)",           channels: 8  },
  { value: "Wash",             label: "Wash (7ch)",           channels: 7  },
  { value: "Laser",            label: "Laser (6ch)",          channels: 6  },
  { value: "Hazer",            label: "Hazer/Fog (3ch)",      channels: 3  },
  { value: "LED Bar",          label: "LED Bar (4ch)",        channels: 4  },
];

const GROUP_COLORS: Record<FixtureGroup, string> = {
  front: "#06b6d4", mid: "#a855f7", back: "#ef4444",
  side: "#22c55e", effect: "#f59e0b", fill: "#3b82f6",
};

function FixtureConfigurator({
  fixtures,
  onFixturesChange,
  scene,
}: {
  fixtures: FixtureInScene[];
  onFixturesChange: (f: FixtureInScene[]) => void;
  scene: GeneratedScene | null;
}) {
  const [open, setOpen]         = useState(false);
  const [addName, setAddName]   = useState("");
  const [addType, setAddType]   = useState("LED Par");
  const [addCh, setAddCh]       = useState(nextChannel(fixtures));
  const [addChs, setAddChs]     = useState(8);
  const [addGroup, setAddGroup] = useState<FixtureGroup>("mid");

  const warnings = validateFixtures(fixtures);

  // Синхронизируем стартовый канал с реальной позицией
  const suggestedCh = nextChannel(fixtures);

  const addFixture = () => {
    if (addCh < 1 || addCh > 512 || addChs < 1) return;
    const id = fixtures.length > 0 ? Math.max(...fixtures.map(f => f.id)) + 1 : 1;
    onFixturesChange([...fixtures, {
      id, name: addName.trim() || `${addType} ${id}`,
      type: addType, dmxStartChannel: addCh,
      channels: addChs, group: addGroup,
    }]);
    setAddName("");
    setAddCh(addCh + addChs);
  };

  const removeFixture = (id: number) => {
    onFixturesChange(fixtures.filter(f => f.id !== id));
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
      {/* Заголовок */}
      <button className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-zinc-800/40 transition-colors"
        onClick={() => setOpen(v => !v)}>
        <div className="flex items-center gap-2">
          <span className="font-display text-[9px] tracking-widest text-zinc-500">
            ПРИБОРЫ ({fixtures.length})
          </span>
          {warnings.length > 0 && (
            <span className="font-mono-tech text-[8px] text-red-400">
              ⚠ {warnings.length} конфликт{warnings.length > 1 ? "а" : ""}
            </span>
          )}
          {scene && (
            <span className="font-mono-tech text-[8px] text-zinc-700">
              CH1-{Math.max(...fixtures.map(f => f.dmxStartChannel + f.channels - 1), 0)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={e => { e.stopPropagation(); onFixturesChange(getDefaultSceneFixtures()); }}
            className="font-display text-[7px] tracking-widest text-zinc-700 hover:text-amber-400 px-1.5 py-0.5 border border-zinc-800 rounded transition-colors"
            title="30 приборов (клуб)">30×RIG</button>
          <button onClick={e => { e.stopPropagation(); onFixturesChange(getSmallRigFixtures()); }}
            className="font-display text-[7px] tracking-widest text-zinc-700 hover:text-cyan-400 px-1.5 py-0.5 border border-zinc-800 rounded transition-colors"
            title="10 приборов (малый риг)">10×RIG</button>
          <Icon name={open ? "ChevronUp" : "ChevronDown"} size={11} style={{ color: "#52525b" }} />
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800">
          {/* Предупреждения о конфликтах */}
          {warnings.length > 0 && (
            <div className="px-2.5 py-2 border-b border-zinc-800 space-y-0.5">
              {warnings.map((w, i) => (
                <div key={i} className="font-mono-tech text-[8px] text-red-400">{w}</div>
              ))}
            </div>
          )}

          {/* Список приборов */}
          <div className="max-h-48 overflow-y-auto">
            {fixtures.map((f, idx) => {
              const fs = scene?.fixtureStates.find(s => s.fixtureId === f.id);
              const col = GROUP_COLORS[f.group ?? "mid"];
              return (
                <div key={f.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                  {/* Номер */}
                  <span className="font-mono-tech text-[8px] text-zinc-700 w-4 shrink-0">{idx + 1}</span>
                  {/* Индикатор активности */}
                  <div className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: fs && fs.intensity > 0 ? fs.color : "#27272a",
                      boxShadow: fs && fs.intensity > 0 ? `0 0 4px ${fs.color}` : "none",
                    }} />
                  {/* Название */}
                  <span className="font-mono-tech text-[9px] text-zinc-400 flex-1 truncate">{f.name}</span>
                  {/* Тип */}
                  <span className="font-display text-[7px] tracking-widest shrink-0" style={{ color: col }}>
                    {f.group?.toUpperCase() ?? "MID"}
                  </span>
                  {/* Каналы */}
                  <span className="font-mono-tech text-[8px] text-zinc-600 shrink-0 w-16 text-right">
                    CH{f.dmxStartChannel}–{f.dmxStartChannel + f.channels - 1}
                  </span>
                  {/* Яркость если идёт сцена */}
                  {fs && (
                    <span className="font-mono-tech text-[8px] shrink-0 w-8 text-right" style={{ color: fs.color }}>
                      {fs.intensity}%
                    </span>
                  )}
                  {/* Удалить */}
                  <button onClick={() => removeFixture(f.id)}
                    className="shrink-0 text-zinc-700 hover:text-red-500 transition-colors ml-1">
                    <Icon name="X" size={10} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Добавить прибор */}
          <div className="p-2.5 border-t border-zinc-800 space-y-2">
            <div className="font-display text-[8px] tracking-widest text-zinc-600">ДОБАВИТЬ ПРИБОР</div>
            <div className="grid grid-cols-2 gap-1.5">
              <input value={addName} onChange={e => setAddName(e.target.value)}
                placeholder="Название..."
                className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[9px] font-mono-tech text-zinc-300 focus:outline-none focus:border-cyan-500/50" />
              <select value={addType}
                onChange={e => {
                  const found = FIXTURE_TYPE_OPTIONS.find(o => o.value === e.target.value);
                  setAddType(e.target.value);
                  if (found) setAddChs(found.channels);
                }}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[9px] font-display tracking-widest text-zinc-300 focus:outline-none cursor-pointer">
                {FIXTURE_TYPE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select value={addGroup} onChange={e => setAddGroup(e.target.value as FixtureGroup)}
                className="bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[9px] font-display tracking-widest text-zinc-300 focus:outline-none cursor-pointer">
                {(["front","mid","back","side","effect","fill"] as FixtureGroup[]).map(g => (
                  <option key={g} value={g}>{g.toUpperCase()}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <span className="font-display text-[7px] tracking-widest text-zinc-600 shrink-0">CH</span>
                <input type="number" min={1} max={512} value={addCh}
                  onChange={e => setAddCh(+e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[9px] font-mono-tech text-zinc-300 focus:outline-none w-0" />
              </div>
              <div className="flex items-center gap-1">
                <span className="font-display text-[7px] tracking-widest text-zinc-600 shrink-0">×CH</span>
                <input type="number" min={1} max={32} value={addChs}
                  onChange={e => setAddChs(+e.target.value)}
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-1 text-[9px] font-mono-tech text-zinc-300 focus:outline-none w-0" />
              </div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={addFixture}
                className="flex-1 py-1.5 font-display text-[9px] tracking-widest border border-cyan-500/40 text-cyan-400 rounded hover:bg-cyan-500/10 transition-colors">
                + ДОБАВИТЬ
              </button>
              <div className="font-mono-tech text-[8px] text-zinc-700 flex items-center px-2">
                авто CH{suggestedCh}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Типы приборов для 3D-сцены ───────────────────────────────────────────────
const FIXTURE_TYPES: { type: Light3D["type"]; label: string; icon: string; defaultColor: string }[] = [
  { type: "par",    label: "LED Par",      icon: "Circle",      defaultColor: "#06b6d4" },
  { type: "moving", label: "Moving Head",  icon: "Crosshair",   defaultColor: "#a855f7" },
  { type: "strobe", label: "Strobe",       icon: "Zap",         defaultColor: "#ffffff" },
  { type: "wash",   label: "Wash",         icon: "Layers",      defaultColor: "#ef4444" },
  { type: "spot",   label: "Spot",         icon: "Sun",         defaultColor: "#f59e0b" },
  { type: "laser",  label: "Laser",        icon: "Scan",        defaultColor: "#00ff88" },
  { type: "hazer",  label: "Hazer/Fog",    icon: "Wind",        defaultColor: "#aaaaaa" },
];

// Иконка прибора в 3D-сцене
function FixtureIcon({ type, color, size = 16 }: { type: Light3D["type"]; color: string; size?: number }) {
  const iconMap: Record<Light3D["type"], string> = {
    par: "Circle", moving: "Crosshair", strobe: "Zap",
    wash: "Layers", spot: "Sun", laser: "Scan", hazer: "Wind",
  };
  return <Icon name={iconMap[type]} size={size} style={{ color }} />;
}

// ─── 3D Scene Panel ───────────────────────────────────────────────────────────
function Scene3DPanel() {
  const { analysis } = useAudioContext();
  const { trackFeatures, energy, isListening } = analysis;

  const [selected, setSelected]     = useState<number | null>(null);
  const [lights, setLights]         = useState<Light3D[]>(LIGHTS_3D);
  const [addMode, setAddMode]       = useState(false);
  const [addType, setAddType]       = useState<Light3D["type"]>("par");
  const [addName, setAddName]       = useState("");
  const [dragging, setDragging]     = useState<number | null>(null);
  const stageRef                    = useRef<HTMLDivElement>(null);
  const nextIdRef                   = useRef(LIGHTS_3D.length + 1);

  // Обновляем цвета приборов из AI Director через глобальный callback
  useEffect(() => {
    if (!isListening) return;
    // Получаем цвета из последней сцены через window (прокидывается из AutoScenePanel)
    const sceneColors = (window as Record<string, unknown>).__aiSceneColors as Record<string, string> | undefined;
    if (!sceneColors) return;
    setLights(prev => prev.map((l, idx) => {
      const col = sceneColors[String(idx)] ?? sceneColors[String(l.id)];
      if (col) return { ...l, liveColor: col, active: true, intensity: Math.round(energy * 100) };
      return l;
    }));
  }, [energy, isListening, trackFeatures.onset_strength]);

  const selectedLight = lights.find(l => l.id === selected);

  // Добавление прибора кликом по сцене
  const handleStageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!addMode) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
    const y = Math.round(((e.clientY - rect.top)  / rect.height) * 100);
    const ft = FIXTURE_TYPES.find(f => f.type === addType)!;
    const id = nextIdRef.current++;
    setLights(prev => [...prev, {
      id, type: addType,
      name: addName.trim() || `${ft.label} ${id}`,
      x, y, active: true,
      color: ft.defaultColor,
      intensity: 80,
    }]);
    setAddName("");
    setAddMode(false);
  };

  // Перетаскивание прибора
  const handleDragStart = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    setDragging(id);
  };

  const handleDragMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragging === null) return;
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(98, Math.max(2, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.min(98, Math.max(2, Math.round(((e.clientY - rect.top)  / rect.height) * 100)));
    setLights(prev => prev.map(l => l.id === dragging ? { ...l, x, y } : l));
  };

  const handleDragEnd = () => setDragging(null);

  // Удаление прибора
  const deleteLight = (id: number) => {
    setLights(prev => prev.filter(l => l.id !== id));
    if (selected === id) setSelected(null);
  };

  return (
    <div className="h-full flex flex-col gap-2 overflow-y-auto">
      <PanelHeader title="3D Scene" icon="Box" accent="#06b6d4" />

      {/* ─── Панель управления ─── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setAddMode(v => !v)}
          className="px-2.5 py-1 font-display text-[9px] tracking-widest border rounded transition-all flex items-center gap-1.5"
          style={{
            borderColor: addMode ? "rgba(6,182,212,0.6)" : "rgba(63,63,70,0.8)",
            color: addMode ? "#06b6d4" : "#52525b",
            background: addMode ? "rgba(6,182,212,0.08)" : "transparent",
          }}
        >
          <Icon name={addMode ? "MousePointer" : "Plus"} size={10} />
          {addMode ? "КЛИКНИ ПО СЦЕНЕ" : "ДОБАВИТЬ"}
        </button>

        {addMode && (
          <>
            <select
              value={addType}
              onChange={e => setAddType(e.target.value as Light3D["type"])}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[9px] font-display tracking-widest text-zinc-300 focus:outline-none cursor-pointer"
            >
              {FIXTURE_TYPES.map(f => (
                <option key={f.type} value={f.type}>{f.label}</option>
              ))}
            </select>
            <input
              type="text"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              placeholder="Название..."
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-0.5 text-[9px] font-mono-tech text-zinc-300 focus:outline-none min-w-0"
            />
          </>
        )}

        <button
          onClick={() => setLights(LIGHTS_3D)}
          className="ml-auto px-2 py-1 font-display text-[8px] tracking-widest border border-zinc-800 text-zinc-600 rounded hover:text-zinc-400 transition-colors"
        >
          <Icon name="RotateCcw" size={10} />
        </button>
      </div>

      {/* ─── 3D Сцена ─── */}
      <div
        ref={stageRef}
        className="relative bg-black/70 border border-zinc-800 rounded overflow-hidden"
        style={{
          minHeight: 240,
          cursor: addMode ? "crosshair" : dragging !== null ? "grabbing" : "default",
        }}
        onClick={handleStageClick}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        onMouseLeave={handleDragEnd}
      >
        {/* Сетка */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.06]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid3d" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#06b6d4" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid3d)" />
        </svg>

        {/* Планка ригов (потолочная рейка) */}
        <div className="absolute top-[14%] left-[5%] right-[5%] h-px bg-zinc-700 opacity-40" />
        <div className="absolute top-[12%] left-[5%] right-[5%] h-px bg-zinc-600 opacity-20" />

        {/* Сцена (пол) */}
        <div className="absolute bottom-0 left-0 right-0 h-[30%]"
          style={{ background: "linear-gradient(to top, rgba(9,9,11,0.9), transparent)", borderTop: "1px solid rgba(63,63,70,0.4)" }} />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 font-display text-[8px] tracking-[0.4em] text-zinc-700 pointer-events-none">СЦЕНА</div>

        {/* Световые лучи на полу (ambient glow) */}
        {isListening && lights.filter(l => l.active).map(light => {
          const col = light.liveColor ?? light.color;
          if (light.intensity < 10) return null;
          return (
            <div key={`floor-${light.id}`}
              className="absolute pointer-events-none"
              style={{
                left: `${light.x}%`,
                bottom: 0,
                transform: "translateX(-50%)",
                width: `${Math.round(light.intensity * 0.6)}px`,
                height: `${Math.round(light.intensity * 0.25)}%`,
                background: `radial-gradient(ellipse at top, ${col}22, transparent 70%)`,
                opacity: energy * 0.7 + 0.2,
              }}
            />
          );
        })}

        {/* Приборы */}
        {lights.map(light => {
          const col = light.liveColor ?? light.color;
          const isSelected = selected === light.id;
          const pulseIntensity = isListening && light.active
            ? light.intensity * (0.6 + trackFeatures.onset_strength * 0.4)
            : light.intensity;
          const glowSize = Math.round(pulseIntensity / 5) + (isListening && light.active ? Math.round(trackFeatures.onset_strength * 8) : 0);

          return (
            <div
              key={light.id}
              className="absolute group"
              style={{
                left: `${light.x}%`,
                top:  `${light.y}%`,
                transform: "translate(-50%, -50%)",
                zIndex: isSelected ? 20 : 10,
                cursor: addMode ? "crosshair" : "grab",
              }}
              onClick={e => { e.stopPropagation(); if (!addMode) setSelected(light.id === selected ? null : light.id); }}
              onMouseDown={e => { if (!addMode) handleDragStart(e, light.id); }}
            >
              {/* Световой луч вниз */}
              {light.active && light.intensity > 5 && light.type !== "hazer" && (
                <div className="absolute pointer-events-none"
                  style={{
                    top: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: light.type === "moving" ? `${Math.round(pulseIntensity / 4)}px` : `${Math.round(pulseIntensity / 3)}px`,
                    height: light.type === "strobe"
                      ? `${Math.round(pulseIntensity * (isListening ? 0.8 + trackFeatures.onset_strength * 0.5 : 0.6))}px`
                      : `${Math.round(pulseIntensity * 0.55)}px`,
                    background: `linear-gradient(to bottom, ${col}${light.type === "strobe" ? "cc" : "88"}, transparent)`,
                    clipPath: light.type === "moving"
                      ? "polygon(35% 0%, 65% 0%, 100% 100%, 0% 100%)"
                      : "polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)",
                    opacity: isListening ? 0.5 + trackFeatures.onset_strength * 0.5 : 0.4,
                    transition: "opacity 50ms, width 80ms, height 80ms",
                  }}
                />
              )}

              {/* Сам прибор */}
              <div
                className="relative z-10 flex items-center justify-center transition-all"
                style={{
                  width:  light.type === "moving" ? 20 : light.type === "strobe" ? 22 : 16,
                  height: light.type === "moving" ? 20 : light.type === "strobe" ? 18 : 16,
                  borderRadius: light.type === "par" || light.type === "wash" ? "50%" : "3px",
                  background: light.active ? `${col}25` : "#18181b",
                  border: `1.5px solid ${light.active ? col : "#27272a"}`,
                  boxShadow: light.active
                    ? `0 0 ${glowSize}px ${col}, 0 0 ${glowSize * 2}px ${col}44`
                    : "none",
                  transform: isSelected ? "scale(1.35)" : "scale(1)",
                  transition: "box-shadow 80ms, transform 150ms, background 80ms",
                }}
              >
                <FixtureIcon type={light.type} color={light.active ? col : "#52525b"} size={9} />
              </div>

              {/* Лейбл при hover */}
              <div className="absolute top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-30">
                <div className="font-mono-tech text-[8px] text-zinc-300 bg-black/95 border border-zinc-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                  <span>{light.name}</span>
                  {light.active && isListening && (
                    <span style={{ color: col }}>{Math.round(pulseIntensity)}%</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Подсказка режима добавления */}
        {addMode && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/80 border border-cyan-500/30 rounded px-4 py-2 text-center">
              <div className="font-display text-[9px] tracking-widest text-cyan-400 mb-0.5">
                КЛИКНИ ДЛЯ РАЗМЕЩЕНИЯ
              </div>
              <div className="font-mono-tech text-[8px] text-zinc-500">
                {FIXTURE_TYPES.find(f => f.type === addType)?.label}
                {addName && ` — "${addName}"`}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ─── Выбранный прибор ─── */}
      {selectedLight ? (
        <div className="bg-zinc-900 border rounded p-2.5"
          style={{ borderColor: `${selectedLight.liveColor ?? selectedLight.color}33` }}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FixtureIcon type={selectedLight.type} color={selectedLight.liveColor ?? selectedLight.color} size={12} />
              <span className="font-display text-[10px] tracking-widest"
                style={{ color: selectedLight.liveColor ?? selectedLight.color }}>
                {selectedLight.name}
              </span>
              <span className="font-display text-[7px] tracking-widest text-zinc-600">
                {FIXTURE_TYPES.find(f => f.type === selectedLight.type)?.label}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setLights(prev => prev.map(l => l.id === selectedLight.id ? { ...l, active: !l.active } : l))}
                className="px-2 py-0.5 text-[9px] font-display tracking-widest border rounded transition-all"
                style={{
                  borderColor: selectedLight.active ? "rgba(34,197,94,0.5)" : "rgba(63,63,70,0.6)",
                  color: selectedLight.active ? "#22c55e" : "#52525b",
                  background: selectedLight.active ? "rgba(34,197,94,0.06)" : "transparent",
                }}
              >
                {selectedLight.active ? "ON" : "OFF"}
              </button>
              <button
                onClick={() => deleteLight(selectedLight.id)}
                className="px-1.5 py-0.5 text-[9px] font-display border border-red-900/50 text-red-600 rounded hover:bg-red-900/20 transition-all"
              >
                <Icon name="Trash2" size={10} />
              </button>
            </div>
          </div>

          {/* Интенсивность */}
          <div className="flex justify-between mb-1">
            <span className="font-display text-[8px] tracking-widest text-zinc-600">ЯРКОСТЬ</span>
            <span className="font-mono-tech text-[9px]"
              style={{ color: selectedLight.liveColor ?? selectedLight.color }}>
              {selectedLight.intensity}%
            </span>
          </div>
          <input type="range" min={0} max={100} value={selectedLight.intensity}
            onChange={e => setLights(prev => prev.map(l =>
              l.id === selectedLight.id ? { ...l, intensity: +e.target.value, active: +e.target.value > 0 } : l
            ))}
            className="w-full h-1 appearance-none bg-zinc-800 rounded cursor-pointer mb-2"
            style={{ accentColor: selectedLight.liveColor ?? selectedLight.color }}
          />

          {/* Ручной выбор цвета */}
          <div className="flex items-center gap-2">
            <span className="font-display text-[8px] tracking-widest text-zinc-600">ЦВЕТ</span>
            <input
              type="color"
              value={selectedLight.color}
              onChange={e => setLights(prev => prev.map(l =>
                l.id === selectedLight.id ? { ...l, color: e.target.value, liveColor: undefined } : l
              ))}
              className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
              title="Цвет прибора (ручной)"
            />
            {selectedLight.liveColor && (
              <span className="font-mono-tech text-[7px] text-green-500">← live</span>
            )}
            <span className="font-mono-tech text-[8px] text-zinc-600 ml-auto">
              {selectedLight.x}% / {selectedLight.y}%
            </span>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded p-2.5 text-center">
          <span className="font-display text-[9px] tracking-widest text-zinc-600">
            {addMode ? "Кликни на сцену для размещения прибора" : "Кликни на прибор для настройки · Зажми для перемещения"}
          </span>
        </div>
      )}

      {/* ─── Список приборов ─── */}
      <div className="grid grid-cols-2 gap-1">
        {lights.map(l => {
          const col = l.liveColor ?? l.color;
          return (
            <div key={l.id}
              onClick={() => setSelected(l.id === selected ? null : l.id)}
              className="flex items-center gap-2 px-2 py-1 border rounded cursor-pointer transition-all"
              style={{
                borderColor: selected === l.id ? `${col}55` : "rgba(39,39,42,0.8)",
                background: selected === l.id ? `${col}0a` : "transparent",
              }}
            >
              <div className="w-2 h-2 rounded-full shrink-0 transition-all"
                style={{
                  background: l.active ? col : "#27272a",
                  boxShadow: l.active && isListening ? `0 0 ${4 + Math.round(trackFeatures.onset_strength * 4)}px ${col}` : l.active ? `0 0 3px ${col}` : "none",
                }}
              />
              <FixtureIcon type={l.type} color={l.active ? col : "#52525b"} size={9} />
              <span className="font-mono-tech text-[8px] text-zinc-500 truncate flex-1">{l.name}</span>
              {l.active && isListening && (
                <span className="font-mono-tech text-[7px]" style={{ color: col }}>{l.intensity}%</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
const TABS: { id: TabId; label: string; icon: string; accent: string }[] = [
  { id: "dmx",       label: "DMX",       icon: "Sliders",   accent: "#06b6d4" },
  { id: "audio",     label: "Аудио",     icon: "Activity",  accent: "#a855f7" },
  { id: "autoscene", label: "AutoScene", icon: "Sparkles",  accent: "#a855f7" },
  { id: "library",   label: "Библиотека", icon: "BookOpen", accent: "#f59e0b" },
  { id: "settings",  label: "Настройки", icon: "Settings",  accent: "#22c55e" },
  { id: "history",   label: "История",   icon: "Clock",     accent: "#3b82f6" },
  { id: "scene3d",   label: "3D Сцена",  icon: "Box",       accent: "#06b6d4" },
];

// ─── Провайдер аудио-контекста ────────────────────────────────────────────────
// Единственный экземпляр useWebAudio живёт здесь и не уничтожается при смене вкладок.

function AudioProvider({ children }: { children: React.ReactNode }) {
  const audio = useWebAudio();
  return <AudioCtx.Provider value={audio}>{children}</AudioCtx.Provider>;
}

export default function Index() {
  const [activeTab, setActiveTab] = useState<TabId>("dmx");
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const panels: Record<TabId, JSX.Element> = {
    dmx:       <DmxPanel />,
    audio:     <AudioPanel />,
    autoscene: <AutoScenePanel />,
    library:   <LibraryPanel />,
    settings:  <SettingsPanel />,
    history:   <HistoryPanel />,
    scene3d:   <Scene3DPanel />,
  };

  return (
    <AudioProvider>
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
    </AudioProvider>
  );
}