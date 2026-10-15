import type { JSX } from '@solidjs/web';

// Glyphs the library draws itself (indicators, chevrons, close). Consumers pass
// their own icons through `icon` props; these are not a public icon set.
function Glyph(props: { children: JSX.Element; 'stroke-width'?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={props['stroke-width'] ?? 2}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export const CheckGlyph = () => (
  <Glyph stroke-width={3}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Glyph>
);

export const MinusGlyph = () => (
  <Glyph stroke-width={3}>
    <path d="M6 12h12" />
  </Glyph>
);

export const ChevronDownGlyph = () => (
  <Glyph>
    <path d="M6 9l6 6 6-6" />
  </Glyph>
);

export const ChevronUpGlyph = () => (
  <Glyph>
    <path d="M6 15l6-6 6 6" />
  </Glyph>
);

export const ChevronRightGlyph = () => (
  <Glyph>
    <path d="M9 6l6 6-6 6" />
  </Glyph>
);

export const ChevronLeftGlyph = () => (
  <Glyph>
    <path d="M15 6l-6 6 6 6" />
  </Glyph>
);

export const CloseGlyph = () => (
  <Glyph>
    <path d="M6 6l12 12M18 6L6 18" />
  </Glyph>
);

export const InfoGlyph = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4.5M12 8h.01" />
  </Glyph>
);

export const SuccessGlyph = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Glyph>
);

export const WarningGlyph = () => (
  <Glyph>
    <path d="M10.3 3.9L2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Glyph>
);

export const DangerGlyph = () => (
  <Glyph>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16h.01" />
  </Glyph>
);

export const CopyGlyph = () => (
  <Glyph>
    <rect x="8" y="8" width="13" height="13" rx="2" />
    <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
  </Glyph>
);

export const DownloadGlyph = () => (
  <Glyph>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </Glyph>
);

export const FolderGlyph = () => (
  <Glyph>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />
  </Glyph>
);

export const TrashGlyph = () => (
  <Glyph>
    <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Glyph>
);
