/**
 * Minecraft's options.txt names keys like `key.keyboard.left.shift` and `key.mouse.left`.
 * These map browser key events to those names and back to readable labels.
 */
export const UNBOUND_KEY = 'key.keyboard.unknown';

const named: Record<string, string> = {
  Space: 'space',
  Enter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  ShiftLeft: 'left.shift',
  ShiftRight: 'right.shift',
  ControlLeft: 'left.control',
  ControlRight: 'right.control',
  AltLeft: 'left.alt',
  AltRight: 'right.alt',
  MetaLeft: 'left.win',
  MetaRight: 'right.win',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  CapsLock: 'caps.lock',
  Minus: 'minus',
  Equal: 'equal',
  BracketLeft: 'left.bracket',
  BracketRight: 'right.bracket',
  Backslash: 'backslash',
  Semicolon: 'semicolon',
  Quote: 'apostrophe',
  Backquote: 'grave.accent',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  Insert: 'insert',
  Delete: 'delete',
  Home: 'home',
  End: 'end',
  PageUp: 'page.up',
  PageDown: 'page.down',
  PrintScreen: 'print.screen',
  ScrollLock: 'scroll.lock',
  Pause: 'pause',
  NumLock: 'num.lock',
  ContextMenu: 'menu',
  NumpadAdd: 'keypad.add',
  NumpadSubtract: 'keypad.subtract',
  NumpadMultiply: 'keypad.multiply',
  NumpadDivide: 'keypad.divide',
  NumpadDecimal: 'keypad.decimal',
  NumpadEnter: 'keypad.enter',
  NumpadEqual: 'keypad.equal',
};

/** The options.txt name for a key press, or undefined for keys Minecraft cannot bind. */
export function minecraftKeyFromEvent(event: Pick<KeyboardEvent, 'code'>): string | undefined {
  const code = event.code;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return `key.keyboard.${letter[1].toLowerCase()}`;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return `key.keyboard.${digit[1]}`;
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) return `key.keyboard.keypad.${pad[1]}`;
  const fn = /^F(\d{1,2})$/.exec(code);
  if (fn) return `key.keyboard.f${fn[1]}`;
  return named[code] ? `key.keyboard.${named[code]}` : undefined;
}

/** DOM mouse buttons 0–4 in the order Minecraft numbers them. */
export function minecraftKeyFromMouse(button: number): string {
  return (
    ['key.mouse.left', 'key.mouse.middle', 'key.mouse.right', 'key.mouse.4', 'key.mouse.5'][button] ??
    `key.mouse.${button + 1}`
  );
}

/** Words inside a multi-part name, e.g. the `win` in `left.win`. */
const parts: Record<string, string> = { win: 'Cmd/Win', control: 'Ctrl' };

/** Whole key names with a conventional symbol or spelling. */
const words: Record<string, string> = {
  'caps.lock': 'Caps Lock',
  'page.up': 'Page Up',
  'page.down': 'Page Down',
  'print.screen': 'Print Screen',
  'scroll.lock': 'Scroll Lock',
  'num.lock': 'Num Lock',
  'grave.accent': '`',
  apostrophe: "'",
  minus: '-',
  equal: '=',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  'left.bracket': '[',
  'right.bracket': ']',
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

const title = (text: string) =>
  text
    .split('.')
    .map((part) => parts[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

/** A short label for a stored key, e.g. `key.keyboard.left.shift` → "Left Shift". Empty when unbound. */
export function minecraftKeyLabel(value: string): string {
  if (!value || value === UNBOUND_KEY) return '';
  const mouse = /^key\.mouse\.(.+)$/.exec(value);
  if (mouse) {
    const button = mouse[1];
    return button === 'left' || button === 'right' || button === 'middle'
      ? `${title(button)} Click`
      : `Mouse ${button}`;
  }
  const key = value.replace(/^key\.keyboard\./, '');
  if (words[key]) return words[key];
  const keypad = /^keypad\.(.+)$/.exec(key);
  if (keypad) return `Num ${words[keypad[1]] ?? title(keypad[1])}`;
  if (key.length === 1) return key.toUpperCase();
  return title(key);
}
