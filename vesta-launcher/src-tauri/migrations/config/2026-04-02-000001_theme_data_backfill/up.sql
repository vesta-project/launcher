-- Backfill canonical theme_data for existing config rows

UPDATE app_config
SET theme_id = COALESCE(NULLIF(TRIM(theme_id), ''), 'vesta');

UPDATE app_config
SET theme_data = CASE lower(theme_id)
    WHEN 'solar' THEN '{"id":"solar","name":"Solar","primaryHue":40,"opacity":50,"borderWidth":1,"style":"satin","gradientEnabled":false,"gradientType":"linear","gradientHarmony":"none","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'neon' THEN '{"id":"neon","name":"Neon","primaryHue":300,"opacity":0,"borderWidth":1,"style":"glass","gradientEnabled":true,"rotation":135,"gradientType":"linear","gradientHarmony":"complementary","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'classic' THEN '{"id":"classic","name":"Classic","primaryHue":210,"opacity":100,"borderWidth":1,"style":"flat","gradientEnabled":false,"gradientType":"linear","gradientHarmony":"none","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'forest' THEN '{"id":"forest","name":"Forest","primaryHue":140,"opacity":50,"borderWidth":1,"style":"satin","gradientEnabled":true,"rotation":90,"gradientType":"linear","gradientHarmony":"analogous","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'sunset' THEN '{"id":"sunset","name":"Sunset","primaryHue":270,"opacity":0,"borderWidth":1,"style":"glass","gradientEnabled":true,"rotation":180,"gradientType":"linear","gradientHarmony":"triadic","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'prism' THEN '{"id":"prism","name":"Prism","author":"Vesta Team","primaryHue":200,"opacity":20,"borderWidth":1,"style":"glass","gradientEnabled":true,"rotation":45,"gradientType":"linear","gradientHarmony":"triadic","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'midnight' THEN '{"id":"midnight","name":"Midnight","primaryHue":240,"opacity":100,"borderWidth":0,"style":"solid","gradientEnabled":false,"gradientType":"linear","gradientHarmony":"none","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'oldschool' THEN '{"id":"oldschool","name":"Old School","primaryHue":210,"opacity":100,"borderWidth":2,"style":"bordered","gradientEnabled":false,"gradientType":"linear","gradientHarmony":"none","backgroundOpacity":25,"windowEffect":"none"}'
    WHEN 'custom' THEN '{"id":"custom","name":"Custom","primaryHue":220,"opacity":0,"borderWidth":1,"style":"glass","gradientEnabled":true,"rotation":135,"gradientType":"linear","gradientHarmony":"none","backgroundOpacity":25,"windowEffect":"none"}'
    ELSE '{"id":"vesta","name":"Vesta","description":"Signature teal to purple to orange gradient","primaryHue":180,"opacity":0,"borderWidth":1,"style":"glass","gradientEnabled":true,"rotation":180,"gradientType":"linear","gradientHarmony":"triadic","backgroundOpacity":25,"windowEffect":"none","customCss":":root {\\n\\t\\t\\t\\t--theme-bg-gradient: linear-gradient(180deg, hsl(180 100% 50%), hsl(280 100% 25%), hsl(35 100% 50%));\\n\\t\\t\\t}"}'
END
WHERE theme_data IS NULL OR TRIM(theme_data) = '';

UPDATE app_config
SET background_hue = theme_primary_hue
WHERE background_hue IS NULL;
