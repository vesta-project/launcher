# Unslop audit — Terra

Vesta is a launcher for managing Minecraft instances and servers. Its existing direction is compact, practical, and technical: the instance and server data provide the visual interest, with status indicators as the recurring detail.

- Spacing: the create-instance review placed version facts against the pack name with little separation ? `server/pack/get-modpack.tsx` and `modpack.css` ? grouped each fact with a label and gave the groups a gap.
- Colour and type: the version facts had no explicit hierarchy ? the same review row ? use existing muted labels and theme text tokens for values.

This is a partial source audit; a fixture-based visual audit and the other requested pages and themes remain outstanding. Unslop by Damir Sokolovsky (@heydamir), CC BY 4.0.

## Alignment and theme follow-up

- Centered shared settings card headers and fixed button border-box sizing.
- Stretched segmented items within the track.
- Replaced world art and swatch fixed radii and shadows with theme tokens.
- Remaining literal audit and visual verification are incomplete.
- Replaced exact 4px, 6px, 8px and pill radii in account, library and server views with their matching theme tokens. Minecraft-specific colours and dynamic folder tints remain intentional artwork.
