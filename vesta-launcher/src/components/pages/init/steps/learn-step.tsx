import { createSignal, For, Show, type JSX } from "solid-js";
import styles from "../init.module.css";

interface LearnStepProps {
  goNext: () => Promise<void>;
  goBack: () => Promise<void>;
}

interface Slide {
  title: string;
  body: string;
  illustration: JSX.Element;
}

const SLIDES: Slide[] = [
  {
    title: "Welcome, traveler.",
    body: "Before you step into new worlds, here is how everything fits together. Minecraft modding is simpler than it looks — you just need to know the pieces.",
    illustration: (
      <svg viewBox="0 0 200 140" class={styles["learn-illustration"]}>
        <circle
          cx="100"
          cy="70"
          r="45"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          opacity="0.2"
        />
        <circle
          cx="100"
          cy="70"
          r="30"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          opacity="0.15"
        />
        <rect
          x="85"
          y="55"
          width="30"
          height="30"
          rx="4"
          fill="hsla(var(--accent-base) / 0.15)"
          stroke="var(--primary)"
          stroke-width="1.5"
        />
        <path
          d="M95 65 L105 75 M105 65 L95 75"
          stroke="var(--primary)"
          stroke-width="2"
          stroke-linecap="round"
          opacity="0.6"
        />
        {Array.from({ length: 6 }).map((_, i) => (
          <circle
            cx={100 + 55 * Math.cos((i * 60 * Math.PI) / 180)}
            cy={70 + 55 * Math.sin((i * 60 * Math.PI) / 180)}
            r="3"
            fill="hsla(var(--accent-base) / 0.3)"
          />
        ))}
      </svg>
    ),
  },
  {
    title: "Minecraft runs on Java",
    body: "The programming language called Java was used to build Minecraft. But different versions of Minecraft require different versions of Java. Don't worry, Vesta will handle all the Java stuff for you.",
    illustration: (
      <svg viewBox="0 0 200 140" class={styles["learn-illustration"]}>
        <rect
          x="60"
          y="85"
          width="80"
          height="35"
          rx="4"
          fill="hsla(var(--accent-base) / 0.1)"
          stroke="var(--border-subtle)"
          stroke-width="1"
        />
        <text
          x="100"
          y="108"
          text-anchor="middle"
          font-size="11"
          font-weight="600"
          fill="currentColor"
          opacity="0.7"
        >
          Java
        </text>
        <rect
          x="75"
          y="50"
          width="50"
          height="35"
          rx="4"
          fill="hsla(var(--accent-base) / 0.15)"
          stroke="var(--primary)"
          stroke-width="1.5"
        />
        <text
          x="100"
          y="73"
          text-anchor="middle"
          font-size="10"
          font-weight="600"
          fill="var(--primary)"
        >
          Minecraft
        </text>
        <path
          d="M100 50 L100 35"
          stroke="var(--primary)"
          stroke-width="1.5"
          stroke-dasharray="3 2"
          opacity="0.4"
        />
        <rect
          x="90"
          y="20"
          width="20"
          height="15"
          rx="2"
          fill="hsla(var(--accent-base) / 0.2)"
          stroke="var(--primary)"
          stroke-width="1"
        />
      </svg>
    ),
  },
  {
    title: "Mods need a bridge.",
    body: "Minecraft was not built for changes. A Modloader is the bridge that allows mods to chane the way you play.",
    illustration: (
      <svg viewBox="0 0 200 140" class={styles["learn-illustration"]}>
        <rect
          x="20"
          y="30"
          width="45"
          height="25"
          rx="3"
          fill="hsla(var(--accent-base) / 0.1)"
          stroke="var(--border-subtle)"
          stroke-width="1"
        />
        <text
          x="42"
          y="47"
          text-anchor="middle"
          font-size="8"
          font-weight="600"
          fill="currentColor"
          opacity="0.7"
        >
          Mod
        </text>
        <rect
          x="20"
          y="65"
          width="45"
          height="25"
          rx="3"
          fill="hsla(var(--accent-base) / 0.1)"
          stroke="var(--border-subtle)"
          stroke-width="1"
        />
        <text
          x="42"
          y="82"
          text-anchor="middle"
          font-size="8"
          font-weight="600"
          fill="currentColor"
          opacity="0.7"
        >
          Mod
        </text>
        <rect
          x="20"
          y="100"
          width="45"
          height="25"
          rx="3"
          fill="hsla(var(--accent-base) / 0.1)"
          stroke="var(--border-subtle)"
          stroke-width="1"
        />
        <text
          x="42"
          y="117"
          text-anchor="middle"
          font-size="8"
          font-weight="600"
          fill="currentColor"
          opacity="0.7"
        >
          Mod
        </text>
        <rect
          x="77"
          y="55"
          width="46"
          height="45"
          rx="4"
          fill="hsla(var(--accent-base) / 0.15)"
          stroke="var(--primary)"
          stroke-width="2"
        />
        <text
          x="100"
          y="82"
          text-anchor="middle"
          font-size="10"
          font-weight="700"
          fill="var(--primary)"
        >
          Loader
        </text>
        <path
          d="M65 42 L77 70 M65 77 L77 77 M65 112 L77 85"
          stroke="var(--primary)"
          stroke-width="1.5"
          stroke-dasharray="3 2"
          opacity="0.4"
        />
        <rect
          x="135"
          y="55"
          width="45"
          height="45"
          rx="4"
          fill="hsla(var(--accent-base) / 0.08)"
          stroke="var(--border-subtle)"
          stroke-width="1"
        />
        <text
          x="157"
          y="82"
          text-anchor="middle"
          font-size="9"
          font-weight="600"
          fill="currentColor"
          opacity="0.6"
        >
          Game
        </text>
        <path
          d="M123 77 L135 77"
          stroke="var(--primary)"
          stroke-width="1.5"
          opacity="0.4"
        />
      </svg>
    ),
  },
  {
    title: "Choose your path.",
    body: "Forge and its modern successor, NeoForge, focus on deep, complex game overhauls, while Fabric and its fork, Quilt, prioritize a lightweight, high-performance experience with faster updates. Together, these four loaders represent the choice between heavy-duty content ecosystems and agile, modular performance.",
    illustration: (
      <svg viewBox="0 0 200 140" class={styles["learn-illustration"]}>
        {["Forge", "Fabric", "Neo", "Quilt"].map((name, i) => {
          const x = 30 + i * 45;
          const heights = [55, 45, 50, 40];
          return (
            <g>
              <rect
                x={x - 18}
                y={100 - heights[i]}
                width="36"
                height={heights[i]}
                rx="3"
                fill="hsla(var(--accent-base) / 0.1)"
                stroke={i === 1 ? "var(--primary)" : "var(--border-subtle)"}
                stroke-width={i === 1 ? "1.5" : "1"}
              />
              <text
                x={x}
                y={100 - heights[i] + 20}
                text-anchor="middle"
                font-size="8"
                font-weight="600"
                fill="currentColor"
                opacity="0.7"
              >
                {name}
              </text>
            </g>
          );
        })}
        <path
          d="M12 105 L188 105"
          stroke="var(--border-subtle)"
          stroke-width="1"
          opacity="0.3"
        />
      </svg>
    ),
  },
  {
    title: "Modpacks are a quick way to get started.",
    body: "A modpack is a curated collection of mods, configurations, and sometimes custom assets that work together to create a specific gameplay experience. They are an easy way to dive into modded Minecraft without having to pick and choose individual mods yourself.",
    illustration: (
      <svg viewBox="0 0 200 140" class={styles["learn-illustration"]}>
        <rect
          x="60"
          y="50"
          width="80"
          height="55"
          rx="6"
          fill="hsla(var(--accent-base) / 0.12)"
          stroke="var(--primary)"
          stroke-width="2"
        />
        <rect
          x="60"
          y="50"
          width="80"
          height="20"
          rx="6"
          fill="hsla(var(--accent-base) / 0.2)"
          stroke="var(--primary)"
          stroke-width="1.5"
        />
        <path
          d="M85 50 L90 40 L110 40 L115 50"
          fill="none"
          stroke="var(--primary)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <circle
          cx="100"
          cy="85"
          r="12"
          fill="hsla(var(--accent-base) / 0.15)"
          stroke="var(--primary)"
          stroke-width="1.5"
        />
        <path
          d="M94 85 L100 91 L106 79"
          fill="none"
          stroke="var(--primary)"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        {Array.from({ length: 4 }).map((_, i) => (
          <circle
            cx={70 + (i % 2) * 60}
            cy={35 + Math.floor(i / 2) * 12}
            r="4"
            fill="hsla(var(--accent-base) / 0.25)"
          />
        ))}
      </svg>
    ),
  },
];

function LearnStep(props: LearnStepProps) {
  const [currentSlide, setCurrentSlide] = createSignal(0);
  const [, setDirection] = createSignal<"left" | "right">("right");

  const goForward = () => {
    if (currentSlide() < SLIDES.length - 1) {
      setDirection("right");
      setCurrentSlide((s) => s + 1);
    }
  };

  const goBackward = () => {
    if (currentSlide() > 0) {
      setDirection("left");
      setCurrentSlide((s) => s - 1);
    }
  };

  return (
    <div class={styles["learn-step"]}>
      <div class={styles["learn-header"]}>
        <button
          class={styles["learn-skip-btn"]}
          onClick={() => void props.goNext()}
        >
          Skip
        </button>
      </div>

      <div class={styles["learn-deck"]}>
        <div class={`${styles["learn-slide"]} ${styles["learn-slide--enter"]}`}>
          <div class={styles["learn-illustration-wrap"]}>
            {SLIDES[currentSlide()].illustration}
          </div>
          <h3 class={styles["learn-slide-title"]}>
            {SLIDES[currentSlide()].title}
          </h3>
          <p class={styles["learn-slide-body"]}>
            {SLIDES[currentSlide()].body}
          </p>
        </div>
      </div>

      <div class={styles["learn-controls"]}>
        <button
          class={styles["learn-arrow"]}
          onClick={goBackward}
          disabled={currentSlide() === 0}
          aria-label="Previous slide"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div class={styles["learn-dots"]}>
          <For each={SLIDES}>
            {(_, i) => (
              <button
                class={styles["learn-dot"]}
                classList={{
                  [styles["learn-dot--active"]]: i() === currentSlide(),
                }}
                onClick={() => {
                  setDirection(i() > currentSlide() ? "right" : "left");
                  setCurrentSlide(i());
                }}
                aria-label={`Go to slide ${i() + 1}`}
              />
            )}
          </For>
        </div>

        <Show
          when={currentSlide() < SLIDES.length - 1}
          fallback={
            <button
              class={styles["learn-arrow"]}
              onClick={() => void props.goNext()}
              aria-label="Continue"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          }
        >
          <button
            class={styles["learn-arrow"]}
            onClick={goForward}
            aria-label="Next slide"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </Show>
      </div>
    </div>
  );
}

export default LearnStep;
