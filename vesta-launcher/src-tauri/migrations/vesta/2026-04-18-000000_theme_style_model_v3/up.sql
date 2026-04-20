-- Normalize deprecated style values in account theme_data and saved theme library payloads.

UPDATE account
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

UPDATE saved_themes
SET theme_data = CASE
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
        END,
        '$.allowHueChange',
        CASE
            WHEN COALESCE(
                json_extract(theme_data, '$.allowHueChange'),
                json_extract(theme_data, '$.allow_hue_change')
            ) = 1 THEN json('true')
            ELSE json('false')
        END,
        '$.allowStyleChange',
        CASE
            WHEN COALESCE(
                json_extract(theme_data, '$.allowStyleChange'),
                json_extract(theme_data, '$.allow_style_change')
            ) = 1 THEN json('true')
            ELSE json('false')
        END,
        '$.allowBorderChange',
        CASE
            WHEN COALESCE(
                json_extract(theme_data, '$.allowBorderChange'),
                json_extract(theme_data, '$.allow_border_change')
            ) = 1 THEN json('true')
            ELSE json('false')
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
