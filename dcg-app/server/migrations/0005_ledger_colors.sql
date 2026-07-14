-- 0005: re-tint the per-UE accent colors to the ledger palette (muted
-- forest/brass/wine tones instead of the original bright SaaS colors), so
-- databases seeded before the redesign pick up the new look too. Matches by
-- UE code, which is stable and unique — safe to run against real data.
UPDATE ues SET color = '#6b7c3f' WHERE code = 'UE2';
UPDATE ues SET color = '#7a3346' WHERE code = 'UE3';
UPDATE ues SET color = '#a6402f' WHERE code = 'UE4';
UPDATE ues SET color = '#2f6b5e' WHERE code = 'UE6';
UPDATE ues SET color = '#b8863f' WHERE code = 'UE7';
UPDATE ues SET color = '#3f7d95' WHERE code = 'UE10';
UPDATE ues SET color = '#a85d72' WHERE code = 'UE11';
UPDATE ues SET color = '#8a6a3f' WHERE code = 'UE12';
