/**
 * Движок световых сцен — преобразует вывод AI Lighting Director
 * в DMX-команды для каждого прибора в сцене (512 каналов).
 */

import type { AudioAnalysis, MoodType, TrackStructure } from "./useWebAudio";
import { runAIDirector } from "./useAIDirector";
import type { DirectorInput, DirectorScene, EventType, VenueSize, ShowPolicy, DirectorMode } from "./useAIDirector";

// ─── Публичные типы ───────────────────────────────────────────────────────────

export type { EventType, VenueSize, ShowPolicy, DirectorMode };
export type { DirectorScene };

export interface FixtureInScene {
  id: number;
  name: string;
  type: string;
  dmxStartChannel: number;
  channels: number;
}

export interface GeneratedScene {
  name: string;
  description: string;
  mood: MoodType;
  structure: TrackStructure;
  dmxValues: number[];
  fixtureStates: FixtureSceneState[];
  directorScene: DirectorScene;
}

export interface FixtureSceneState {
  fixtureId: number;
  fixtureName: string;
  fixtureType: string;
  color: string;
  intensity: number;
  role: string;
}

// ─── Типы приборов ────────────────────────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  if (h.length < 6) return { r: 100, g: 100, b: 100 };
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b]
    .map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");
}

// Берём цвет из палитры по индексу прибора
function getColorFromPalette(palette: string[], idx: number, intensity: number): RGB {
  const hex = palette[idx % palette.length] ?? "#ffffff";
  const base = hexToRgb(hex);
  return {
    r: Math.round(base.r * intensity),
    g: Math.round(base.g * intensity),
    b: Math.round(base.b * intensity),
  };
}

// ─── Построение каналов для каждого типа прибора ──────────────────────────────

function buildFixtureDMX(
  fixtureType: string,
  channelCount: number,
  color: RGB,
  dirScene: DirectorScene,
  fixtureIndex: number
): number[] {
  const dmx = new Array(channelCount).fill(0);
  const { r, g, b } = color;
  const dimmer = Math.round(dirScene.parameters.intensity * 255);
  const strobe = dirScene.parameters.strobe;
  const movement = dirScene.parameters.movement;
  const structure = dirScene.context.section as TrackStructure;
  const energy = dirScene.context.energy;
  const bass_energy = dirScene.dmx_actions.find(a => a.channel === 5)?.value ?? 0;

  // Скорость в зависимости от movement
  const speedMap = { static: 0, slow: 60, medium: 130, fast: 220 };
  const speed = speedMap[movement] ?? 130;

  // Частота строба
  const strobeVal = strobe && structure === "drop" ? Math.round(60 + energy * 120) : 0;

  // Разные позиции pan/tilt для разных приборов
  const panPositions = [80, 128, 176, 60, 196, 100, 156, 110, 145, 90];
  const tiltPositions = [100, 80, 120, 70, 100, 90, 110, 85, 95, 75];
  const pan = panPositions[fixtureIndex % panPositions.length];
  const tilt = tiltPositions[fixtureIndex % tiltPositions.length];

  // Модификатор зума
  const zoom = dirScene.parameters.beam_width === "narrow" ? 60
    : dirScene.parameters.beam_width === "wide" ? 200
    : 128;

  switch (fixtureType) {
    case "LED Par": {
      // CH1:Dim CH2:R CH3:G CH4:B CH5:W CH6:Amber CH7:UV CH8:Strobe
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      dmx[4] = dirScene.parameters.warmth > 0.6 ? Math.round(dimmer * 0.4) : 0;
      dmx[5] = dirScene.parameters.warmth > 0.4 ? Math.round(dimmer * 0.3) : 0;
      dmx[6] = energy > 0.7 && !strobe ? Math.round(energy * 60) : 0;
      dmx[7] = strobeVal;
      break;
    }

    case "Moving Head": {
      // Pan, Pan Fine, Tilt, Tilt Fine, Speed, Dimmer, Strobe, R, G, B, W, Zoom...
      dmx[0] = pan;
      dmx[1] = 0;
      dmx[2] = tilt;
      dmx[3] = 0;
      dmx[4] = speed;
      dmx[5] = dimmer;
      dmx[6] = strobeVal;
      if (channelCount >= 10) { dmx[7] = r; dmx[8] = g; dmx[9] = b; }
      if (channelCount >= 12) { dmx[10] = 0; dmx[11] = zoom; }
      if (channelCount >= 14) { dmx[12] = Math.round(zoom * 0.8); dmx[13] = 0; }
      if (channelCount >= 16) {
        dmx[14] = structure === "drop" ? Math.round(energy * 180) : 0; // effects
        dmx[15] = 0; // reset
      }
      break;
    }

    case "Strobe": {
      // Intensity, Frequency, Mode, Random, Color
      const strobeActive = strobe && (structure === "drop" || structure === "buildup");
      const freq = strobeActive ? Math.round(30 + energy * 170) : 0;
      dmx[0] = strobeActive ? dimmer : 0;
      dmx[1] = freq;
      dmx[2] = energy > 0.75 ? 20 : 0;
      dmx[3] = energy > 0.8 ? 60 : 0;
      dmx[4] = fixtureIndex % 2 === 0 ? r : b;
      break;
    }

    case "Spot": {
      // Intensity, R, G, B, Indigo, Cycle
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      dmx[4] = energy > 0.6 ? Math.round(energy * 120) : 0;
      dmx[5] = 0;
      break;
    }

    case "Wash": {
      // R, G, B, W, Dimmer, Strobe, Mode
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      dmx[3] = dirScene.parameters.warmth > 0.5 ? Math.round(dimmer * 0.5) : 0;
      dmx[4] = dimmer;
      dmx[5] = strobe && structure === "drop" ? strobeVal : 0;
      dmx[6] = 0;
      break;
    }

    case "Laser": {
      const fogMap = { off: 0, low: 60, medium: 130, high: 210 };
      const laserOn = structure === "drop" && energy > 0.6;
      dmx[0] = laserOn ? 255 : 0;
      dmx[1] = Math.round(energy * 200);
      dmx[2] = Math.round(100 + energy * 80);
      dmx[3] = Math.round(energy * 180);
      dmx[4] = Math.round(100 + energy * 100);
      dmx[5] = Math.round(fixtureIndex * 42) % 255;
      // Используем fogMap для возможного расширения
      void bass_energy;
      void fogMap;
      break;
    }

    default: {
      dmx[0] = dimmer;
      if (channelCount >= 4) { dmx[1] = r; dmx[2] = g; dmx[3] = b; }
      break;
    }
  }

  return dmx;
}

// ─── Роль прибора в сцене ────────────────────────────────────────────────────

function getFixtureRole(
  fixtureType: string,
  structure: string,
  strobe: boolean,
  intensity: number
): string {
  switch (fixtureType) {
    case "Moving Head":
      return structure === "drop" ? "активное движение + цвет" : `позиция, ${intensity}%`;
    case "Strobe":
      return strobe && structure === "drop" ? `строб активен` : "выкл";
    case "Laser":
      return structure === "drop" && intensity > 60 ? "лазер активен" : "лазер выкл";
    case "LED Par":
    case "Wash":
      return `цвет + яркость ${intensity}%`;
    case "Spot":
      return intensity > 50 ? `акцент, ${intensity}%` : `фон, ${intensity}%`;
    default:
      return `яркость ${intensity}%`;
  }
}

// ─── Главная функция генерации сцены ─────────────────────────────────────────

export function generateScene(
  analysis: AudioAnalysis,
  fixtures: FixtureInScene[],
  directorOptions: {
    event_type: EventType;
    venue_size: VenueSize;
    artist_style: string;
    crowd_level: number;
    current_scene: string;
    show_policy: ShowPolicy;
    mode: DirectorMode;
  }
): GeneratedScene {
  // Запускаем AI-режиссёр
  const dirInput: DirectorInput = {
    audio: analysis,
    ...directorOptions,
  };
  const dirScene = runAIDirector(dirInput);

  // Создаём 512-канальный универс
  const dmxValues = new Array(512).fill(0);

  // Применяем dmx_actions из режиссёра в первые 16 каналов
  for (const action of dirScene.dmx_actions) {
    if (action.channel >= 1 && action.channel <= 512) {
      dmxValues[action.channel - 1] = action.value;
    }
  }

  // Строим состояния приборов
  const fixtureStates: FixtureSceneState[] = [];
  const palette = dirScene.parameters.color_palette;

  for (let idx = 0; idx < fixtures.length; idx++) {
    const fixture = fixtures[idx];
    const color = getColorFromPalette(palette, idx, dirScene.parameters.intensity);
    const chValues = buildFixtureDMX(
      fixture.type, fixture.channels, color, dirScene, idx
    );

    const startIdx = fixture.dmxStartChannel - 1;
    for (let i = 0; i < chValues.length && startIdx + i < 512; i++) {
      dmxValues[startIdx + i] = chValues[i];
    }

    const intensity = Math.round(dirScene.parameters.intensity * 100);

    fixtureStates.push({
      fixtureId: fixture.id,
      fixtureName: fixture.name,
      fixtureType: fixture.type,
      color: rgbToHex(color.r, color.g, color.b),
      intensity,
      role: getFixtureRole(
        fixture.type,
        dirScene.context.section,
        dirScene.parameters.strobe,
        intensity
      ),
    });
  }

  return {
    name: dirScene.scene_name,
    description: dirScene.intention,
    mood: analysis.mood,
    structure: analysis.structure,
    dmxValues,
    fixtureStates,
    directorScene: dirScene,
  };
}

// ─── Дефолтные приборы для автоадресации ─────────────────────────────────────

export function getDefaultSceneFixtures(): FixtureInScene[] {
  return [
    { id: 1,  name: "LED Par L1",    type: "LED Par",     dmxStartChannel: 1,   channels: 8  },
    { id: 2,  name: "LED Par L2",    type: "LED Par",     dmxStartChannel: 9,   channels: 8  },
    { id: 3,  name: "Moving Head L", type: "Moving Head", dmxStartChannel: 17,  channels: 14 },
    { id: 4,  name: "Moving Head R", type: "Moving Head", dmxStartChannel: 31,  channels: 14 },
    { id: 5,  name: "Strobe L",      type: "Strobe",      dmxStartChannel: 45,  channels: 5  },
    { id: 6,  name: "Spot C",        type: "Spot",        dmxStartChannel: 50,  channels: 6  },
    { id: 7,  name: "LED Par R1",    type: "LED Par",     dmxStartChannel: 56,  channels: 8  },
    { id: 8,  name: "Wash C",        type: "Wash",        dmxStartChannel: 64,  channels: 7  },
    { id: 9,  name: "Laser",         type: "Laser",       dmxStartChannel: 71,  channels: 6  },
    { id: 10, name: "LED Par R2",    type: "LED Par",     dmxStartChannel: 77,  channels: 8  },
  ];
}
