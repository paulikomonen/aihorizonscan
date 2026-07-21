import { readFile, writeFile } from "node:fs/promises";

const input = JSON.parse(await readFile(new URL("../signals.json", import.meta.url), "utf8"));
const signals = Array.isArray(input) ? input : input.signals;
if (!Array.isArray(signals)) throw new Error("signals.json must contain an array or a signals array.");

const quote = (value) => value == null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const array = (value) => {
  const items = Array.isArray(value) ? value : String(value || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  return `array[${items.map(quote).join(",")}]::text[]`;
};

const rows = signals.map((s) => `(${[
  quote(s.signalId), quote(s.date), quote(s.geography), quote(s.pestecClass), quote(s.aiDomain),
  quote(s.sector), quote(s.foresightCharacter), quote(s.responseStage), quote(s.title),
  quote(s.description), quote(s.mainActors), quote(s.direction), quote(s.indicators),
  array(s.innovationStages), quote(s.innovationImpact), quote(s.source), quote(s.evidenceType), quote(s.origin)
].join(",")})`);

const sql = `-- Generated from signals.json. Do not edit manually.\ninsert into public.signals (signal_id, signal_date, geography, pestec_class, ai_domain, sector, foresight_character, response_stage, title, description, main_actors, direction, indicators, innovation_stages, innovation_impact, source, evidence_type, origin) values\n${rows.join(",\n")}\non conflict (signal_id) do update set\n  signal_date=excluded.signal_date, geography=excluded.geography, pestec_class=excluded.pestec_class,\n  ai_domain=excluded.ai_domain, sector=excluded.sector, foresight_character=excluded.foresight_character,\n  response_stage=excluded.response_stage, title=excluded.title, description=excluded.description,\n  main_actors=excluded.main_actors, direction=excluded.direction, indicators=excluded.indicators,\n  innovation_stages=excluded.innovation_stages, innovation_impact=excluded.innovation_impact,\n  source=excluded.source, evidence_type=excluded.evidence_type, origin=excluded.origin, updated_at=now();\n`;

await writeFile(new URL("../supabase/seed.sql", import.meta.url), sql);
console.log(`Generated supabase/seed.sql with ${signals.length} signals.`);
