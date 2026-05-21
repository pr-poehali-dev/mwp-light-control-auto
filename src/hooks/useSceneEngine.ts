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
  const p = dirScene.parameters;
  const structure = dirScene.context.section as TrackStructure;
  const energy    = dirScene.context.energy;

  // Используем точные значения из директора
  const dimmer     = Math.round(p.intensity * 255);
  const strobeRate = p.strobe_rate ?? 0;
  const speed      = p.pan_speed ?? (p.movement === "fast" ? 220 : p.movement === "medium" ? 130 : 60);
  const zoom       = p.zoom ?? (p.beam_width === "narrow" ? 60 : p.beam_width === "wide" ? 200 : 128);
  const warmVal    = Math.round(p.warmth * 255);

  // Pan/Tilt — уникальные позиции для каждого прибора
  const panPositions  = [80, 176, 60, 196, 110, 145, 100, 156, 90, 128];
  const tiltPositions = [85, 90, 110, 100, 85, 90, 95, 80, 75, 70];
  // На дропе — динамический разброс, на breakdown — тихий ambient
  const basePan  = panPositions[fixtureIndex % panPositions.length];
  const baseTilt = tiltPositions[fixtureIndex % tiltPositions.length];
  const spread   = structure === "drop" ? Math.round(energy * 35) : 0;
  const pan  = Math.min(255, Math.max(0, basePan  + (fixtureIndex % 2 === 0 ? -spread : spread)));
  const tilt = Math.min(255, Math.max(0, baseTilt - (structure === "drop" ? Math.round(energy * 20) : 0)));

  // Gobo и призма
  const goboVal   = p.gobo_rotate ? Math.round(10 + energy * 50) : 0;
  const prismVal  = p.prism ? 127 : 0;

  switch (fixtureType) {

    case "LED Par": {
      // CH1:Dimmer  CH2:R  CH3:G  CH4:B  CH5:White  CH6:Amber  CH7:UV  CH8:Strobe
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      // Белый — при вокале или тёплом режиме
      dmx[4] = p.warmth > 0.55 ? Math.round(warmVal * 0.5) : 0;
      // Amber — при тёплом и вокальном режиме
      dmx[5] = p.warmth > 0.4 ? Math.round(warmVal * 0.35) : 0;
      // UV — при тёмном mood + высокая энергия
      dmx[6] = (energy > 0.7 && !p.strobe && structure === "drop") ? Math.round(energy * 70) : 0;
      // Strobe — точная частота из директора
      dmx[7] = strobeRate;
      break;
    }

    case "Moving Head": {
      // CH1:Pan  CH2:PanFine  CH3:Tilt  CH4:TiltFine  CH5:Speed
      // CH6:Dimmer  CH7:Strobe  CH8:R  CH9:G  CH10:B  CH11:White
      // CH12:Zoom  CH13:Focus  CH14:Gobo  CH15:GoboRot/Prism  CH16:Reset
      dmx[0] = pan;
      dmx[1] = 0;
      dmx[2] = tilt;
      dmx[3] = 0;
      dmx[4] = speed;
      dmx[5] = dimmer;
      dmx[6] = strobeRate;
      if (channelCount >= 10) { dmx[7] = r; dmx[8] = g; dmx[9] = b; }
      if (channelCount >= 12) { dmx[10] = p.warmth > 0.5 ? Math.round(warmVal * 0.4) : 0; dmx[11] = zoom; }
      if (channelCount >= 14) { dmx[12] = 128; dmx[13] = p.gobo_index ?? 0; }
      if (channelCount >= 16) {
        dmx[14] = prismVal || goboVal;
        dmx[15] = 0; // reset — никогда не трогаем
      }
      break;
    }

    case "Strobe": {
      // CH1:Intensity  CH2:Rate  CH3:Mode  CH4:Random  CH5:Color
      const strobeOn = p.strobe && (structure === "drop" || structure === "buildup");
      dmx[0] = strobeOn ? Math.min(255, dimmer + 30) : 0;
      dmx[1] = strobeOn ? strobeRate : 0;
      // Mode: 0=random, 20=sync, 40=burst — на дропе burst
      dmx[2] = structure === "drop" && energy > 0.8 ? 40 : strobeOn ? 20 : 0;
      dmx[3] = structure === "drop" && energy > 0.85 ? 80 : 0;
      // Цвет строба чередуется по индексу (левый/правый)
      dmx[4] = fixtureIndex % 2 === 0 ? r : b;
      break;
    }

    case "Spot": {
      // CH1:Dimmer  CH2:R  CH3:G  CH4:B  CH5:Indigo  CH6:Gobo  CH7:Rotate  CH8:Zoom
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      // Indigo/UV — только при тёмном mood
      dmx[4] = (energy > 0.55 && structure === "drop") ? Math.round(energy * 130) : 0;
      if (channelCount >= 6) dmx[5] = p.gobo_index ?? 0;
      if (channelCount >= 7) dmx[6] = goboVal;
      if (channelCount >= 8) dmx[7] = zoom;
      break;
    }

    case "Wash": {
      // CH1:R  CH2:G  CH3:B  CH4:White  CH5:Dimmer  CH6:Strobe  CH7:Mode
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      dmx[3] = p.warmth > 0.45 ? Math.round(warmVal * 0.55) : 0;
      dmx[4] = dimmer;
      // Wash строб только на дропе и только если политика разрешает
      dmx[5] = p.strobe && structure === "drop" ? Math.min(180, strobeRate) : 0;
      dmx[6] = 0;
      break;
    }

    case "Laser": {
      // CH1:Enable  CH2:Pattern  CH3:Size  CH4:Rotation  CH5:Speed  CH6:Color
      // Лазер включаем если strobe_rate > 0 (не safe-режим) или drop + высокая энергия
      const laserOn = (p.strobe_rate ?? 0) >= 0 && structure === "drop" && energy > 0.58 && p.visual_density !== "low";
      dmx[0] = laserOn ? 255 : 0;
      // Pattern: 0-50=static, 51-100=scan, 101-150=scatter, 151-200=radial
      dmx[1] = structure === "drop" ? Math.round(100 + energy * 80) : Math.round(energy * 50);
      dmx[2] = Math.round(80 + energy * 100);
      // Rotation: быстрее на дропе
      dmx[3] = structure === "drop" ? Math.round(100 + energy * 120) : Math.round(energy * 60);
      dmx[4] = Math.round(80 + energy * 120);
      // Colour cycling offset per fixture
      dmx[5] = (fixtureIndex * 43 + Math.round(energy * 60)) % 255;
      break;
    }

    default: {
      dmx[0] = dimmer;
      if (channelCount >= 4) { dmx[1] = r; dmx[2] = g; dmx[3] = b; }
      if (channelCount >= 5) dmx[4] = strobeRate;
      break;
    }
  }

  return dmx;
}

// ─── Роль прибора в сцене ────────────────────────────────────────────────────

function getFixtureRole(
  fixtureType: string,
  structure: string,
  strobeRate: number,
  intensity: number,
  vocal: number
): string {
  switch (fixtureType) {
    case "Moving Head":
      return structure === "drop" ? `sweep·${intensity}%` : `position·${intensity}%`;
    case "Strobe":
      return strobeRate > 0 && structure === "drop" ? `strobe ${strobeRate} DMX` : "off";
    case "Laser":
      return structure === "drop" && intensity > 55 ? `laser·active` : "laser·standby";
    case "LED Par":
      return vocal > 0.5 ? `warm fill·${intensity}%` : `color·${intensity}%`;
    case "Wash":
      return `wash·${intensity}%`;
    case "Spot":
      return intensity > 50 ? `spot·accent·${intensity}%` : `spot·fill·${intensity}%`;
    default:
      return `dim·${intensity}%`;
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
        dirScene.parameters.strobe_rate ?? 0,
        intensity,
        dirScene.parameters.warmth  // warmth как косвенный индикатор вокала (высокий warmth = vocal mode)
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