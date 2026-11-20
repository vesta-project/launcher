import { createSignal, untrack } from 'solid-js';
import { setting, updateSetting } from '../settings/config';

/**
 * The first-visit tour: a short look around the shell right after leaving setup. It only
 * holds which step is showing; the steps, spotlight and copy live in `app/tour`.
 * Finishing or skipping is remembered in the host's `tutorial_completed` field, which a
 * setup reset clears again.
 */
const [step, setStep] = createSignal<number | undefined>(undefined, { name: 'tourStep' });
/** The id of the step on screen (set by the overlay), so parts of the shell can act it out. */
const [showing, setShowing] = createSignal<string | undefined>(undefined, { name: 'tourShowing' });

export const tour = {
  /** The step index while the tour is open, otherwise undefined. */
  step,
  open: () => step() !== undefined,
  /** The step id on screen, e.g. 'status' while the tour points at the titlebar pill. */
  showing,
  setShowing,
  /** Opens the tour once per setup; a finished or skipped tour never comes back on its own. */
  offer() {
    if (untrack(() => setting('tutorial_completed') || step() !== undefined)) return;
    setStep(0);
  },
  /** Settings' "Take the tour": opens it again on request, whatever was seen before. */
  replay: () => setStep(0),
  go: (index: number) => setStep(Math.max(0, index)),
  end() {
    setStep(undefined);
    updateSetting('tutorial_completed', true);
  },
};
