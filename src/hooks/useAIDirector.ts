/**
 * AI Lighting Director v2
 * Точная световая режиссура: каждый параметр обоснован музыкально.
 * Логика строится от реальных сигналов — kick, bass, vocal, flux, BPM, структура.
 */

import type { AudioAnalysis, MoodType, TrackStructure } from "./useWebAudio";

export type EventType   = "club" | "festival" | "concert" | "theatre" | "conference" | "party";
export type VenueSize   = "small" | "medium" | "large" | "arena";
export type ShowPolicy  = "aggressive" | "balanced" | "theatrical" | "safe";
export type DirectorMode = "auto" | "hybrid" | "manual_hint";
export type DramaturgyPhase = "exposition" | "development" | "tension" | "climax" | "release" | "resolution";
export type LightingRole = "support" | "accent" | "build" | "release" | "reset";

export interface BrandRules {
  primary_colors?: string[];
  no_strobe?: boolean;
  max_intensity?: number;
  max_movement_speed?: "slow" | "medium" | "fast";
}

export interface DirectorInput {
  audio: AudioAnalysis;
  event_type: EventType;
  venue_size: VenueSize;
  artist_style: string;
  crowd_level: number;
  current_scene: string;
  show_policy: ShowPolicy;
  mode: DirectorMode;
  brand_rules?: BrandRules;
}

export interface FixtureGroupAction {
  group: string;
  action: string;
  value: string | number | boolean;
}

export interface DMXAction {
  protocol: "DMX" | "Art-Net" | "sACN";
  universe: number;
  channel: number;
  value: number;
}

export interface DirectorScene {
  scene_name: string;
  intention: string;
  confidence: number;
  context: {
    genre: string; bpm: number; energy: number; mood: string;
    section: string; event_type: string; venue_size: string;
    artist_style: string; crowd_level: number; current_scene: string; mode: string;
  };
  analysis: {
    dramaturgy_phase: DramaturgyPhase;
    dominant_signal: string;
    risk_level: "low" | "medium" | "high";
    lighting_role: LightingRole;
  };
  parameters: {
    color_palette: string[];
    intensity: number;
    movement: "static" | "slow" | "medium" | "fast";
    strobe: boolean;
    strobe_rate: number;       // удары в минуту (0 = выкл)
    beam_width: "narrow" | "medium" | "wide";
    tempo_sync: boolean;
    fog: "off" | "low" | "medium" | "high";
    contrast: number;
    visual_density: "low" | "medium" | "high";
    warmth: number;
    brightness: number;
    pacing: "slow" | "medium" | "fast";
    pan_speed: number;         // 0-255 для moving heads
    tilt_speed: number;        // 0-255 для moving heads
    zoom: number;              // 0-255
    gobo_rotate: boolean;
    gobo_index: number;        // 0 = открытый
    prism: boolean;
  };
  fixture_groups: FixtureGroupAction[];
  timeline: {
    start_ms: number;
    duration_ms: number;
    transition_in: string;
    transition_out: string;
    next_state_trigger: string;
  };
  dmx_actions: DMXAction[];
  safety: {
    manual_override_hint: string;
    fallback_scene: string;
    emergency_stop_scene: string;
    restrictions_applied: string[];
  };
}

// ─── Цветовые палитры ─────────────────────────────────────────────────────────
// Каждая палитра подобрана для конкретного настроения и жанра

const PALETTES: Record<string, string[]> = {
  // По настроению
  aggressive:  ["#ff0000", "#cc0000", "#ff2200", "#440000"],
  euphoric:    ["#00ccff", "#ff00cc", "#ffee00", "#00ffaa"],
  dark:        ["#0000cc", "#440088", "#001a33", "#220044"],
  melancholic: ["#2244aa", "#4433aa", "#112266", "#334488"],
  tense:       ["#ff4400", "#ff0033", "#cc8800", "#441100"],
  relaxed:     ["#0088ff", "#00ccaa", "#4400cc", "#00ffcc"],
  hypnotic:    ["#00ffaa", "#aa00ff", "#0033ff", "#ff00aa"],
  energetic:   ["#ff8800", "#00ff22", "#00bbff", "#ffee00"],
  // По жанру (приоритет при совпадении)
  Techno:      ["#00ffff", "#0000ff", "#ff0022", "#ffffff"],
  House:       ["#ff5500", "#ffee00", "#ff00aa", "#00ffcc"],
  "Deep House": ["#001166", "#003366", "#0055aa", "#002244"],
  DnB:         ["#ff0000", "#ff4400", "#0000cc", "#ffffff"],
  Trance:      ["#00aaff", "#aa00ff", "#ffee00", "#00ffff"],
  "Hard Dance": ["#ff0000", "#ff6600", "#ffff00", "#ffffff"],
  Trap:        ["#440000", "#660033", "#220022", "#aa0044"],
  "Hip-Hop":   ["#441100", "#662200", "#883300", "#aa4400"],
  Pop:         ["#ff44cc", "#00ccff", "#ffee00", "#ffffff"],
  Rock:        ["#ff2200", "#ff6600", "#ffffff", "#ffcc00"],
  Jazz:        ["#cc8800", "#884400", "#ccaa66", "#664400"],
  Ambient:     ["#3344bb", "#6655bb", "#4455aa", "#2233aa"],
  Electronic:  ["#00ff88", "#0066ff", "#6600ff", "#00ddff"],
};

// ─── Вычисление точной яркости под BPM (пульсация в такт) ────────────────────

function bpmToDimmerPulse(bpm: number, energy: number, structure: TrackStructure): number {
  // На дропе: чёткая ритмичная синхронизация → высокая яркость
  if (structure === "drop") return Math.min(255, Math.round(180 + energy * 75));
  // На buildup: нарастающий dimmer
  if (structure === "buildup") return Math.min(255, Math.round(100 + energy * 120));
  // На breakdown: низкий уровень
  if (structure === "breakdown") return Math.min(255, Math.round(30 + energy * 60));
  // На intro: мягкое начало
  if (structure === "intro") return Math.min(255, Math.round(40 + energy * 80));
  // Outro: угасание
  if (structure === "outro") return Math.min(255, Math.round(20 + energy * 50));
  // Default: пропорционально энергии
  return Math.min(255, Math.round(60 + energy * 150));
}

// ─── Скорость строба в зависимости от BPM и структуры ────────────────────────
// Строб синхронизируем с долями такта: четверть, восьмая, шестнадцатая

function calcStrobeRate(bpm: number, energy: number, structure: TrackStructure, policy: ShowPolicy): number {
  if (policy === "safe") return 0;
  if (structure !== "drop" && structure !== "buildup") return 0;
  if (energy < 0.55) return 0;

  // На дропе — восьмые доли (в 2 раза быстрее BPM)
  if (structure === "drop" && energy > 0.75) return Math.min(255, Math.round(bpm * 2 / 60 * 40));
  // На buildup — четверти
  if (structure === "buildup" && energy > 0.7) return Math.min(255, Math.round(bpm / 60 * 40));
  return 0;
}

// ─── Moving Head: позиции по структуре и индексу ─────────────────────────────

function calcPanTilt(
  structure: TrackStructure,
  fixtureIndex: number,
  energy: number,
  bpm: number
): { pan: number; tilt: number; panFine: number; tiltFine: number; speed: number } {
  const positions = [
    { pan: 80,  tilt: 90  },  // лево-верх
    { pan: 128, tilt: 75  },  // центр-верх
    { pan: 176, tilt: 90  },  // право-верх
    { pan: 60,  tilt: 110 },  // лево-горизонт
    { pan: 196, tilt: 110 },  // право-горизонт
    { pan: 100, tilt: 95  },  // лево-центр
    { pan: 156, tilt: 95  },  // право-центр
    { pan: 110, tilt: 85  },  // ближе к центру
    { pan: 145, tilt: 85  },  // ближе к центру правее
    { pan: 128, tilt: 60  },  // прямо наверх
  ];

  const base = positions[fixtureIndex % positions.length];

  // На дропе — активное движение: разводим приборы по сцене
  if (structure === "drop") {
    const spread = Math.round(energy * 40);
    return {
      pan: Math.min(255, Math.max(0, base.pan + (fixtureIndex % 2 === 0 ? -spread : spread))),
      tilt: Math.min(255, Math.max(0, base.tilt - Math.round(energy * 25))),
      panFine: 0, tiltFine: 0,
      speed: Math.min(255, Math.round(100 + energy * 130)),
    };
  }

  // На buildup — сходимся к центру сцены
  if (structure === "buildup") {
    const converge = Math.round(energy * 30);
    return {
      pan: Math.min(255, Math.max(0, 128 + (base.pan - 128) * (1 - energy * 0.5))),
      tilt: Math.min(255, Math.max(0, base.tilt - converge)),
      panFine: 0, tiltFine: 0,
      speed: Math.min(255, Math.round(60 + energy * 100)),
    };
  }

  // На breakdown — медленное широкое движение
  if (structure === "breakdown") {
    return {
      pan: base.pan,
      tilt: Math.min(255, base.tilt + 20),
      panFine: 0, tiltFine: 0,
      speed: 30,
    };
  }

  // BPM-синхронизация скорости (чем выше BPM, тем быстрее)
  const bpmSpeed = Math.min(200, Math.round(bpm * 0.8));
  return { pan: base.pan, tilt: base.tilt, panFine: 0, tiltFine: 0, speed: bpmSpeed };
}

// ─── Зум по структуре ─────────────────────────────────────────────────────────

function calcZoom(structure: TrackStructure, energy: number): number {
  switch (structure) {
    case "drop":      return Math.round(30 + (1 - energy) * 40);   // узкий луч на пике
    case "buildup":   return Math.round(60 + (1 - energy) * 60);   // сужается к дропу
    case "breakdown": return Math.round(160 + energy * 40);         // широкий wash
    case "intro":     return 180;                                    // широкий ambient
    case "outro":     return 200;                                    // max широкий
    default:          return Math.round(80 + energy * 60);
  }
}

// ─── Цвет из палитры для конкретного прибора ─────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function getPaletteColor(palette: string[], idx: number, brightness: number): RGB {
  const hex = palette[idx % palette.length] ?? "#ffffff";
  const c   = hexToRgb(hex);
  return {
    r: Math.round(c.r * brightness),
    g: Math.round(c.g * brightness),
    b: Math.round(c.b * brightness),
  };
}

// ─── Выбор палитры ────────────────────────────────────────────────────────────

function selectPalette(mood: MoodType, genre: string, structure: TrackStructure): string[] {
  // Жанровая палитра имеет приоритет
  if (PALETTES[genre]) {
    const gp = PALETTES[genre];
    const mp = PALETTES[mood] ?? PALETTES.energetic;
    // На intro/outro — mood-палитра мягче, жанр не так важен
    if (structure === "intro" || structure === "outro" || structure === "breakdown") return mp;
    // На дропе — жанровая + mood-акцент
    return [...gp.slice(0, 3), ...(mp.slice(0, 1))];
  }
  return PALETTES[mood] ?? PALETTES.energetic;
}

// ─── Fog по структуре ─────────────────────────────────────────────────────────

function calcFog(structure: TrackStructure, energy: number, policy: ShowPolicy): "off" | "low" | "medium" | "high" {
  if (policy === "safe") return "low";
  switch (structure) {
    case "buildup":   return energy > 0.6 ? "high" : "medium";   // дымовая завеса перед дропом
    case "drop":      return energy > 0.7 ? "low" : "medium";    // минимум на пике (видимость)
    case "breakdown": return "medium";
    case "intro":     return "medium";
    case "outro":     return "low";
    default:          return energy > 0.5 ? "low" : "off";
  }
}

// ─── Warmth (теплота цвета) ────────────────────────────────────────────────────

function calcWarmth(mood: MoodType, vocal_presence: number, structure: TrackStructure): number {
  // Вокал требует более тёплого, "человечного" света
  if (vocal_presence > 0.55) return 0.65;
  // Тёмные и агрессивные сцены — холодный свет
  if (mood === "dark" || mood === "aggressive") return 0.05;
  if (mood === "melancholic") return 0.55;
  if (mood === "relaxed")     return 0.75;
  if (mood === "euphoric")    return 0.3;
  if (structure === "breakdown" || structure === "intro") return 0.5;
  return 0.2;
}

// ─── Dramaturgy phase по структуре ───────────────────────────────────────────

function structureToPhase(structure: TrackStructure, energyTrend: string): DramaturgyPhase {
  switch (structure) {
    case "intro":     return "exposition";
    case "buildup":   return energyTrend === "rising" ? "tension" : "development";
    case "drop":      return "climax";
    case "breakdown": return "release";
    case "outro":     return "resolution";
    default:          return "development";
  }
}

// ─── Dominant signal ──────────────────────────────────────────────────────────

function getDominantSignal(
  energy: number, silence: number, vocal: number,
  kick: number, bass: number, flux: number,
  structure: TrackStructure, trend: string
): string {
  if (silence > 0.6)       return "silence";
  if (vocal > 0.6)         return "vocal_lead";
  if (structure === "drop") return "drop_impact";
  if (structure === "buildup" && trend === "rising") return "energy_rise";
  if (bass > 0.65)         return "bass_pulse";
  if (kick > 0.65)         return "kick_drive";
  if (flux > 0.25)         return "spectral_burst";
  if (energy < 0.15)       return "near_silence";
  return "musical_flow";
}

// ─── Lighting role по структуре и dominant signal ────────────────────────────

function getLightingRole(structure: TrackStructure, signal: string): LightingRole {
  if (signal === "silence" || signal === "near_silence") return "reset";
  switch (structure) {
    case "intro":     return "support";
    case "buildup":   return "build";
    case "drop":      return "release";
    case "breakdown": return "reset";
    case "outro":     return "reset";
    default:          return signal === "vocal_lead" ? "accent" : "support";
  }
}

// ─── Fixture groups (высокоуровневые команды) ─────────────────────────────────

function buildFixtureGroups(
  structure: TrackStructure,
  mood: MoodType,
  energy: number,
  vocal: number,
  bass: number,
  kick: number,
  onset: number,
  bpm: number,
  policy: ShowPolicy,
  palette: string[]
): FixtureGroupAction[] {
  const groups: FixtureGroupAction[] = [];
  const dimmer = Math.round(energy * 255);
  const mainColor = palette[0] ?? "#ffffff";
  const accentColor = palette[1] ?? palette[0] ?? "#0000ff";

  // ── FRONT WASH / LED PAR ──────────────────────────────────────────────────
  if (vocal > 0.55) {
    // Вокальный режим: тёплый белый, мягко
    groups.push({ group: "front_wash", action: "set_color", value: "#ffe8cc" });
    groups.push({ group: "front_wash", action: "set_intensity", value: Math.round(dimmer * 0.6) });
    groups.push({ group: "front_wash", action: "set_movement", value: "static" });
  } else if (structure === "drop") {
    groups.push({ group: "front_wash", action: "set_color", value: mainColor });
    groups.push({ group: "front_wash", action: "set_intensity", value: Math.min(255, dimmer + 40) });
    groups.push({ group: "front_wash", action: "color_chase_bpm", value: bpm });
  } else if (structure === "buildup") {
    groups.push({ group: "front_wash", action: "ramp_color", value: `${accentColor}→${mainColor}` });
    groups.push({ group: "front_wash", action: "ramp_intensity", value: `${Math.round(dimmer * 0.5)}→${dimmer}` });
  } else if (structure === "breakdown") {
    groups.push({ group: "front_wash", action: "set_color", value: accentColor });
    groups.push({ group: "front_wash", action: "set_intensity", value: Math.round(dimmer * 0.35) });
    groups.push({ group: "front_wash", action: "slow_pulse", value: 0.3 });
  } else {
    groups.push({ group: "front_wash", action: "set_color", value: mainColor });
    groups.push({ group: "front_wash", action: "set_intensity", value: dimmer });
  }

  // ── MOVING HEADS ──────────────────────────────────────────────────────────
  if (structure === "drop" && energy > 0.5) {
    groups.push({ group: "moving_heads", action: "aerial_sweep",  value: "dynamic_fan_out" });
    groups.push({ group: "moving_heads", action: "zoom",          value: 40 });
    groups.push({ group: "moving_heads", action: "speed",         value: Math.round(100 + energy * 130) });
    groups.push({ group: "moving_heads", action: "set_color",     value: mainColor });
    if (bass > 0.6) {
      groups.push({ group: "moving_heads", action: "bass_pulse_tilt", value: Math.round(bass * 40) });
    }
  } else if (structure === "buildup") {
    groups.push({ group: "moving_heads", action: "converge_center", value: "top_center" });
    groups.push({ group: "moving_heads", action: "zoom_ramp",      value: "160→40" });
    groups.push({ group: "moving_heads", action: "speed",          value: Math.round(60 + energy * 100) });
    groups.push({ group: "moving_heads", action: "set_color",      value: accentColor });
  } else if (structure === "breakdown" || structure === "intro") {
    groups.push({ group: "moving_heads", action: "wide_ambient",   value: "slow_pan" });
    groups.push({ group: "moving_heads", action: "zoom",           value: 180 });
    groups.push({ group: "moving_heads", action: "speed",          value: 25 });
    groups.push({ group: "moving_heads", action: "set_color",      value: accentColor });
  } else {
    groups.push({ group: "moving_heads", action: "gentle_sweep",   value: "musical" });
    groups.push({ group: "moving_heads", action: "zoom",           value: 100 });
    groups.push({ group: "moving_heads", action: "speed",          value: Math.round(40 + energy * 80) });
  }

  // ── STROBES ──────────────────────────────────────────────────────────────
  if (policy !== "safe" && structure === "drop" && energy > 0.68 && kick > 0.55) {
    const strobeRate = Math.round(bpm * 2 / 60 * 40);
    groups.push({ group: "strobes", action: "strobe_sync_kick", value: strobeRate });
    groups.push({ group: "strobes", action: "set_intensity",    value: Math.round(energy * 220) });
  } else if (policy !== "safe" && structure === "buildup" && energy > 0.8 && onset > 0.5) {
    groups.push({ group: "strobes", action: "flash_on_onset",   value: onset });
  } else {
    groups.push({ group: "strobes", action: "off",              value: 0 });
  }

  // ── BACK BEAMS / ACL ──────────────────────────────────────────────────────
  if (bass > 0.55) {
    groups.push({ group: "back_beams", action: "bass_pulse_intensity", value: Math.round(bass * 255) });
    groups.push({ group: "back_beams", action: "set_color",            value: palette[2] ?? accentColor });
  } else if (structure === "drop") {
    groups.push({ group: "back_beams", action: "full_intensity",  value: Math.round(energy * 255) });
  } else if (structure === "breakdown") {
    groups.push({ group: "back_beams", action: "fade_out",        value: 3000 });
  } else {
    groups.push({ group: "back_beams", action: "ambient_intensity", value: Math.round(energy * 0.5 * 255) });
  }

  // ── SIDE WASH ─────────────────────────────────────────────────────────────
  if (structure === "buildup") {
    groups.push({ group: "side_wash", action: "ramp_to_full",    value: `${Math.round(energy * 1000)}ms` });
    groups.push({ group: "side_wash", action: "set_color",       value: palette[3] ?? accentColor });
  } else if (structure === "drop") {
    groups.push({ group: "side_wash", action: "color_alternating", value: `${mainColor}|${accentColor}` });
    groups.push({ group: "side_wash", action: "rate_bpm",         value: bpm });
  } else {
    groups.push({ group: "side_wash", action: "ambient",          value: Math.round(energy * 0.4 * 255) });
  }

  // ── LASER ─────────────────────────────────────────────────────────────────
  if (policy !== "safe" && structure === "drop" && energy > 0.6) {
    groups.push({ group: "lasers", action: "pattern_dynamic",    value: "scatter_radial" });
    groups.push({ group: "lasers", action: "rotation_speed",     value: Math.round(energy * 200) });
  } else if (structure === "buildup" && energy > 0.5) {
    groups.push({ group: "lasers", action: "pattern_convergence", value: "center_fan" });
  } else {
    groups.push({ group: "lasers", action: policy === "safe" ? "off" : "pattern_ambient", value: "slow_scan" });
  }

  // ── SPOT / FOH ────────────────────────────────────────────────────────────
  if (vocal > 0.5) {
    groups.push({ group: "spot_foh", action: "follow_center",    value: "tight_white" });
    groups.push({ group: "spot_foh", action: "zoom",             value: 50 });
  } else if (structure === "drop") {
    groups.push({ group: "spot_foh", action: "aerial_split",     value: 2 });
    groups.push({ group: "spot_foh", action: "set_color",        value: mainColor });
  } else {
    groups.push({ group: "spot_foh", action: "ambient_fill",     value: Math.round(energy * 0.5 * 255) });
  }

  return groups;
}

// ─── DMX actions (первые 16 каналов) ─────────────────────────────────────────
// Чёткое распределение: каждый канал за конкретную функцию

function buildDMXActions(
  palette: string[],
  dimmer: number,
  strobeRate: number,
  bass: number,
  kick: number,
  structure: TrackStructure,
  energy: number,
  bpm: number,
  zoom: number,
  panSpeed: number
): DMXAction[] {
  const a: DMXAction[] = [];
  const p = (ch: number, val: number) =>
    a.push({ protocol: "Art-Net", universe: 0, channel: ch, value: Math.round(Math.min(255, Math.max(0, val))) });

  const c0 = hexToRgb(palette[0] ?? "#ff0000");
  const c1 = hexToRgb(palette[1] ?? "#0000ff");

  // CH1:  Master dimmer
  p(1, dimmer);
  // CH2-4: Основной цвет (RGB)
  p(2, c0.r);
  p(3, c0.g);
  p(4, c0.b);
  // CH5:  Bass-pulse (нижний свет пульсирует с басом)
  p(5, Math.round(bass * 255));
  // CH6:  Strobe rate (0=выкл, >0=частота)
  p(6, strobeRate);
  // CH7:  Pan moving head (позиция зависит от структуры)
  const panVal = structure === "drop" ? 80 + Math.round(energy * 60) : 128;
  p(7, panVal);
  // CH8:  Tilt moving head
  const tiltVal = structure === "drop" ? 70 + Math.round(energy * 30) : 100;
  p(8, tiltVal);
  // CH9-11: Акцентный цвет (RGB backlight)
  p(9,  Math.round(c1.r * energy));
  p(10, Math.round(c1.g * energy));
  p(11, Math.round(c1.b * energy));
  // CH12: Fog/Hazer
  const fogVal = structure === "buildup" ? Math.round(150 + energy * 100)
               : structure === "drop"    ? Math.round(energy * 80)
               : 0;
  p(12, fogVal);
  // CH13: Zoom
  p(13, zoom);
  // CH14: Movement speed
  p(14, panSpeed);
  // CH15: Kick-синхронный импульс (акцентный свет в такт бочке)
  p(15, Math.round(kick * 200));
  // CH16: Третий акцентный цвет (hex → R-канал для side light)
  const c2 = hexToRgb(palette[2] ?? "#00ff00");
  p(16, Math.round(c2.r * energy * 0.85));

  return a;
}

// ─── Имя сцены ────────────────────────────────────────────────────────────────

function buildSceneName(mood: MoodType, structure: TrackStructure, energy: number, bpm: number): string {
  const s: Record<TrackStructure, string> = {
    intro: "RISE", buildup: "BUILD", drop: "PEAK",
    breakdown: "VOID", outro: "FADE", unknown: "SCAN",
  };
  const m: Record<MoodType, string> = {
    aggressive: "STORM", euphoric: "RUSH", dark: "SHADE",
    melancholic: "MIST", tense: "EDGE", relaxed: "FLOW",
    hypnotic: "PULSE", energetic: "SURGE",
  };
  const tag = energy > 0.82 ? "·MAX" : energy < 0.2 ? "·DIM" : bpm > 150 ? "·FAST" : "";
  return `${m[mood]} ${s[structure]}${tag}`;
}

// ─── Timeline по структуре ────────────────────────────────────────────────────

function buildTimeline(
  structure: TrackStructure,
  structureProgress: number,
  drop_probability: number,
  energyTrend: string
): DirectorScene["timeline"] {
  const durations: Record<TrackStructure, number> = {
    intro: 16000, buildup: 8000, drop: 32000,
    breakdown: 12000, outro: 16000, unknown: 4000,
  };
  const transIn: Record<TrackStructure, string> = {
    drop: "hard_cut_16ms", buildup: "ramp_800ms", breakdown: "crossfade_2000ms",
    intro: "fade_in_3000ms", outro: "fade_in_2000ms", unknown: "crossfade_1000ms",
  };
  const transOut: Record<TrackStructure, string> = {
    drop: "crossfade_400ms", buildup: "hard_cut_to_drop",
    breakdown: "fade_3000ms", intro: "crossfade_2000ms",
    outro: "fade_out_4000ms", unknown: "crossfade_1000ms",
  };

  const nextTrigger = drop_probability > 0.72 ? "energy_peak_imminent"
    : energyTrend === "falling" ? "energy_below_0.3"
    : energyTrend === "rising"  ? "energy_threshold_0.75"
    : "structure_change";

  return {
    start_ms: 0,
    duration_ms: Math.round(durations[structure] * (1 - structureProgress * 0.5)),
    transition_in: transIn[structure],
    transition_out: transOut[structure],
    next_state_trigger: nextTrigger,
  };
}

// ─── Основная функция ─────────────────────────────────────────────────────────

export function runAIDirector(input: DirectorInput): DirectorScene {
  const { audio, event_type, venue_size, artist_style, crowd_level,
          current_scene, show_policy, mode, brand_rules } = input;

  const { genre, bpm, energy, mood, structure, structureProgress,
          energyTrend, trackFeatures } = audio;

  const { kick_density, bass_energy, vocal_presence, spectral_brightness,
          drop_probability, silence_probability, spectral_flux, onset_strength } = trackFeatures;

  const restrictions: string[] = [];

  // ── 1. Палитра ────────────────────────────────────────────────────────────
  let palette = selectPalette(mood, genre, structure);

  // ── 2. Базовые параметры ─────────────────────────────────────────────────
  let intensity = Math.min(1,
    energy * 1.15
    + (structure === "drop" ? 0.12 : 0)
    + (crowd_level > 0.7 ? 0.06 : 0)
  );

  // Vocal mode: защищаем читаемость
  if (vocal_presence > 0.55) {
    intensity = Math.min(0.65, intensity);
    restrictions.push("vocal_mode_dimmed");
  }

  // Silence
  if (silence_probability > 0.65) {
    intensity = Math.min(0.12, intensity);
    restrictions.push("silence_blackout");
  }

  // Venue boost
  if (venue_size === "arena") {
    intensity = Math.min(1.0, intensity + 0.08);
    restrictions.push("venue_arena_boost");
  } else if (venue_size === "small") {
    intensity = Math.max(0, intensity - 0.1);
    restrictions.push("venue_small_dimmed");
  }

  // ── 3. Strobe ─────────────────────────────────────────────────────────────
  const strobeActive = show_policy !== "safe"
    && structure === "drop"
    && energy > 0.65
    && kick_density > 0.5
    && vocal_presence < 0.45;

  const strobeRate = strobeActive
    ? calcStrobeRate(bpm, energy, structure, show_policy)
    : 0;

  if (!strobeActive && show_policy !== "safe") restrictions.push("strobe_energy_gated");
  if (show_policy === "safe") restrictions.push("safe_policy_no_strobe");

  // ── 4. Movement ───────────────────────────────────────────────────────────
  const movementMap: Record<TrackStructure, "static" | "slow" | "medium" | "fast"> = {
    intro: "slow", buildup: "medium", drop: "fast",
    breakdown: "slow", outro: "slow", unknown: "medium",
  };
  let movement = movementMap[structure];
  if (show_policy === "safe" && movement === "fast") {
    movement = "medium";
    restrictions.push("safe_policy_movement_capped");
  }

  // ── 5. Pan/Tilt ───────────────────────────────────────────────────────────
  const pt = calcPanTilt(structure, 0, energy, bpm);
  const zoom = calcZoom(structure, energy);
  const panSpeed = pt.speed;
  const tiltSpeed = pt.speed;

  // ── 6. Fog ────────────────────────────────────────────────────────────────
  const fog = calcFog(structure, energy, show_policy);

  // ── 7. Contrast & Warmth ──────────────────────────────────────────────────
  const contrast = Math.min(1,
    energy * 0.75
    + bass_energy * 0.25
    + (structure === "drop" ? 0.15 : 0)
  );
  const warmth = calcWarmth(mood, vocal_presence, structure);
  const brightness = Math.min(1, energy * 1.1 + spectral_brightness * 0.25);

  // ── 8. Visual density ──────────────────────────────────────────────────────
  const densityMap: Record<TrackStructure, "low" | "medium" | "high"> = {
    intro: "low", buildup: "medium", drop: "high",
    breakdown: "low", outro: "low", unknown: "medium",
  };

  // ── 9. Gobo и призма ─────────────────────────────────────────────────────
  const goboRotate = structure === "drop" && energy > 0.6;
  const goboIndex  = structure === "drop" ? Math.round(energy * 5) : 0;
  const prism      = structure === "drop" && show_policy === "aggressive" && energy > 0.75;

  // ── 10. Brand rules ───────────────────────────────────────────────────────
  if (brand_rules) {
    if (brand_rules.no_strobe) {
      restrictions.push("brand_no_strobe");
    }
    if (brand_rules.max_intensity !== undefined) {
      intensity = Math.min(intensity, brand_rules.max_intensity);
      restrictions.push(`brand_max_intensity_${brand_rules.max_intensity}`);
    }
    if (brand_rules.primary_colors?.length) {
      palette = brand_rules.primary_colors;
      restrictions.push("brand_colors_enforced");
    }
  }

  // ── 11. Dimmer value ─────────────────────────────────────────────────────
  const dimmer = bpmToDimmerPulse(bpm, intensity, structure);

  // ── 12. Fixture groups ────────────────────────────────────────────────────
  const fixture_groups = buildFixtureGroups(
    structure, mood, energy, vocal_presence, bass_energy,
    kick_density, onset_strength, bpm, show_policy, palette
  );

  // ── 13. DMX actions ───────────────────────────────────────────────────────
  const dmx_actions = buildDMXActions(
    palette, dimmer, strobeRate, bass_energy, kick_density,
    structure, energy, bpm, zoom, panSpeed
  );

  // ── 14. Analysis ─────────────────────────────────────────────────────────
  const phase    = structureToPhase(structure, energyTrend);
  const signal   = getDominantSignal(energy, silence_probability, vocal_presence,
                    kick_density, bass_energy, spectral_flux, structure, energyTrend);
  const role     = getLightingRole(structure, signal);
  const riskLevel: "low" | "medium" | "high" =
    show_policy === "safe" ? "low"
    : strobeActive && energy > 0.8 ? "high"
    : energy > 0.65 || strobeActive ? "medium"
    : "low";

  // ── 15. Confidence ────────────────────────────────────────────────────────
  const confidence = parseFloat(Math.min(1,
    0.25
    + (bpm > 80      ? 0.15 : 0)
    + (energy > 0.08 ? 0.15 : 0)
    + (structure !== "unknown" ? 0.20 : 0)
    + (signal !== "musical_flow" ? 0.15 : 0)
    + (vocal_presence > 0 || bass_energy > 0 ? 0.10 : 0)
  ).toFixed(2));

  // ── 16. Manual hint ───────────────────────────────────────────────────────
  const hint = mode === "auto"
    ? `Авто-режим. Для перехвата нажми Override.`
    : `[${phase.toUpperCase()}] E=${Math.round(energy*100)}% B=${bpm}bpm | `
      + `${movement} mvt · ${fog} fog · ${strobeActive ? "STROBE ON" : "strobe off"} · `
      + `palette: ${palette.slice(0,2).join("/")} | signal: ${signal}`;

  return {
    scene_name: buildSceneName(mood, structure, energy, bpm),
    intention:  buildIntention(mood, structure, vocal_presence, drop_probability, event_type, signal),
    confidence,
    context: {
      genre, bpm, energy: parseFloat(energy.toFixed(2)), mood,
      section: structure, event_type, venue_size, artist_style,
      crowd_level: parseFloat(crowd_level.toFixed(2)), current_scene, mode,
    },
    analysis: { dramaturgy_phase: phase, dominant_signal: signal, risk_level: riskLevel, lighting_role: role },
    parameters: {
      color_palette:  palette,
      intensity:      parseFloat(intensity.toFixed(2)),
      movement,
      strobe:         strobeActive && !brand_rules?.no_strobe,
      strobe_rate:    strobeRate,
      beam_width:     structure === "drop" ? "narrow" : structure === "breakdown" ? "wide" : "medium",
      tempo_sync:     bpm > 80 && energy > 0.3,
      fog,
      contrast:       parseFloat(contrast.toFixed(2)),
      visual_density: densityMap[structure],
      warmth:         parseFloat(warmth.toFixed(2)),
      brightness:     parseFloat(brightness.toFixed(2)),
      pacing:         structure === "drop" ? "fast" : structure === "buildup" ? "medium" : "slow",
      pan_speed:      panSpeed,
      tilt_speed:     tiltSpeed,
      zoom,
      gobo_rotate:    goboRotate,
      gobo_index:     goboIndex,
      prism,
    },
    fixture_groups,
    timeline: buildTimeline(structure, structureProgress, drop_probability, energyTrend),
    dmx_actions,
    safety: {
      manual_override_hint: hint,
      fallback_scene:       vocal_presence > 0.5 ? "soft_white_stage" : energy < 0.25 ? "ambient_low" : "neutral_warm",
      emergency_stop_scene: "blackout_all_0",
      restrictions_applied: restrictions,
    },
  };
}

// ─── Intention builder ────────────────────────────────────────────────────────

function buildIntention(
  mood: MoodType, structure: TrackStructure,
  vocal: number, dropProb: number,
  event: EventType, signal: string
): string {
  if (signal === "silence")      return "Тишина — удерживать внимание минимальным светом.";
  if (signal === "vocal_lead")   return "Вокал в приоритете: чистый, мягкий свет на исполнителе.";
  if (structure === "drop")      return `Максимальный удар на дропе — синхронизация, яркость, движение для ${event}.`;
  if (structure === "buildup")   return "Нагнетать ожидание: нарастание яркости и скорости к дропу.";
  if (structure === "breakdown") return "Пространство и ожидание — снижение плотности, атмосфера.";
  if (structure === "intro")     return "Мягко открыть шоу, задать характер без перегрузки.";
  if (dropProb > 0.72)           return "Высокая вероятность дропа — готовить финальный акцент.";
  const intents: Record<MoodType, string> = {
    aggressive: "Агрессивный импульс через резкий контраст и скоростное движение.",
    euphoric:   "Праздничный подъём через яркие цвета и широкие паттерны.",
    dark:       "Тёмная плотная атмосфера с глубоким рельефом тени и света.",
    melancholic:"Эмоциональная глубина через мягкий синий и медленные переходы.",
    tense:      "Удержать нарастающее напряжение без разрядки.",
    relaxed:    "Расслабленный поток с мягкими плавными переходами.",
    hypnotic:   "Гипнотический цикл через монотонные повторяющиеся паттерны.",
    energetic:  "Высокая энергия через яркость, темп и ритмическую синхронизацию.",
  };
  return intents[mood] ?? "Музыкальная синхронизация в текущем контексте.";
}
