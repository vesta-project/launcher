-- Normalize deprecated theme styles to the v3 style model.

UPDATE app_config
SET theme_style = CASE lower(COALESCE(theme_style, ''))
    WHEN 'satin' THEN 'frosted'
    WHEN 'bordered' THEN 'flat'
    WHEN 'solid' THEN 'flat'
    WHEN 'frosted' THEN 'frosted'
    WHEN 'flat' THEN 'flat'
    WHEN 'glass' THEN 'glass'
    ELSE 'glass'
END;

UPDATE app_config
SET theme_data = CASE
    WHEN theme_data IS NULL OR TRIM(theme_data) = '' THEN theme_data
    WHEN json_valid(theme_data) THEN json_set(
        theme_data,
        '$.style',
        CASE lower(COALESCE(json_extract(theme_data, '$.style'), ''))
            WHEN 'satin' THEN 'frosted'
            WHEN 'bordered' THEN 'flat'
            WHEN 'solid' THEN 'flat'
            WHEN 'frosted' THEN 'frosted'
            WHEN 'flat' THEN 'flat'
            WHEN 'glass' THEN 'glass'
            ELSE 'glass'
        END
    )
    ELSE REPLACE(
        REPLACE(
            REPLACE(theme_data, '"style":"satin"', '"style":"frosted"'),
            '"style":"solid"',
            '"style":"flat"'
        ),
        '"style":"bordered"',
        '"style":"flat"'
    )
END;
