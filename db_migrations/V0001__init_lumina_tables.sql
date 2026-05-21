
CREATE TABLE IF NOT EXISTS presets (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  genre TEXT NOT NULL DEFAULT '',
  bpm INTEGER NOT NULL DEFAULT 120,
  color TEXT NOT NULL DEFAULT 'cyan',
  channels JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS history_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('ai', 'auto', 'manual')),
  message TEXT NOT NULL,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('artnet_ip', '192.168.1.10'),
  ('artnet_port', '6454'),
  ('artnet_universe', '0'),
  ('ai_sensitivity', '75'),
  ('ai_smoothing', '40'),
  ('beat_sync', 'true'),
  ('auto_preset', 'true')
ON CONFLICT (key) DO NOTHING;

INSERT INTO presets (name, genre, bpm, color, channels) VALUES
  ('Rave Storm',  'Techno',  140, 'cyan',   '[255,0,180,0,255,100,0,200]'),
  ('Jazz Club',   'Jazz',    90,  'amber',  '[180,120,60,0,80,40,0,100]'),
  ('Rock Anthem', 'Rock',    120, 'red',    '[255,200,0,180,255,0,160,200]'),
  ('Ambient Flow','Ambient', 60,  'purple', '[80,0,180,120,40,200,0,60]'),
  ('Pop Shine',   'Pop',     110, 'green',  '[200,180,100,60,180,120,80,160]'),
  ('Deep House',  'House',   128, 'blue',   '[120,0,255,80,100,200,0,180]')
ON CONFLICT DO NOTHING;

INSERT INTO history_events (event_type, message) VALUES
  ('ai',     'Система инициализирована'),
  ('manual', 'Загружены стандартные пресеты')
ON CONFLICT DO NOTHING;
