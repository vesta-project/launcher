import { createSignal } from "solid-js";

const [homeIntroVisible, setHomeIntroVisible] = createSignal(false);
const [homeIntroShowDemoCards, setHomeIntroShowDemoCards] = createSignal(false);
const [homeIntroSidebarVisible, setHomeIntroSidebarVisible] =
  createSignal(false);

export {
  homeIntroVisible,
  setHomeIntroVisible,
  homeIntroShowDemoCards,
  setHomeIntroShowDemoCards,
  homeIntroSidebarVisible,
  setHomeIntroSidebarVisible,
};

export function restartHomeIntro() {
  setHomeIntroVisible(true);
  setHomeIntroShowDemoCards(false);
  setHomeIntroSidebarVisible(false);
}
