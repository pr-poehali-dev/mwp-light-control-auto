/**
 * AI Lighting Director
 * Полноценная режиссура света: анализирует музыкальный контекст,
 * строит драматургически осмысленную световую сцену и возвращает
 * структурированный JSON для управления через DMX / Art-Net / sACN.
 */

import type { AudioAnalysis, MoodType, TrackStructure } from "./useWebAudio";

// ─── Входные параметры режиссёра ──────────────────────────────────────────────

export type EventType = "club" | "festival" | "concert" | "theatre" | "conference" | "party";
export type VenueSize = "small" | "medium" | "large" | "arena";
export type ShowPolicy = "aggressive" | "balanced" | "theatrical" | "safe";
export type DirectorMode = "auto" | "hybrid" | "manual_hint";
export type DramaturgyPhase = "exposition" | "development" | "tension" | "climax" | "release" | "resolution";
export type LightingRole = "support" | "accent" | "build" | "release" | "reset";

export interface BrandRules {
  primary_colors?: string[];   // Допустимые цвета (hex)
  no_strobe?: boolean;
  max_intensity?: number;      // 0-1
  max_movement_speed?: "slow" | "medium" | "fast";
}

export interface DirectorInput {
  audio: AudioAnalysis;
  event_type: EventType;
  venue_size: VenueSize;
  artist_style: string;        // Описание стиля: "dark techno", "melodic house" и т.п.
  crowd_level: number;         // 0-1
  current_scene: string;       // Название текущей активной сцены
  show_policy: ShowPolicy;
  mode: DirectorMode;
  brand_rules?: BrandRules;
}

// ─── Структура сцены от режиссёра ─────────────────────────────────────────────

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
    genre: string;
    bpm: number;
    energy: number;
    mood: string;
    section: string;
    event_type: string;
    venue_size: string;
    artist_style: string;
    crowd_level: number;
    current_scene: string;
    mode: string;
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
    beam_width: "narrow" | "medium" | "wide";
    tempo_sync: boolean;
    fog: "off" | "low" | "medium" | "high";
    contrast: number;
    visual_density: "low" | "medium" | "high";
    warmth: number;
    brightness: number;
    pacing: "slow" | "medium" | "fast";
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

// ─── Цветовые палитры по жанру и настроению ───────────────────────────────────

const PALETTES: Record<string, string[]> = {
  // По настроению
  aggressive:  ["#ff0000", "#ff1e00", "#b400ff", "#ff3300"],
  euphoric:    ["#00c8ff", "#ff00c8", "#ffff00", "#00ff96"],
  dark:        ["#0000b4", "#500078", "#003c50", "#1e0032"],
  melancholic: ["#3c50b4", "#643c8c", "#28285a", "#1e3264"],
  tense:       ["#ff5000", "#ff003c", "#c8c800", "#ff6400"],
  relaxed:     ["#0096ff", "#00c896", "#6400c8", "#00ffc8"],
  hypnotic:    ["#00ffb4", "#b400ff", "#0050ff", "#ff00b4"],
  energetic:   ["#ff9600", "#00ff00", "#00c8ff", "#ffff00"],
  // По жанру
  Techno:      ["#00ffff", "#0000ff", "#ff0000", "#ffffff"],
  House:       ["#ff6400", "#ffff00", "#ff00c8", "#00ffff"],
  DnB:         ["#ff0000", "#ff6400", "#0000ff", "#ffffff"],
  Pop:         ["#ff00c8", "#00ffff", "#ffff00", "#ffffff"],
  Rock:        ["#ff0000", "#ff6400", "#ffffff", "#ffd700"],
  Jazz:        ["#ffa500", "#8b4513", "#f0e68c", "#cd853f"],
  Ambient:     ["#4169e1", "#9370db", "#00ced1", "#7b68ee"],
  Electronic:  ["#00ff80", "#0080ff", "#8000ff", "#00ffff"],
};

// ─── Правила по структуре трека ───────────────────────────────────────────────

const STRUCTURE_RULES: Record<TrackStructure, {
  phase: DramaturgyPhase;
  role: LightingRole;
  movement: "static" | "slow" | "medium" | "fast";
  visual_density: "low" | "medium" | "high";
  pacing: "slow" | "medium" | "fast";
  fog: "off" | "low" | "medium" | "high";
}> = {
  intro:     { phase: "exposition",  role: "support",  movement: "slow",   visual_density: "low",    pacing: "slow",   fog: "medium" },
  buildup:   { phase: "tension",     role: "build",    movement: "medium", visual_density: "medium", pacing: "medium", fog: "medium" },
  drop:      { phase: "climax",      role: "release",  movement: "fast",   visual_density: "high",   pacing: "fast",   fog: "low"    },
  breakdown: { phase: "resolution",  role: "reset",    movement: "slow",   visual_density: "low",    pacing: "slow",   fog: "medium" },
  outro:     { phase: "resolution",  role: "reset",    movement: "slow",   visual_density: "low",    pacing: "slow",   fog: "low"    },
  unknown:   { phase: "development", role: "support",  movement: "medium", visual_density: "medium", pacing: "medium", fog: "off"    },
};

// ─── Логика применения show_policy ────────────────────────────────────────────

function applyShowPolicy(
  scene: Partial<DirectorScene["parameters"]>,
  policy: ShowPolicy,
  restrictions: string[]
): Partial<DirectorScene["parameters"]> {
  const s = { ...scene };

  switch (policy) {
    case "safe":
      s.strobe = false;
      s.intensity = Math.min(s.intensity ?? 1, 0.7);
      s.movement = s.movement === "fast" ? "medium" : (s.movement ?? "medium");
      s.contrast = Math.min(s.contrast ?? 1, 0.6);
      restrictions.push("strobe_disabled", "max_intensity_0.7", "movement_capped_medium");
      break;

    case "aggressive":
      s.intensity = Math.min((s.intensity ?? 0.7) * 1.2, 1.0);
      s.contrast = Math.min((s.contrast ?? 0.5) * 1.3, 1.0);
      break;

    case "theatrical":
      s.fog = s.fog === "off" ? "low" : (s.fog ?? "low");
      s.warmth = (s.warmth ?? 0.5) * 0.7; // Холоднее для театральности
      restrictions.push("theatrical_fog_minimum");
      break;

    case "balanced":
      s.intensity = Math.min(s.intensity ?? 0.8, 0.9);
      s.strobe = (s.intensity ?? 0.8) > 0.75 ? (s.strobe ?? false) : false;
      if (!s.strobe) restrictions.push("strobe_energy_gated");
      break;
  }

  return s;
}

// ─── Применение brand_rules ───────────────────────────────────────────────────

function applyBrandRules(
  params: Partial<DirectorScene["parameters"]>,
  palette: string[],
  rules: BrandRules,
  restrictions: string[]
): { params: Partial<DirectorScene["parameters"]>; palette: string[] } {
  let finalPalette = [...palette];

  if (rules.no_strobe) {
    params.strobe = false;
    restrictions.push("brand_no_strobe");
  }
  if (rules.max_intensity !== undefined) {
    params.intensity = Math.min(params.intensity ?? 1, rules.max_intensity);
    restrictions.push(`brand_max_intensity_${rules.max_intensity}`);
  }
  if (rules.max_movement_speed) {
    const speedOrder = ["static", "slow", "medium", "fast"] as const;
    const maxIdx = speedOrder.indexOf(rules.max_movement_speed);
    const curIdx = speedOrder.indexOf(params.movement ?? "medium");
    if (curIdx > maxIdx) {
      params.movement = rules.max_movement_speed;
      restrictions.push(`brand_movement_capped_${rules.max_movement_speed}`);
    }
  }
  if (rules.primary_colors && rules.primary_colors.length > 0) {
    finalPalette = rules.primary_colors;
    restrictions.push("brand_colors_enforced");
  }

  return { params, palette: finalPalette };
}

// ─── Генерация fixture_groups по контексту ────────────────────────────────────

function buildFixtureGroups(
  structure: TrackStructure,
  mood: MoodType,
  energy: number,
  vocal_presence: number,
  bass_energy: number,
  policy: ShowPolicy
): FixtureGroupAction[] {
  const groups: FixtureGroupAction[] = [];
  const dimmer = Math.round(energy * 255);
  const strobeHz = policy !== "safe" && energy > 0.7 ? Math.round(30 + energy * 120) : 0;

  // Фронтальный свет (LED Par / Wash)
  if (vocal_presence > 0.4) {
    groups.push({ group: "front_wash", action: "set_color_neutral", value: "warm_white_soft" });
    groups.push({ group: "front_wash", action: "set_intensity", value: Math.round(dimmer * 0.65) });
  } else {
    groups.push({ group: "front_wash", action: "set_color_palette", value: mood });
    groups.push({ group: "front_wash", action: "set_intensity", value: dimmer });
  }

  // Moving heads
  if (structure === "drop" || structure === "buildup") {
    groups.push({ group: "moving_heads", action: "sweep_pattern", value: "dynamic_cross" });
    groups.push({ group: "moving_heads", action: "set_speed", value: structure === "drop" ? 220 : 150 });
    groups.push({ group: "moving_heads", action: "set_zoom", value: "narrow" });
  } else if (structure === "breakdown" || structure === "intro") {
    groups.push({ group: "moving_heads", action: "set_position", value: "center_stage" });
    groups.push({ group: "moving_heads", action: "set_speed", value: 60 });
    groups.push({ group: "moving_heads", action: "set_zoom", value: "wide" });
  } else {
    groups.push({ group: "moving_heads", action: "slow_rotate", value: "ambient" });
  }

  // Strobes
  if (strobeHz > 0 && structure === "drop") {
    groups.push({ group: "strobes", action: "strobe_at_bpm", value: strobeHz });
  } else {
    groups.push({ group: "strobes", action: "off", value: 0 });
  }

  // Backlight / ACL
  if (bass_energy > 0.5) {
    groups.push({ group: "back_beams", action: "pulse_bass_sync", value: Math.round(bass_energy * 255) });
  } else {
    groups.push({ group: "back_beams", action: "set_intensity", value: Math.round(energy * 0.6 * 255) });
  }

  // Side hazers / fog effect
  if (structure === "buildup") {
    groups.push({ group: "side_wash", action: "set_color", value: "deep_amber" });
    groups.push({ group: "side_wash", action: "ramp_intensity", value: "0_to_full" });
  } else if (structure === "breakdown") {
    groups.push({ group: "side_wash", action: "fade_to_black", value: 3000 });
  }

  // Laser
  if (structure === "drop" && energy > 0.65 && policy !== "safe") {
    groups.push({ group: "lasers", action: "pattern_dynamic", value: "scatter_high_energy" });
  } else {
    groups.push({ group: "lasers", action: policy === "safe" ? "off" : "pattern_static", value: "ambient" });
  }

  // Spot center
  if (vocal_presence > 0.5) {
    groups.push({ group: "spot_center", action: "follow_vocal", value: "center_stage_narrow" });
  } else if (structure === "drop") {
    groups.push({ group: "spot_center", action: "aerial_beam", value: "split_wide" });
  }

  return groups;
}

// ─── Генерация DMX actions для первых 16 каналов ─────────────────────────────

function buildDMXActions(
  palette: string[],
  intensity: number,
  strobe: boolean,
  bass_energy: number,
  structure: TrackStructure
): DMXAction[] {
  const actions: DMXAction[] = [];
  const masterDim = Math.round(intensity * 255);

  // CH1: Master dimmer
  actions.push({ protocol: "Art-Net", universe: 0, channel: 1, value: masterDim });

  // CH2-4: RGB из первого цвета палитры
  const hex = palette[0] || "#ffffff";
  const r = parseInt(hex.slice(1, 3), 16) || 0;
  const g = parseInt(hex.slice(3, 5), 16) || 0;
  const b = parseInt(hex.slice(5, 7), 16) || 0;
  actions.push({ protocol: "Art-Net", universe: 0, channel: 2, value: r });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 3, value: g });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 4, value: b });

  // CH5: Bass pulse (суббас → импульс нижнего света)
  actions.push({ protocol: "Art-Net", universe: 0, channel: 5, value: Math.round(bass_energy * 255) });

  // CH6: Strobe
  actions.push({ protocol: "Art-Net", universe: 0, channel: 6, value: strobe && structure === "drop" ? 180 : 0 });

  // CH7-8: Pan/Tilt moving heads (центр на дропе, широко на брейкдауне)
  const pan = structure === "drop" ? 200 : structure === "breakdown" ? 128 : 160;
  const tilt = structure === "drop" ? 80 : 110;
  actions.push({ protocol: "Art-Net", universe: 0, channel: 7, value: pan });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 8, value: tilt });

  // CH9-11: Второй цвет для backlight
  const hex2 = palette[1] || palette[0] || "#0000ff";
  const r2 = parseInt(hex2.slice(1, 3), 16) || 0;
  const g2 = parseInt(hex2.slice(3, 5), 16) || 0;
  const b2 = parseInt(hex2.slice(5, 7), 16) || 0;
  actions.push({ protocol: "Art-Net", universe: 0, channel: 9,  value: Math.round(r2 * intensity) });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 10, value: Math.round(g2 * intensity) });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 11, value: Math.round(b2 * intensity) });

  // CH12: Fog / Hazer
  const fogMap = { off: 0, low: 60, medium: 130, high: 210 };
  const fogLevel = structure === "buildup" ? "medium" : structure === "drop" ? "low" : "off";
  actions.push({ protocol: "Art-Net", universe: 0, channel: 12, value: fogMap[fogLevel] });

  // CH13: Zoom (narrow на дропе, wide на intro)
  actions.push({ protocol: "Art-Net", universe: 0, channel: 13, value: structure === "drop" ? 60 : 180 });

  // CH14: Speed moving heads
  const speedMap = { static: 0, slow: 60, medium: 130, fast: 220 };
  const spd: "static" | "slow" | "medium" | "fast" =
    structure === "drop" ? "fast" : structure === "buildup" ? "medium" : "slow";
  actions.push({ protocol: "Art-Net", universe: 0, channel: 14, value: speedMap[spd] });

  // CH15-16: Accent colors (3й и 4й цвета палитры)
  const hex3 = palette[2] || "#ff0000";
  const r3 = parseInt(hex3.slice(1, 3), 16) || 0;
  const g3 = parseInt(hex3.slice(3, 5), 16) || 0;
  actions.push({ protocol: "Art-Net", universe: 0, channel: 15, value: Math.round(r3 * intensity * 0.8) });
  actions.push({ protocol: "Art-Net", universe: 0, channel: 16, value: Math.round(g3 * intensity * 0.8) });

  return actions;
}

// ─── Определение уровня риска сцены ──────────────────────────────────────────

function computeRiskLevel(
  energy: number,
  strobe: boolean,
  structure: TrackStructure,
  policy: ShowPolicy
): "low" | "medium" | "high" {
  if (policy === "safe") return "low";
  if (strobe && energy > 0.8 && structure === "drop") return "high";
  if (energy > 0.7 || (strobe && structure === "drop")) return "medium";
  return "low";
}

// ─── Имя сцены ────────────────────────────────────────────────────────────────

function buildSceneName(mood: MoodType, structure: TrackStructure, genre: string, energy: number): string {
  const structMap: Record<TrackStructure, string> = {
    intro: "RISE", buildup: "BUILD", drop: "PEAK",
    breakdown: "VOID", outro: "FADE", unknown: "SCAN",
  };
  const moodMap: Record<MoodType, string> = {
    aggressive: "RED STORM", euphoric: "EUPHORIA", dark: "SHADOW",
    melancholic: "BLUE FOG", tense: "TENSION", relaxed: "DRIFT",
    hypnotic: "PULSE", energetic: "SURGE",
  };
  const energyTag = energy > 0.8 ? " MAX" : energy < 0.25 ? " DIM" : "";
  return `${moodMap[mood]} · ${structMap[structure]}${energyTag}`;
}

// ─── Основная функция режиссёра ───────────────────────────────────────────────

export function runAIDirector(input: DirectorInput): DirectorScene {
  const { audio, event_type, venue_size, artist_style, crowd_level,
          current_scene, show_policy, mode, brand_rules } = input;

  const {
    genre, bpm, energy, mood, structure, structureProgress,
    energyTrend, trackFeatures,
  } = audio;

  const { kick_density, bass_energy, vocal_presence, spectral_brightness,
          drop_probability, silence_probability } = trackFeatures;

  const restrictions: string[] = [];

  // Получаем базовые правила по структуре
  const structureRule = STRUCTURE_RULES[structure] ?? STRUCTURE_RULES.unknown;

  // Строим цветовую палитру: mood-палитра + жанровые акценты
  let palette = PALETTES[mood] ?? PALETTES.energetic;
  if (PALETTES[genre]) {
    // Смешиваем: 2 цвета от mood + 2 от жанра
    palette = [...palette.slice(0, 2), ...PALETTES[genre].slice(0, 2)];
  }

  // Базовые параметры сцены
  let intensity = Math.min(1, energy * 1.2 + (structure === "drop" ? 0.15 : 0));
  let strobe = energy > 0.65 && structure === "drop" && show_policy !== "safe" && kick_density > 0.5;
  let contrast = Math.min(1, energy * 0.8 + bass_energy * 0.3);
  let warmth = mood === "aggressive" || mood === "dark" ? 0.1 : mood === "relaxed" || mood === "melancholic" ? 0.7 : 0.35;
  const brightness = Math.min(1, energy * 1.1 + spectral_brightness * 0.3);

  // Корректировки по venue_size
  if (venue_size === "arena") {
    intensity = Math.min(1, intensity + 0.1);
    contrast = Math.min(1, contrast + 0.15);
    restrictions.push("venue_arena_boosted");
  } else if (venue_size === "small") {
    intensity = Math.max(0.1, intensity - 0.1);
    strobe = strobe && energy > 0.8; // Строб только на очень высокой энергии
    restrictions.push("venue_small_dimmed");
  }

  // Корректировки по crowd_level
  if (crowd_level > 0.7) {
    intensity = Math.min(1, intensity + 0.08);
    restrictions.push("crowd_high_boosted");
  }

  // Приоритет безопасности: вокал → убрать строб, снизить интенсивность
  if (vocal_presence > 0.55) {
    strobe = false;
    intensity = Math.min(intensity, 0.6);
    warmth = Math.min(1, warmth + 0.3);
    restrictions.push("vocal_mode_soft");
  }

  // Silence / пауза → затемнение
  if (silence_probability > 0.7) {
    intensity = Math.min(intensity, 0.15);
    strobe = false;
    restrictions.push("silence_detected_blackout_partial");
  }

  // Строим params
  let params: DirectorScene["parameters"] = {
    color_palette: palette,
    intensity,
    movement: structureRule.movement,
    strobe,
    beam_width: structure === "drop" ? "narrow" : structure === "breakdown" ? "wide" : "medium",
    tempo_sync: bpm > 80 && energy > 0.3,
    fog: structureRule.fog,
    contrast,
    visual_density: structureRule.visual_density,
    warmth,
    brightness,
    pacing: structureRule.pacing,
  };

  // Применяем show_policy
  params = applyShowPolicy(params, show_policy, restrictions) as DirectorScene["parameters"];

  // Применяем brand_rules
  if (brand_rules) {
    const br = applyBrandRules(params, palette, brand_rules, restrictions);
    params = br.params as DirectorScene["parameters"];
    palette = br.palette;
    params.color_palette = palette;
  }

  // Строим fixture_groups
  const fixture_groups = buildFixtureGroups(
    structure, mood, energy, vocal_presence, bass_energy, show_policy
  );

  // Строим DMX actions
  const dmx_actions = buildDMXActions(palette, params.intensity, params.strobe, bass_energy, structure);

  // Risk level
  const risk_level = computeRiskLevel(energy, params.strobe, structure, show_policy);

  // Dominant signal
  const dominant_signal =
    silence_probability > 0.6 ? "silence" :
    vocal_presence > 0.55 ? "vocal_lead" :
    structure === "drop" ? "drop_impact" :
    structure === "buildup" ? "energy_rise" :
    bass_energy > 0.6 ? "bass_pulse" :
    kick_density > 0.6 ? "kick_drive" :
    spectral_brightness > 0.5 ? "bright_spectrum" :
    "musical_flow";

  // Timeline
  const durationByStructure: Record<TrackStructure, number> = {
    intro: 16000, buildup: 8000, drop: 32000,
    breakdown: 12000, outro: 16000, unknown: 4000,
  };
  const duration_ms = Math.round(durationByStructure[structure] * (1 - structureProgress * 0.5));

  const transitionIn =
    structure === "drop" ? "hard_cut_8ms" :
    structure === "buildup" ? "ramp_1000ms" :
    "crossfade_2000ms";

  const transitionOut =
    structure === "drop" ? "crossfade_500ms" :
    structure === "breakdown" ? "fade_3000ms" :
    "crossfade_1500ms";

  const nextStateTrigger =
    drop_probability > 0.7 ? "energy_peak_detected" :
    energyTrend === "falling" && energy < 0.3 ? "energy_below_0.3" :
    energyTrend === "rising" ? "energy_threshold_0.75" :
    "structure_change_detected";

  // Confidence: выше при более чётких сигналах
  const confidence = Math.min(1,
    0.3
    + (bpm > 80 ? 0.15 : 0)
    + (energy > 0.1 ? 0.15 : 0)
    + (structure !== "unknown" ? 0.2 : 0)
    + (dominant_signal !== "musical_flow" ? 0.1 : 0)
    + (Math.abs(energyTrend === "stable" ? 0 : 0.1))
  );

  // Fallback и emergency сцены
  const fallback_scene = vocal_presence > 0.5
    ? "soft_white_stage"
    : energy < 0.3
    ? "ambient_blue_low"
    : "neutral_warm_medium";

  const emergency_stop_scene = "blackout_all_channels_0";

  // Подсказка для ручного вмешательства
  const manual_hint =
    mode === "manual_hint" || mode === "hybrid"
      ? `[${structureRule.phase.toUpperCase()}] Energy ${Math.round(energy * 100)}% · ${dominant_signal} · ` +
        `Рекомендуется: ${params.movement} movement, ${params.visual_density} density, ` +
        `${params.strobe ? "строб ON" : "строб OFF"}, ` +
        `палитра: ${palette.slice(0, 2).join(" / ")}`
      : `Авто-режим активен. Для перехвата нажмите Override и выберите сцену вручную.`;

  return {
    scene_name: buildSceneName(mood, structure, genre, energy),
    intention: buildIntention(mood, structure, vocal_presence, drop_probability, event_type, energy),
    confidence: parseFloat(confidence.toFixed(2)),
    context: {
      genre, bpm, energy: parseFloat(energy.toFixed(2)),
      mood, section: structure, event_type, venue_size,
      artist_style, crowd_level: parseFloat(crowd_level.toFixed(2)),
      current_scene, mode,
    },
    analysis: {
      dramaturgy_phase: structureRule.phase,
      dominant_signal,
      risk_level,
      lighting_role: structureRule.role,
    },
    parameters: params,
    fixture_groups,
    timeline: {
      start_ms: 0,
      duration_ms,
      transition_in: transitionIn,
      transition_out: transitionOut,
      next_state_trigger: nextStateTrigger,
    },
    dmx_actions,
    safety: {
      manual_override_hint: manual_hint,
      fallback_scene,
      emergency_stop_scene,
      restrictions_applied: restrictions,
    },
  };
}

function buildIntention(
  mood: MoodType,
  structure: TrackStructure,
  vocal_presence: number,
  drop_probability: number,
  event_type: EventType,
  energy: number
): string {
  if (vocal_presence > 0.55) {
    return "Поддержать читаемость вокала: минимальный визуальный шум, акцент на исполнителе.";
  }
  if (structure === "drop") {
    return `Усилить пиковый момент максимальным световым ударом, синхронизацией и визуальной плотностью для ${event_type}.`;
  }
  if (structure === "buildup") {
    return `Нагнетать ожидание через нарастание яркости, скорости и контраста до момента дропа.`;
  }
  if (structure === "breakdown") {
    return "Создать пространство и ожидание через снижение плотности и мягкую атмосферу.";
  }
  if (structure === "intro") {
    return "Мягко представить художественную концепцию шоу, задать настроение без перегрузки.";
  }
  if (drop_probability > 0.7) {
    return "Подготовить мощный переход: быстро наращивать интенсивность и движение к дропу.";
  }
  const moodIntentions: Record<MoodType, string> = {
    aggressive:  "Передать агрессивный импульс через резкий контраст и скоростное движение.",
    euphoric:    "Создать ощущение праздника и подъёма через яркие цвета и широкие паттерны.",
    dark:        "Сформировать тёмную, плотную атмосферу с глубоким рельефом тени и света.",
    melancholic: "Подчеркнуть эмоциональную глубину через мягкий синий свет и медленные переходы.",
    tense:       "Удержать нарастающее напряжение через быстрый ритм без разрядки.",
    relaxed:     "Поддержать атмосферу расслабленного потока с мягкими, плавными переходами.",
    hypnotic:    "Создать гипнотический цикл через монотонные, повторяющиеся паттерны движения.",
    energetic:   "Поддержать высокую энергию через яркость, темп и ритмическую синхронизацию.",
  };
  return moodIntentions[mood] ?? "Музыкальная синхронизация в текущем контексте.";
}
