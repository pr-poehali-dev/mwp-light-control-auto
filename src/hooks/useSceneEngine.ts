/**
 * DMX Scene Engine v3 — правильная адресация для 30+ приборов
 *
 * Исправлены критические ошибки предыдущей версии:
 * 1. Конфликт dmx_actions (CH1-16) с реальными приборами → dmx_actions убраны, всё через buildFixtureDMX
 * 2. Лазер-баг: (strobe_rate >= 0) всегда true → исправлено на explicit check
 * 3. Pan/Tilt зацикливались на 10 → расширен до 30 уникальных позиций
 * 4. Один dimmer на всё → групповая логика (front / mid / back / side / effect)
 * 5. Moving Head Focus = 128 константа → управляемый фокус
 * 6. Нет проверки overlap каналов → validateFixtures() с предупреждениями
 * 7. Реальные профили каналов с комментариями производителей
 */

import type { AudioAnalysis, MoodType, TrackStructure } from "./useWebAudio";
import { runAIDirector } from "./useAIDirector";
import type { DirectorInput, DirectorScene, EventType, VenueSize, ShowPolicy, DirectorMode } from "./useAIDirector";

export type { EventType, VenueSize, ShowPolicy, DirectorMode };
export type { DirectorScene };

// ─── Типы ─────────────────────────────────────────────────────────────────────

export type FixtureGroup = "front" | "mid" | "back" | "side" | "effect" | "fill";

export interface FixtureInScene {
  id: number;
  name: string;
  type: string;
  dmxStartChannel: number;   // 1-512 (1-indexed, как в пульте)
  channels: number;          // кол-во каналов прибора
  group?: FixtureGroup;      // световая группа для групповой логики
  universe?: number;         // DMX-универс (0 = Universe 1)
}

export interface GeneratedScene {
  name: string;
  description: string;
  mood: MoodType;
  structure: TrackStructure;
  dmxValues: number[];       // 512 каналов [0-255]
  fixtureStates: FixtureSceneState[];
  directorScene: DirectorScene;
  warnings: string[];        // предупреждения о конфликтах каналов
}

export interface FixtureSceneState {
  fixtureId: number;
  fixtureName: string;
  fixtureType: string;
  group: FixtureGroup;
  color: string;             // hex для визуализации
  intensity: number;         // 0-100
  role: string;
  dmxStart: number;
  dmxEnd: number;
  channels: number;
}

// ─── Утилиты цвета ────────────────────────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

function hexToRgb(hex: string): RGB {
  const h = (hex ?? "#888888").replace("#", "");
  if (h.length < 6) return { r: 128, g: 128, b: 128 };
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

function clamp(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

function getColorForGroup(palette: string[], group: FixtureGroup, idx: number, intensity: number): RGB {
  // Каждая группа берёт разный срез палитры для визуального разнообразия
  const groupOffset: Record<FixtureGroup, number> = {
    front: 0, mid: 1, back: 2, side: 3, effect: 0, fill: 1,
  };
  const offset = groupOffset[group] ?? 0;
  const hex = palette[(idx + offset) % palette.length] ?? "#ffffff";
  const c = hexToRgb(hex);
  return {
    r: clamp(c.r * intensity),
    g: clamp(c.g * intensity),
    b: clamp(c.b * intensity),
  };
}

// ─── Групповая интенсивность ───────────────────────────────────────────────────
// Разные группы приборов работают с разной яркостью для создания объёма

function getGroupIntensity(
  group: FixtureGroup,
  baseIntensity: number,
  structure: TrackStructure,
  energy: number
): number {
  switch (group) {
    case "front":
      // Фронтальный свет — стабильный, для читаемости артиста
      return Math.min(1, baseIntensity * (structure === "drop" ? 1.0 : 0.75));
    case "mid":
      // Средний — активный, синхронизируется с энергией
      return Math.min(1, baseIntensity * (0.7 + energy * 0.4));
    case "back":
      // Задний — контраст, ярче на пике
      return Math.min(1, baseIntensity * (structure === "drop" ? 1.15 : 0.6));
    case "side":
      // Боковой — создаёт объём, пульсирует с середины
      return Math.min(1, baseIntensity * (0.5 + energy * 0.5));
    case "effect":
      // Эффектовые (лазеры, стробы) — включаются только на пиках
      return structure === "drop" || structure === "buildup"
        ? Math.min(1, baseIntensity * (0.8 + energy * 0.2))
        : Math.min(1, baseIntensity * 0.3);
    case "fill":
      // Заполняющий — равномерный, не очень яркий
      return Math.min(1, baseIntensity * 0.65);
    default:
      return Math.min(1, baseIntensity);
  }
}

// ─── Pan/Tilt позиции для 30 приборов ─────────────────────────────────────────
// 30 уникальных позиций (не зацикливаются как раньше на 10)

const PAN_POSITIONS_30 = [
  80, 176, 60, 196, 110, 145, 100, 156, 90, 128,  // 1-10: базовые
  70, 186, 50, 206, 120, 135, 95,  160, 85, 140,  // 11-20: расширенные
  75, 180, 55, 200, 115, 140, 105, 150, 92, 132,  // 21-30: промежуточные
];

const TILT_POSITIONS_30 = [
  85, 90, 110, 100, 85, 90, 95, 80, 75, 70,   // 1-10
  88, 95, 105, 98,  82, 92, 97, 78, 73, 72,   // 11-20
  86, 91, 108, 99,  84, 91, 96, 79, 74, 71,   // 21-30
];

function calcPanTilt(
  fixtureIndex: number,
  group: FixtureGroup,
  structure: TrackStructure,
  energy: number,
  bpm: number
): { pan: number; tilt: number; speed: number } {
  const idx = fixtureIndex % 30;
  const basePan  = PAN_POSITIONS_30[idx] ?? 128;
  const baseTilt = TILT_POSITIONS_30[idx] ?? 90;

  // Боковые приборы смотрят в стороны, передние — вперёд
  const groupPanOffset: Record<FixtureGroup, number> = {
    front: 0, mid: 0, back: 0,
    side: fixtureIndex % 2 === 0 ? -40 : 40,  // левый/правый
    effect: 0, fill: 0,
  };

  let pan = basePan + (groupPanOffset[group] ?? 0);
  let tilt = baseTilt;
  let speed = clamp(Math.round(bpm * 0.8));

  if (structure === "drop") {
    // На дропе — динамический разброс от центра
    const spread = Math.round(energy * 40);
    pan = pan + (fixtureIndex % 2 === 0 ? -spread : spread);
    tilt = tilt - Math.round(energy * 22);
    speed = clamp(Math.round(100 + energy * 130));
  } else if (structure === "buildup") {
    // На buildup — сходимся к центру сверху
    const t = energy; // 0→1 прогресс нарастания
    pan = Math.round(pan * (1 - t * 0.3) + 128 * t * 0.3);
    tilt = Math.round(tilt - energy * 18);
    speed = clamp(Math.round(60 + energy * 100));
  } else if (structure === "breakdown" || structure === "outro") {
    // Широко, медленно
    speed = 20;
    tilt = tilt + 15;
  } else {
    speed = clamp(Math.round(40 + energy * 80));
  }

  return {
    pan:   clamp(pan),
    tilt:  clamp(tilt),
    speed: clamp(speed),
  };
}

// ─── Zoom по группе и структуре ───────────────────────────────────────────────

function calcZoom(group: FixtureGroup, structure: TrackStructure, energy: number): number {
  const baseZoom: Record<FixtureGroup, number> = {
    front: 160,   // широко — заливает сцену
    mid:   100,
    back:  60,    // узко — острые лучи
    side:  140,
    effect: 50,   // очень узко для эффектов
    fill:  200,   // максимально широко
  };
  const base = baseZoom[group] ?? 128;
  if (structure === "drop") return clamp(base - Math.round(energy * 40));
  if (structure === "buildup") return clamp(base - Math.round(energy * 20));
  if (structure === "breakdown") return clamp(base + 20);
  return base;
}

// ─── Focus по группе ──────────────────────────────────────────────────────────

function calcFocus(group: FixtureGroup, structure: TrackStructure): number {
  if (group === "front" || group === "fill") return 200;  // мягкий фокус
  if (group === "effect" || group === "back") return 80;   // резкий
  if (structure === "drop") return 100;
  return 150;
}

// ─── Строб-частота ────────────────────────────────────────────────────────────

function calcStrobeRate(bpm: number, energy: number, structure: TrackStructure, isEffect: boolean): number {
  if (structure !== "drop" && structure !== "buildup") return 0;
  if (energy < 0.6) return 0;
  // Effect-группа: более агрессивный строб
  if (isEffect && structure === "drop" && energy > 0.75) {
    // Восьмые = BPM*2 → в DMX-единицах (0-255 = 0-25 Hz для большинства стробов)
    return clamp(Math.round(bpm / 60 * 2 * 10));
  }
  if (structure === "buildup" && energy > 0.78) {
    return clamp(Math.round(bpm / 60 * 8));  // четверти
  }
  return 0;
}

// ─── Профили каналов DMX ──────────────────────────────────────────────────────
// Основаны на реальных профилях популярных приборов.
// ВАЖНО: канальная карта должна совпадать с прошивкой прибора!

function buildFixtureDMX(
  fixtureType: string,
  channelCount: number,
  color: RGB,
  group: FixtureGroup,
  dirScene: DirectorScene,
  fixtureIndex: number
): number[] {
  const dmx = new Array(channelCount).fill(0);
  const { r, g, b } = color;
  const p         = dirScene.parameters;
  const structure = dirScene.context.section as TrackStructure;
  const energy    = dirScene.context.energy;
  const bpm       = dirScene.context.bpm;

  const groupIntensity = getGroupIntensity(group, p.intensity, structure, energy);
  const dimmer         = clamp(groupIntensity * 255);
  const warmVal        = clamp(p.warmth * 255);
  const isEffect       = group === "effect";
  const strobeRate     = calcStrobeRate(bpm, energy, structure, isEffect);
  const { pan, tilt, speed } = calcPanTilt(fixtureIndex, group, structure, energy, bpm);
  const zoom           = calcZoom(group, structure, energy);
  const focus          = calcFocus(group, structure);

  switch (fixtureType) {

    // ── LED PAR (8 каналов) ──────────────────────────────────────────────────
    // Профиль: CHAUVET DJ SlimPAR Pro RGBA / EUROLITE LED PAR-56 / Generic 8ch
    // CH1: Master Dimmer (0-255)
    // CH2: Red (0-255)
    // CH3: Green (0-255)
    // CH4: Blue (0-255)
    // CH5: White (0=off, 255=full white) — только для RGBW
    // CH6: Amber (0-255) — только для RGBA/RGBAW
    // CH7: UV/Strobe (0-7=off, 8-255=strobe slow→fast)
    // CH8: Programs/Macro (0=manual)
    case "LED Par": {
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      // White: добавляем при тёплом режиме (вокал) или break
      dmx[4] = (p.warmth > 0.5 || structure === "breakdown" || structure === "intro")
        ? clamp(warmVal * 0.6)
        : 0;
      // Amber: тёплый заливной свет
      dmx[5] = p.warmth > 0.35 ? clamp(warmVal * 0.4) : 0;
      // UV: темно + дроп + не строб (строб и UV одновременно = хаос)
      dmx[6] = (energy > 0.72 && p.strobe === false && structure === "drop" && group !== "front")
        ? clamp(energy * 80)
        : 0;
      // Programs: 0 = manual control
      dmx[7] = 0;
      break;
    }

    // ── LED PAR 4CH (упрощённый) ─────────────────────────────────────────────
    // Профиль: Generic RGBD 4ch или бюджетные PAR-ы
    case "LED Par 4ch": {
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      dmx[3] = dimmer;
      break;
    }

    // ── MOVING HEAD BEAM (16 каналов) ────────────────────────────────────────
    // Профиль: CHAUVET Intimidator Beam 355 / Generic Moving Beam 16ch
    // CH1:  Pan (0-255 = 0°-540°)
    // CH2:  Pan Fine (0-255)
    // CH3:  Tilt (0-255 = 0°-270°)
    // CH4:  Tilt Fine (0-255)
    // CH5:  Speed Pan/Tilt (0=fast, 255=slow) — ИНВЕРТИРОВАН!
    // CH6:  Dimmer (0-255)
    // CH7:  Strobe (0-7=off, 8-255=slow→fast)
    // CH8:  Red (0-255)
    // CH9:  Green (0-255)
    // CH10: Blue (0-255)
    // CH11: White/CTO (0-255)
    // CH12: Zoom (0=narrow 10°, 255=wide 60°)
    // CH13: Focus (0=near, 255=far)
    // CH14: Gobo (0=open, steps by 10-15 each gobo)
    // CH15: Gobo Rotation / Prism (0=no, 1-127=spin CW, 128-255=spin CCW)
    // CH16: Programs (0=manual, else macros)
    case "Moving Head": {
      dmx[0]  = pan;
      dmx[1]  = 0;         // Pan Fine — не нужен для большинства задач
      dmx[2]  = tilt;
      dmx[3]  = 0;         // Tilt Fine
      // Speed: ИНВЕРТИРОВАН — 0=максимальная скорость, 255=минимальная
      dmx[4]  = clamp(255 - speed);
      dmx[5]  = dimmer;
      dmx[6]  = strobeRate;
      if (channelCount >= 10) { dmx[7] = r; dmx[8] = g; dmx[9] = b; }
      if (channelCount >= 12) {
        dmx[10] = p.warmth > 0.45 ? clamp(warmVal * 0.5) : 0;
        dmx[11] = zoom;
      }
      if (channelCount >= 14) {
        dmx[12] = focus;
        // Gobo: 0=открытый, переключаем на дропе
        dmx[13] = (structure === "drop" && energy > 0.7 && isEffect)
          ? clamp((fixtureIndex % 5) * 12 + 8)
          : 0;
      }
      if (channelCount >= 16) {
        // Gobo rotation: на дропе крутим в одну сторону, на buildup в другую
        dmx[14] = p.gobo_rotate
          ? (structure === "drop" ? clamp(60 + energy * 60) : clamp(200 - energy * 60))
          : 0;
        dmx[15] = 0; // Programs = manual, НИКОГДА не трогаем
      }
      break;
    }

    // ── MOVING HEAD WASH (16 каналов) ────────────────────────────────────────
    // Профиль: Robe Robin 600E Wash / CHAUVET Rogue R1X Wash
    // Аналогичный layout, но нет Gobo, есть Prism
    case "Moving Head Wash": {
      dmx[0]  = pan;
      dmx[1]  = 0;
      dmx[2]  = tilt;
      dmx[3]  = 0;
      dmx[4]  = clamp(255 - speed);
      dmx[5]  = dimmer;
      dmx[6]  = strobeRate;
      if (channelCount >= 10) { dmx[7] = r; dmx[8] = g; dmx[9] = b; }
      if (channelCount >= 12) {
        dmx[10] = p.warmth > 0.4 ? clamp(warmVal * 0.6) : 0;
        dmx[11] = zoom;
      }
      if (channelCount >= 14) {
        dmx[12] = focus;
        dmx[13] = 0; // no gobo on wash
      }
      if (channelCount >= 16) {
        // Prism: 0=off, 1-127=активен, 128-255=скорость вращения
        dmx[14] = p.prism && structure === "drop" ? clamp(64 + energy * 60) : 0;
        dmx[15] = 0;
      }
      break;
    }

    // ── STROBE (5-6 каналов) ─────────────────────────────────────────────────
    // Профиль: CHAUVET Intimidator Strobe LED 200 / Martin Atomic Colours
    // CH1: Intensity / Master (0-255)
    // CH2: Flash Rate (0=off, 1-250=0.5Hz→25Hz, 251-255=random)
    // CH3: Mode (0-15=Steady, 16-131=Strobe, 132-191=Pulse, 192-255=Random)
    // CH4: Dimmer Fine / Color (прибор-зависимо)
    // CH5: Color mixing (0=white, 128=mix, 255=color)
    // CH6: Programs (0=manual)
    case "Strobe": {
      const strobeOn = p.strobe && (structure === "drop" || structure === "buildup") && energy > 0.62;
      dmx[0] = strobeOn ? clamp(dimmer + 20) : 0;
      // Rate: строго ограничиваем 0-250 (251-255 = random — нежелательно)
      dmx[1] = strobeOn ? Math.min(250, strobeRate * 3) : 0;
      // Mode: на дропе с высокой энергией — burst (192-255=random опасен, используем 132-191=pulse)
      dmx[2] = structure === "drop" && energy > 0.82
        ? 150   // Pulse mode
        : strobeOn
        ? 60    // Strobe mode
        : 0;    // Steady (no flash)
      dmx[3] = strobeOn ? clamp(energy * 200) : 0;
      if (channelCount >= 5) {
        // Цвет чередуется по индексу для визуального разнообразия
        dmx[4] = fixtureIndex % 2 === 0 ? 0 : 128;
      }
      if (channelCount >= 6) dmx[5] = 0;
      break;
    }

    // ── SPOT / PROFILE (8 каналов) ───────────────────────────────────────────
    // Профиль: Robe Robin 600E Spot / Generic LED Spot 8ch
    // CH1: Dimmer
    // CH2: Red
    // CH3: Green
    // CH4: Blue
    // CH5: White/CW (для RGBW)
    // CH6: Gobo Wheel (0-7=open, 8-15=gobo1, 16-23=gobo2, ...)
    // CH7: Gobo Rotation (0=index, 1-127=CW, 128-255=CCW)
    // CH8: Zoom (0=narrow, 255=wide)
    case "Spot": {
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      // White: смягчаем цвет при вокале
      dmx[4] = (p.warmth > 0.5 || structure === "intro" || structure === "breakdown")
        ? clamp(warmVal * 0.4)
        : 0;
      if (channelCount >= 6) {
        // Gobo: открытый на breakdown/intro, эффект на дропе
        dmx[5] = (structure === "drop" && energy > 0.65 && isEffect)
          ? clamp(8 + (fixtureIndex % 7) * 16)  // разные гобо для разных приборов
          : 0;
      }
      if (channelCount >= 7) {
        dmx[6] = p.gobo_rotate ? clamp(30 + energy * 90) : 0;
      }
      if (channelCount >= 8) dmx[7] = zoom;
      break;
    }

    // ── WASH LIGHT (7-8 каналов) ─────────────────────────────────────────────
    // Профиль: Generic LED Wash 7ch / EUROLITE LED W-42/84 Wash
    // CH1: Red
    // CH2: Green
    // CH3: Blue
    // CH4: White (0=off, 255=full)
    // CH5: Master Dimmer
    // CH6: Strobe (0-7=off, 8-255=slow→fast)
    // CH7: Programs (0=manual)
    // CH8: Color Macros (0=manual)
    case "Wash": {
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      // White wash: активен при вокале, intro, breakdown
      dmx[3] = (p.warmth > 0.4 || structure === "breakdown" || structure === "intro")
        ? clamp(warmVal * 0.65)
        : 0;
      dmx[4] = dimmer;
      // Strobe на wash: только на дропе, только при разрешении политики
      dmx[5] = (p.strobe && structure === "drop" && energy > 0.72)
        ? Math.min(120, strobeRate * 2)  // ограничиваем wash-строб
        : 0;
      dmx[6] = 0;  // Programs = manual
      if (channelCount >= 8) dmx[7] = 0;
      break;
    }

    // ── LASER (6 каналов) ────────────────────────────────────────────────────
    // Профиль: Generic RGB Laser 6ch / Laserworld EL series
    // ВАЖНО: лазеры требуют safety interlock — CH1=0 = полное отключение
    // CH1: Enable/Safety (0=off, 255=on) — НИКОГДА не включать без Safety Interlock!
    // CH2: Pattern Select (0-255 = разные паттерны)
    // CH3: Size/Zoom (0=min, 255=max)
    // CH4: Rotation (0=stop, 1-127=CW 0→fast, 128=stop, 129-255=CCW slow→fast)
    // CH5: Horizontal Shift (0=left, 128=center, 255=right)
    // CH6: Color (0=red, 64=green, 128=blue, 192=white, 255=auto-cycle)
    case "Laser": {
      // ИСПРАВЛЕНИЕ КРИТИЧЕСКОГО БАГА: условие было (strobe_rate >= 0) — ВСЕГДА TRUE
      // Правильное условие: только drop + высокая энергия + не safe policy
      const laserOn = structure === "drop"
        && energy > 0.60
        && p.visual_density !== "low"
        && p.strobe !== false;  // если strobe=false, то safe policy → лазер тоже выкл

      dmx[0] = laserOn ? 255 : 0;
      // Pattern: 0-50=lines, 51-100=scan, 101-150=scatter, 151-200=radial, 201-255=tunnel
      dmx[1] = laserOn
        ? (energy > 0.85 ? clamp(150 + energy * 50) : clamp(80 + energy * 80))
        : 0;
      // Size: на дропе — больше
      dmx[2] = laserOn ? clamp(100 + energy * 130) : 0;
      // Rotation: смена направления по индексу прибора
      dmx[3] = laserOn
        ? (fixtureIndex % 2 === 0 ? clamp(40 + energy * 80) : clamp(180 + energy * 60))
        : 128; // 128 = stop (безопасно)
      // Horizontal: раскидываем по сцене
      dmx[4] = laserOn ? clamp(40 + (fixtureIndex % 4) * 50 + energy * 30) : 128;
      // Color cycling: на дропе быстро, иначе стоп
      dmx[5] = laserOn ? (energy > 0.8 ? 255 : clamp(fixtureIndex * 64)) : 0;
      break;
    }

    // ── HAZER / FOG MACHINE (3-4 канала) ────────────────────────────────────
    // Профиль: CHAUVET Haze Machine / Generic Fog 3ch
    // CH1: Output Amount (0=off, 255=full)
    // CH2: Fan Speed (0-255)
    // CH3: Timer/Interval (0=continuous, 255=long interval)
    // CH4: Programs
    case "Hazer":
    case "Fog Machine": {
      const fogMap = { off: 0, low: 60, medium: 130, high: 210 };
      const fogLevel = fogMap[p.fog] ?? 0;
      dmx[0] = fogLevel;
      // Fan: высокий на buildup для быстрого заполнения, низкий на drop (не перебивать свет)
      dmx[1] = structure === "buildup" ? clamp(fogLevel * 1.2) : clamp(fogLevel * 0.7);
      if (channelCount >= 3) {
        // Interval: на buildup непрерывно, на drop редко (не в момент пика)
        dmx[2] = structure === "buildup" ? 0 : structure === "drop" ? 200 : 100;
      }
      if (channelCount >= 4) dmx[3] = 0;
      break;
    }

    // ── LED BAR / STRIP (4 канала) ───────────────────────────────────────────
    // Профиль: Generic LED Strip 4ch RGBD
    case "LED Bar":
    case "LED Strip": {
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      dmx[3] = dimmer;
      break;
    }

    // ── PIXEL BAR (varies) ───────────────────────────────────────────────────
    // Упрощённый режим: управляем как единым прибором
    case "Pixel Bar": {
      dmx[0] = dimmer;
      if (channelCount >= 4) { dmx[1] = r; dmx[2] = g; dmx[3] = b; }
      break;
    }

    // ── DEFAULT FALLBACK ─────────────────────────────────────────────────────
    default: {
      dmx[0] = dimmer;
      if (channelCount >= 4) { dmx[1] = r; dmx[2] = g; dmx[3] = b; }
      if (channelCount >= 5) dmx[4] = strobeRate;
      break;
    }
  }

  return dmx;
}

// ─── Роль прибора в сцене ─────────────────────────────────────────────────────

function getFixtureRole(
  fixtureType: string,
  group: FixtureGroup,
  structure: string,
  strobeRate: number,
  intensity: number
): string {
  const grp = group.toUpperCase();
  switch (fixtureType) {
    case "Moving Head":
    case "Moving Head Wash":
      return structure === "drop" ? `${grp}·sweep·${intensity}%` : `${grp}·pos·${intensity}%`;
    case "Strobe":
      return strobeRate > 0 && structure === "drop" ? `${grp}·STROBE·${strobeRate}dmx` : `${grp}·off`;
    case "Laser":
      return structure === "drop" && intensity > 55 ? `${grp}·laser·ON` : `${grp}·laser·stby`;
    case "Hazer":
    case "Fog Machine":
      return `${grp}·fog`;
    case "LED Par":
    case "Wash":
    case "LED Bar":
      return `${grp}·color·${intensity}%`;
    case "Spot":
      return `${grp}·spot·${intensity}%`;
    default:
      return `${grp}·${intensity}%`;
  }
}

// ─── Проверка конфликтов каналов ──────────────────────────────────────────────

export function validateFixtures(fixtures: FixtureInScene[]): string[] {
  const warnings: string[] = [];
  const occupied: Map<number, string> = new Map();

  for (const f of fixtures) {
    const start = f.dmxStartChannel;
    const end   = f.dmxStartChannel + f.channels - 1;

    if (start < 1 || start > 512) {
      warnings.push(`⚠ ${f.name}: startChannel ${start} вне диапазона 1-512`);
      continue;
    }
    if (end > 512) {
      warnings.push(`⚠ ${f.name}: каналы ${start}-${end} выходят за 512 (обрезаны)`);
    }

    for (let ch = start; ch <= Math.min(end, 512); ch++) {
      const existing = occupied.get(ch);
      if (existing) {
        warnings.push(`🔴 КОНФЛИКТ CH${ch}: "${f.name}" перекрывает "${existing}"`);
      } else {
        occupied.set(ch, f.name);
      }
    }
  }

  // Проверяем что каналы используются хотя бы немного
  const totalUsed = occupied.size;
  if (totalUsed > 480) {
    warnings.push(`⚠ Использовано ${totalUsed}/512 каналов — близко к пределу`);
  }

  return warnings;
}

// ─── Вычисление стартового канала следующего прибора ─────────────────────────

export function nextChannel(fixtures: FixtureInScene[]): number {
  if (fixtures.length === 0) return 1;
  const last = fixtures.reduce((max, f) =>
    f.dmxStartChannel + f.channels > max ? f.dmxStartChannel + f.channels : max, 1
  );
  return Math.min(last, 513); // сигнализируем если нет места
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
  // 1. Запускаем AI-режиссёр
  const dirScene = runAIDirector({ audio: analysis, ...directorOptions } as DirectorInput);

  // 2. Проверяем конфликты каналов
  const warnings = validateFixtures(fixtures);

  // 3. 512-канальный универс (всё начинается с нулей — безопасное состояние)
  const dmxValues = new Array(512).fill(0);

  // 4. Палитра цветов
  const palette = dirScene.parameters.color_palette;

  // 5. Строим каждый прибор
  const fixtureStates: FixtureSceneState[] = [];

  for (let idx = 0; idx < fixtures.length; idx++) {
    const fixture = fixtures[idx];
    const group   = fixture.group ?? "mid";

    // Цвет для этого прибора (с учётом группы)
    const color = getColorForGroup(palette, group, idx, dirScene.parameters.intensity);

    // DMX-значения для каналов прибора
    const chValues = buildFixtureDMX(
      fixture.type,
      fixture.channels,
      color,
      group,
      dirScene,
      idx
    );

    // Записываем в универс (1-indexed → 0-indexed)
    const startIdx = fixture.dmxStartChannel - 1;
    for (let i = 0; i < chValues.length; i++) {
      const universeIdx = startIdx + i;
      if (universeIdx >= 0 && universeIdx < 512) {
        dmxValues[universeIdx] = chValues[i];
      }
    }

    // Состояние для UI
    const groupIntensity = getGroupIntensity(group, dirScene.parameters.intensity, analysis.structure, analysis.energy);
    const intensityPct   = Math.round(groupIntensity * 100);

    fixtureStates.push({
      fixtureId:   fixture.id,
      fixtureName: fixture.name,
      fixtureType: fixture.type,
      group,
      color:     rgbToHex(color.r, color.g, color.b),
      intensity: intensityPct,
      role:      getFixtureRole(fixture.type, group, analysis.structure, dirScene.parameters.strobe_rate ?? 0, intensityPct),
      dmxStart:  fixture.dmxStartChannel,
      dmxEnd:    fixture.dmxStartChannel + fixture.channels - 1,
      channels:  fixture.channels,
    });
  }

  return {
    name:        dirScene.scene_name,
    description: dirScene.intention,
    mood:        analysis.mood,
    structure:   analysis.structure,
    dmxValues,
    fixtureStates,
    directorScene: dirScene,
    warnings,
  };
}

// ─── Расстановка 30 приборов (реальная клубная инсталляция) ──────────────────
// Адресация сделана без пропусков, с учётом реальных каналов

export function getDefaultSceneFixtures(): FixtureInScene[] {
  let ch = 1;
  const f = (id: number, name: string, type: string, channels: number, group: FixtureGroup): FixtureInScene => {
    const fixture: FixtureInScene = { id, name, type, dmxStartChannel: ch, channels, group };
    ch += channels;
    return fixture;
  };

  return [
    // ── FRONT WASH (фронтальный заливной) — 4 × LED Par 8ch = CH 1-32
    f(1,  "Front Par L1",    "LED Par",      8, "front"),
    f(2,  "Front Par L2",    "LED Par",      8, "front"),
    f(3,  "Front Par R1",    "LED Par",      8, "front"),
    f(4,  "Front Par R2",    "LED Par",      8, "front"),

    // ── MID WASH (средний ряд) — 4 × LED Par 8ch = CH 33-64
    f(5,  "Mid Par L1",      "LED Par",      8, "mid"),
    f(6,  "Mid Par L2",      "LED Par",      8, "mid"),
    f(7,  "Mid Par R1",      "LED Par",      8, "mid"),
    f(8,  "Mid Par R2",      "LED Par",      8, "mid"),

    // ── MOVING HEADS (4 головы 16ch) = CH 65-128
    f(9,  "MH L1",           "Moving Head", 16, "mid"),
    f(10, "MH L2",           "Moving Head", 16, "mid"),
    f(11, "MH R1",           "Moving Head", 16, "mid"),
    f(12, "MH R2",           "Moving Head", 16, "mid"),

    // ── BACK BEAMS (задние заливные) — 4 × LED Par 8ch = CH 129-160
    f(13, "Back Par L1",     "LED Par",      8, "back"),
    f(14, "Back Par L2",     "LED Par",      8, "back"),
    f(15, "Back Par R1",     "LED Par",      8, "back"),
    f(16, "Back Par R2",     "LED Par",      8, "back"),

    // ── SIDE WASH (боковой свет) — 4 × Wash 7ch = CH 161-188
    f(17, "Side Wash L1",    "Wash",         7, "side"),
    f(18, "Side Wash L2",    "Wash",         7, "side"),
    f(19, "Side Wash R1",    "Wash",         7, "side"),
    f(20, "Side Wash R2",    "Wash",         7, "side"),

    // ── SPOT / FOLLOW SPOTS — 2 × Spot 8ch = CH 189-204
    f(21, "Spot C",          "Spot",         8, "front"),
    f(22, "Spot C2",         "Spot",         8, "front"),

    // ── STROBES — 4 × Strobe 5ch = CH 205-224
    f(23, "Strobe FL",       "Strobe",       5, "effect"),
    f(24, "Strobe FR",       "Strobe",       5, "effect"),
    f(25, "Strobe BL",       "Strobe",       5, "effect"),
    f(26, "Strobe BR",       "Strobe",       5, "effect"),

    // ── LASER — 2 × Laser 6ch = CH 225-236
    f(27, "Laser L",         "Laser",        6, "effect"),
    f(28, "Laser R",         "Laser",        6, "effect"),

    // ── HAZER — 1 × 3ch = CH 237-239
    f(29, "Hazer",           "Hazer",        3, "effect"),

    // ── LED BAR (горизонтальная полоса над сценой) — 1 × 4ch = CH 240-243
    f(30, "LED Bar C",       "LED Bar",      4, "fill"),
  ];
  // Итого: CH 1-243 использованы (269 каналов свободно)
}

// ─── Минимальная установка (10 приборов для теста) ───────────────────────────

export function getSmallRigFixtures(): FixtureInScene[] {
  let ch = 1;
  const f = (id: number, name: string, type: string, channels: number, group: FixtureGroup): FixtureInScene => {
    const fix: FixtureInScene = { id, name, type, dmxStartChannel: ch, channels, group };
    ch += channels;
    return fix;
  };
  return [
    f(1,  "Front Par L",  "LED Par",     8, "front"),
    f(2,  "Front Par R",  "LED Par",     8, "front"),
    f(3,  "MH Left",      "Moving Head", 16, "mid"),
    f(4,  "MH Right",     "Moving Head", 16, "mid"),
    f(5,  "Strobe L",     "Strobe",      5,  "effect"),
    f(6,  "Strobe R",     "Strobe",      5,  "effect"),
    f(7,  "Wash L",       "Wash",        7,  "side"),
    f(8,  "Wash R",       "Wash",        7,  "side"),
    f(9,  "Laser",        "Laser",       6,  "effect"),
    f(10, "Hazer",        "Hazer",       3,  "effect"),
  ];
}
