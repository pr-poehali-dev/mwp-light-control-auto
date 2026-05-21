/**
 * Движок световых сцен — автоматически строит DMX-сцену
 * из приборов в библиотеке на основе mood + structure музыки
 */

import type { AudioAnalysis, MoodType, TrackStructure } from "./useWebAudio";

// ─── Типы ─────────────────────────────────────────────────────────────────────

export interface FixtureInScene {
  id: number;
  name: string;
  type: string;
  dmxStartChannel: number; // начальный DMX-канал прибора в универсе
  channels: number;        // кол-во каналов
}

export interface GeneratedScene {
  name: string;
  description: string;
  mood: MoodType;
  structure: TrackStructure;
  dmxValues: number[];     // 512 каналов (0-255)
  fixtureStates: FixtureSceneState[];
}

export interface FixtureSceneState {
  fixtureId: number;
  fixtureName: string;
  fixtureType: string;
  color: string;           // hex цвет для визуализации
  intensity: number;       // 0-100
  role: string;            // что делает этот прибор в сцене
}

// ─── Цветовые палитры по настроению ──────────────────────────────────────────

type RGB = { r: number; g: number; b: number };

const MOOD_PALETTES: Record<MoodType, RGB[]> = {
  aggressive: [
    { r: 255, g: 0,   b: 0   }, // красный
    { r: 255, g: 30,  b: 0   }, // красно-оранжевый
    { r: 180, g: 0,   b: 255 }, // пурпурный
  ],
  euphoric: [
    { r: 0,   g: 200, b: 255 }, // голубой
    { r: 255, g: 0,   b: 200 }, // пурпурно-розовый
    { r: 255, g: 255, b: 0   }, // жёлтый
    { r: 0,   g: 255, b: 150 }, // зелёно-голубой
  ],
  dark: [
    { r: 0,   g: 0,   b: 180 }, // тёмно-синий
    { r: 80,  g: 0,   b: 120 }, // тёмно-фиолетовый
    { r: 0,   g: 60,  b: 80  }, // тёмный циан
  ],
  melancholic: [
    { r: 60,  g: 80,  b: 180 }, // синий
    { r: 100, g: 60,  b: 140 }, // фиолетовый
    { r: 40,  g: 40,  b: 100 }, // тёмно-синий
  ],
  tense: [
    { r: 255, g: 80,  b: 0   }, // оранжевый
    { r: 255, g: 0,   b: 80  }, // алый
    { r: 200, g: 200, b: 0   }, // желтый
  ],
  relaxed: [
    { r: 0,   g: 150, b: 255 }, // мягкий синий
    { r: 0,   g: 200, b: 150 }, // мятный
    { r: 100, g: 0,   b: 200 }, // мягкий фиолетовый
  ],
  hypnotic: [
    { r: 0,   g: 255, b: 180 }, // яркий циан-зелёный
    { r: 180, g: 0,   b: 255 }, // фиолетовый
    { r: 0,   g: 80,  b: 255 }, // синий
  ],
  energetic: [
    { r: 255, g: 150, b: 0   }, // оранжевый
    { r: 0,   g: 255, b: 0   }, // зелёный
    { r: 0,   g: 200, b: 255 }, // циан
  ],
};

// ─── Яркость и стробоскоп по структуре ───────────────────────────────────────

interface StructureParams {
  masterDimmer: number;    // 0-255
  strobeIntensity: number; // 0-255 (0 = выкл)
  movingSpeed: number;     // 0-255 (скорость движущихся голов)
  laserActive: boolean;
  panRange: number;        // 0-255: насколько широко двигаются головы
  tiltRange: number;
}

const STRUCTURE_PARAMS: Record<TrackStructure, StructureParams> = {
  intro: {
    masterDimmer:   80,
    strobeIntensity: 0,
    movingSpeed:    100,
    laserActive:    false,
    panRange:       80,
    tiltRange:      60,
  },
  buildup: {
    masterDimmer:   160,
    strobeIntensity: 30,
    movingSpeed:    180,
    laserActive:    false,
    panRange:       140,
    tiltRange:      100,
  },
  drop: {
    masterDimmer:   255,
    strobeIntensity: 60,
    movingSpeed:    220,
    laserActive:    true,
    panRange:       200,
    tiltRange:      160,
  },
  breakdown: {
    masterDimmer:   50,
    strobeIntensity: 0,
    movingSpeed:    60,
    laserActive:    false,
    panRange:       60,
    tiltRange:      40,
  },
  outro: {
    masterDimmer:   40,
    strobeIntensity: 0,
    movingSpeed:    40,
    laserActive:    false,
    panRange:       40,
    tiltRange:      30,
  },
  unknown: {
    masterDimmer:   120,
    strobeIntensity: 0,
    movingSpeed:    100,
    laserActive:    false,
    panRange:       128,
    tiltRange:      100,
  },
};

// ─── Названия сцен ────────────────────────────────────────────────────────────

const SCENE_NAMES: Partial<Record<`${MoodType}_${TrackStructure}`, string>> = {
  aggressive_drop:      "🔴 Красный Хаос",
  aggressive_buildup:   "🟠 Нарастающая Ярость",
  euphoric_drop:        "🌈 Эйфория",
  euphoric_buildup:     "✨ Подъём",
  dark_drop:            "🟣 Тёмный Удар",
  dark_breakdown:       "🌑 Тьма",
  melancholic_intro:    "💙 Синяя Дымка",
  melancholic_breakdown:"🔵 Тишина",
  tense_buildup:        "⚡ Напряжение",
  relaxed_intro:        "🌊 Волна",
  hypnotic_drop:        "🌀 Гипноз",
  energetic_drop:       "⚡ Энергия",
  energetic_buildup:    "🔥 Нагрев",
};

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map(v => Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0")).join("");
}

// Получить цвет из палитры по индексу прибора
function getColor(mood: MoodType, fixtureIndex: number, energy: number): RGB {
  const palette = MOOD_PALETTES[mood];
  const base = palette[fixtureIndex % palette.length];
  const boost = 0.7 + energy * 0.3;
  return {
    r: Math.round(base.r * boost),
    g: Math.round(base.g * boost),
    b: Math.round(base.b * boost),
  };
}

// ─── Генерация значений каналов под каждый тип прибора ────────────────────────

function buildFixtureDMX(
  fixtureType: string,
  channelCount: number,
  color: RGB,
  params: StructureParams,
  fixtureIndex: number,
  energy: number
): number[] {
  const dmx = new Array(channelCount).fill(0);
  const { r, g, b } = color;
  const dimmer = params.masterDimmer;

  switch (fixtureType) {
    case "LED Par": {
      // CH1: Dimmer, CH2: R, CH3: G, CH4: B, CH5: W, CH6: Amber, CH7: UV, CH8: Strobe
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      dmx[4] = 0; // белый выкл
      dmx[5] = Math.round(energy * 80); // немного янтарного от энергии
      dmx[6] = energy > 0.7 ? Math.round(energy * 60) : 0; // UV на высокой энергии
      dmx[7] = params.strobeIntensity;
      break;
    }
    case "Moving Head": {
      // Pan, Pan Fine, Tilt, Tilt Fine, Speed, Dimmer, Strobe, R, G, B, W, Zoom...
      // Разные позиции для разных приборов на сцене
      const panOffset = (fixtureIndex % 3) * 40;
      const tiltOffset = (fixtureIndex % 2) * 30;
      dmx[0] = Math.round(128 - params.panRange / 2 + panOffset); // Pan
      dmx[1] = 0; // Pan Fine
      dmx[2] = Math.round(80 + tiltOffset);                        // Tilt
      dmx[3] = 0; // Tilt Fine
      dmx[4] = params.movingSpeed;
      dmx[5] = dimmer;
      dmx[6] = params.strobeIntensity;
      if (channelCount >= 10) {
        dmx[7] = r;
        dmx[8] = g;
        dmx[9] = b;
      }
      if (channelCount >= 12) {
        dmx[10] = 0; // White
        dmx[11] = 128; // Zoom: средний
      }
      break;
    }
    case "Strobe": {
      // Intensity, Frequency, Mode, Random, Color
      const strobeFreq = params.strobeIntensity > 0
        ? Math.round(30 + energy * 150) // частота зависит от энергии
        : 0;
      dmx[0] = params.strobeIntensity > 0 ? dimmer : 0;
      dmx[1] = strobeFreq;
      dmx[2] = 0; // random mode
      dmx[3] = energy > 0.6 ? 60 : 0;
      dmx[4] = fixtureIndex % 2 === 0 ? r : b;
      break;
    }
    case "Spot": {
      // Intensity, R, G, B, Indigo, Cycle
      dmx[0] = dimmer;
      dmx[1] = r;
      dmx[2] = g;
      dmx[3] = b;
      dmx[4] = Math.round(energy * 100); // Индиго по энергии
      dmx[5] = 0;
      break;
    }
    case "Wash": {
      // R, G, B, W, Dimmer, Strobe, Mode
      dmx[0] = r;
      dmx[1] = g;
      dmx[2] = b;
      dmx[3] = 0; // White
      dmx[4] = dimmer;
      dmx[5] = params.strobeIntensity > 80 ? params.strobeIntensity : 0;
      dmx[6] = 0; // Static mode
      break;
    }
    case "Laser": {
      // Включение, Паттерн, Размер, Вращение, Скорость, Цвет
      dmx[0] = params.laserActive ? 255 : 0;
      dmx[1] = Math.round(energy * 200); // паттерн по энергии
      dmx[2] = Math.round(100 + energy * 80); // размер
      dmx[3] = Math.round(energy * 180); // вращение
      dmx[4] = Math.round(100 + energy * 100); // скорость
      dmx[5] = Math.round(fixtureIndex * 40) % 255; // цвет
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

// ─── Основная функция генерации сцены ────────────────────────────────────────

export function generateScene(
  analysis: AudioAnalysis,
  fixtures: FixtureInScene[]
): GeneratedScene {
  const { mood, structure, energy, bpm } = analysis;
  const params = STRUCTURE_PARAMS[structure] || STRUCTURE_PARAMS.unknown;

  // Немного усиливаем параметры под реальную энергию
  const energyBoost = 0.5 + energy * 0.5;
  const adjustedParams: StructureParams = {
    ...params,
    masterDimmer: Math.min(255, Math.round(params.masterDimmer * energyBoost)),
    strobeIntensity: Math.round(params.strobeIntensity * energyBoost),
  };

  // Создаём 512-канальный универс
  const dmxValues = new Array(512).fill(0);
  const fixtureStates: FixtureSceneState[] = [];

  fixtures.forEach((fixture, idx) => {
    const color = getColor(mood, idx, energy);
    const chValues = buildFixtureDMX(
      fixture.type,
      fixture.channels,
      color,
      adjustedParams,
      idx,
      energy
    );

    // Пишем каналы в универс (нумерация DMX с 1, массив с 0)
    const startIdx = fixture.dmxStartChannel - 1;
    for (let i = 0; i < chValues.length && startIdx + i < 512; i++) {
      dmxValues[startIdx + i] = chValues[i];
    }

    // Вычисляем интенсивность для визуализации
    const intensity = Math.round((adjustedParams.masterDimmer / 255) * 100);

    // Определяем роль прибора в сцене
    let role = "освещение";
    if (fixture.type === "Moving Head") {
      role = structure === "drop" ? "активное движение" : "позиция";
    } else if (fixture.type === "Strobe") {
      role = adjustedParams.strobeIntensity > 0 ? `строб ${Math.round(adjustedParams.strobeIntensity / 255 * 100)}%` : "выкл";
    } else if (fixture.type === "Laser") {
      role = adjustedParams.laserActive ? "лазер активен" : "лазер выкл";
    } else if (fixture.type === "LED Par" || fixture.type === "Wash") {
      role = `цвет, яркость ${Math.round(adjustedParams.masterDimmer / 255 * 100)}%`;
    }

    fixtureStates.push({
      fixtureId: fixture.id,
      fixtureName: fixture.name,
      fixtureType: fixture.type,
      color: rgbToHex(color.r, color.g, color.b),
      intensity,
      role,
    });
  });

  // Название сцены
  const key = `${mood}_${structure}` as keyof typeof SCENE_NAMES;
  const sceneName = SCENE_NAMES[key] || `${mood} / ${structure}`;

  // Описание сцены
  const structureLabels: Record<TrackStructure, string> = {
    intro: "интро",
    buildup: "buildup — нарастание",
    drop: "дроп — пик",
    breakdown: "брейкдаун — спад",
    outro: "аутро",
    unknown: "анализ...",
  };
  const moodLabels: Record<MoodType, string> = {
    aggressive: "агрессивное",
    euphoric: "эйфоричное",
    dark: "тёмное",
    melancholic: "меланхоличное",
    tense: "напряжённое",
    relaxed: "расслабленное",
    hypnotic: "гипнотическое",
    energetic: "энергичное",
  };

  const description = `${structureLabels[structure]} · ${moodLabels[mood]} · ${bpm > 0 ? `${bpm} BPM` : "BPM анализ..."}`;

  return {
    name: sceneName,
    description,
    mood,
    structure,
    dmxValues,
    fixtureStates,
  };
}

// ─── Хелпер: дефолтные приборы в сцене с автоадресацией ──────────────────────
// Используется когда пользователь не настроил свою конфигурацию

export function getDefaultSceneFixtures(): FixtureInScene[] {
  return [
    { id: 1, name: "LED Par L1",      type: "LED Par",     dmxStartChannel: 1,   channels: 8  },
    { id: 2, name: "LED Par L2",      type: "LED Par",     dmxStartChannel: 9,   channels: 8  },
    { id: 3, name: "Moving Head L",   type: "Moving Head", dmxStartChannel: 17,  channels: 14 },
    { id: 4, name: "Moving Head R",   type: "Moving Head", dmxStartChannel: 31,  channels: 14 },
    { id: 5, name: "Strobe L",        type: "Strobe",      dmxStartChannel: 45,  channels: 5  },
    { id: 6, name: "Spot C",          type: "Spot",        dmxStartChannel: 50,  channels: 6  },
    { id: 7, name: "LED Par R1",      type: "LED Par",     dmxStartChannel: 56,  channels: 8  },
    { id: 8, name: "Wash C",          type: "Wash",        dmxStartChannel: 64,  channels: 7  },
    { id: 9, name: "Laser",           type: "Laser",       dmxStartChannel: 71,  channels: 6  },
    { id: 10, name: "LED Par R2",     type: "LED Par",     dmxStartChannel: 77,  channels: 8  },
  ];
}
