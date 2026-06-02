import PlayIcon from "@assets/play.svg";
import { For } from "solid-js";
import styles from "./home-intro.module.css";

const DEMO_INSTANCES = [
  {
    name: "My First Instance",
    version: "1.21.4",
    modloader: "fabric" as const,
    hue: 120,
  },
  {
    name: "Minecraft Server",
    version: "1.20.1",
    modloader: "forge" as const,
    hue: 200,
  },
  {
    name: "The Best Modpack",
    version: "1.21.1",
    modloader: "neoforge" as const,
    hue: 280,
  },
  {
    name: "April Fools Update",
    version: "26w14a",
    modloader: "vanilla" as const,
    hue: 0,
  },
];

function DemoInstanceCard(props: {
  index: number;
  name: string;
  version: string;
  modloader: string;
  hue: number;
}) {
  const bgGradient = `linear-gradient(135deg, hsl(${props.hue} 60% 35%) 0%, hsl(${props.hue} 50% 20%) 100%)`;

  return (
    <div
      class={styles["demo-instance-card"]}
      style={
        {
          "--instance-bg-image": bgGradient,
          "animation-delay": `${props.index * 0.1}s`,
        } as any
      }
    >
      <div class={styles["demo-instance-card__top"]}>
        <button class={styles["demo-play-button"]}>
          <PlayIcon />
        </button>
      </div>
      <div class={styles["demo-instance-card__bottom"]}>
        <span class={styles["demo-instance-card__name"]}>{props.name}</span>
        <div class={styles["demo-instance-card__meta"]}>
          <p>{props.version}</p>
          {props.modloader !== "vanilla" && (
            <span class={styles["demo-modloader-badge"]}>
              {props.modloader}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function DemoInstanceCards() {
  return (
    <For each={DEMO_INSTANCES}>
      {(instance, i) => (
        <DemoInstanceCard
          index={i()}
          name={instance.name}
          version={instance.version}
          modloader={instance.modloader}
          hue={instance.hue}
        />
      )}
    </For>
  );
}

export default DemoInstanceCards;
