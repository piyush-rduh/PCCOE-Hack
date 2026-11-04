-- AGCRO relational schema (portable MySQL/PostgreSQL-style SQL; managed Webdev DB is MySQL-compatible)
CREATE TABLE IF NOT EXISTS farmers (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  location VARCHAR(255),
  phone VARCHAR(32),
  role VARCHAR(32) NOT NULL DEFAULT 'farmer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(32) NOT NULL DEFAULT 'FARMER' CHECK (role IN ('FARMER', 'ADMIN')),
  farmer_id VARCHAR(64),
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(32),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES farmers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash VARCHAR(128) PRIMARY KEY,
  jti VARCHAR(64),
  revoked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farms (
  id VARCHAR(64) PRIMARY KEY,
  farmer_id VARCHAR(64) NOT NULL,
  name VARCHAR(160) NOT NULL,
  area_acres DECIMAL(10,2) NOT NULL CHECK (area_acres > 0),
  soil_type VARCHAR(80),
  water_source VARCHAR(80),
  irrigation_method VARCHAR(80),
  available_water_litres DECIMAL(14,2) DEFAULT 0 CHECK (available_water_litres >= 0),
  location VARCHAR(255),
  source VARCHAR(40) NOT NULL DEFAULT 'FARMER_ENTERED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES farmers(id)
);

CREATE TABLE IF NOT EXISTS zones (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  area_acres DECIMAL(10,2) NOT NULL CHECK (area_acres > 0),
  soil_type VARCHAR(80),
  water_availability VARCHAR(40),
  current_crop VARCHAR(80),
  growth_stage VARCHAR(60),
  sensor_id VARCHAR(64),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id)
);

CREATE TABLE IF NOT EXISTS sensor_devices (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  zone_id VARCHAR(64),
  name VARCHAR(160) NOT NULL,
  token_hash VARCHAR(128) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'revoked')),
  last_reading_at TIMESTAMP NULL,
  firmware VARCHAR(80),
  source VARCHAR(40) NOT NULL DEFAULT 'LIVE_SENSOR',
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS sensor_readings (
  id VARCHAR(64) PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  farm_id VARCHAR(64) NOT NULL,
  zone_id VARCHAR(64),
  soil_moisture_pct DECIMAL(6,2),
  temperature_c DECIMAL(6,2),
  humidity_pct DECIMAL(6,2),
  water_level_pct DECIMAL(6,2),
  water_flow_lpm DECIMAL(8,2),
  recorded_at TIMESTAMP NOT NULL,
  source VARCHAR(40) NOT NULL,
  FOREIGN KEY (device_id) REFERENCES sensor_devices(id),
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id),
  INDEX idx_sensor_readings_farm_time (farm_id, recorded_at)
);

CREATE TABLE IF NOT EXISTS soil_tests (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  zone_id VARCHAR(64),
  parameter VARCHAR(80) NOT NULL,
  value DECIMAL(12,4) NOT NULL,
  unit VARCHAR(32),
  tested_at DATE NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'FARMER_ENTERED',
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS seasons (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  crop VARCHAR(80) NOT NULL,
  variety VARCHAR(120),
  season VARCHAR(32),
  year INT NOT NULL,
  area_acres DECIMAL(10,2) NOT NULL,
  yield_quintal DECIMAL(12,3) NOT NULL,
  selling_price_per_quintal DECIMAL(12,2) NOT NULL,
  expenses_json JSON NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'FARMER_ENTERED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id)
);

CREATE TABLE IF NOT EXISTS activities (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  zone_id VARCHAR(64),
  type VARCHAR(64) NOT NULL,
  activity_date DATE NOT NULL,
  quantity DECIMAL(12,3),
  unit VARCHAR(32),
  notes TEXT,
  source VARCHAR(40) NOT NULL DEFAULT 'FARMER_ENTERED',
  FOREIGN KEY (farm_id) REFERENCES farms(id),
  FOREIGN KEY (zone_id) REFERENCES zones(id)
);

CREATE TABLE IF NOT EXISTS decisions (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  category VARCHAR(80) NOT NULL,
  crop VARCHAR(80),
  status VARCHAR(32) NOT NULL,
  summary TEXT,
  source VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  severity VARCHAR(24) NOT NULL,
  category VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  acknowledged_at TIMESTAMP NULL,
  FOREIGN KEY (farm_id) REFERENCES farms(id)
);

CREATE TABLE IF NOT EXISTS weather_observations (
  id VARCHAR(64) PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  observed_for DATE NOT NULL,
  temperature_c DECIMAL(6,2),
  rainfall_mm DECIMAL(8,2),
  humidity_pct DECIMAL(6,2),
  source VARCHAR(40) NOT NULL,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farm_id) REFERENCES farms(id)
);

CREATE INDEX idx_zones_farm ON zones(farm_id);
CREATE INDEX idx_alerts_farm_ack ON alerts(farm_id, acknowledged);
CREATE INDEX idx_seasons_farm_year ON seasons(farm_id, year);
