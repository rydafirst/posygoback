INSERT INTO "packaging_presets" ("country_code", "code", "label", "kind", "length_mm", "width_mm", "height_mm")
SELECT DISTINCT "country_code", 'BAG-S', 'Small bag', 'BAG'::"packaging_kind", 350, 250, 30 FROM "packaging_presets"
ON CONFLICT ("country_code", "code") DO NOTHING;

INSERT INTO "packaging_presets" ("country_code", "code", "label", "kind", "length_mm", "width_mm", "height_mm")
SELECT DISTINCT "country_code", 'BAG-L', 'Large bag', 'BAG'::"packaging_kind", 500, 400, 50 FROM "packaging_presets"
ON CONFLICT ("country_code", "code") DO NOTHING;
