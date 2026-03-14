import { 
  onMount, 
  onCleanup, 
  createEffect, 
  splitProps, 
  JSX, 
  createSignal,
  on
} from "solid-js";
import { 
  SkinViewer, 
  WalkingAnimation,
  PlayerAnimation,
  FunctionAnimation
} from "skinview3d";

export interface SkinViewerProps extends JSX.HTMLAttributes<HTMLDivElement> {
  skinUrl?: string;
  capeUrl?: string;
  model?: "classic" | "slim";
  width?: number;
  height?: number;
  animation?: "walking" | "rotating" | "none";
  animationSpeed?: number;
  enableZoom?: boolean;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  onReady?: (viewer: SkinViewer) => void;
}

export function SkinView3d(props: SkinViewerProps) {
  const [local, others] = splitProps(props, [
    "skinUrl", 
    "capeUrl", 
    "model", 
    "width", 
    "height", 
    "animation", 
    "animationSpeed", 
    "enableZoom",
    "autoRotate",
    "autoRotateSpeed",
    "onReady"
  ]);

  let containerRef: HTMLDivElement | undefined;
  let viewer: SkinViewer | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const initViewer = () => {
    if (!containerRef) return;

    // Clear previous canvas if any
    containerRef.innerHTML = "";

    viewer = new SkinViewer({
      canvas: document.createElement("canvas"),
      width: local.width || containerRef.clientWidth || 300,
      height: local.height || containerRef.clientHeight || 400,
      skin: local.skinUrl || undefined as any,
      cape: local.capeUrl || undefined as any,
      model: local.model === "slim" ? "slim" : "default"
    });

    containerRef.appendChild(viewer.canvas);
    viewer.canvas.style.width = "100%";
    viewer.canvas.style.height = "100%";

    // Configure viewer
    viewer.controls.enableZoom = local.enableZoom ?? false;
    viewer.autoRotate = local.autoRotate ?? false;
    viewer.autoRotateSpeed = local.autoRotateSpeed ?? 2.0;
    viewer.background = null;

    // Apply animation
    updateAnimation();

    // Setup ResizeObserver
    resizeObserver = new ResizeObserver(() => {
      if (containerRef && viewer) {
        viewer.setSize(containerRef.clientWidth, containerRef.clientHeight);
      }
    });
    resizeObserver.observe(containerRef);

    if (local.onReady) {
      local.onReady(viewer);
    }
  };

  const updateAnimation = () => {
    if (!viewer) return;

    // In current skinview3d version, animation is a single property
    if (local.animation === "walking") {
      viewer.animation = new WalkingAnimation();
      viewer.animation.speed = local.animationSpeed ?? 0.5;
    } else if (local.animation === "rotating") {
      viewer.animation = new FunctionAnimation((player, progress) => {
        player.rotation.y = progress;
      });
      viewer.animation.speed = local.animationSpeed ?? 0.5;
    } else {
      viewer.animation = null as any;
    }
  };

  onMount(() => {
    initViewer();
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    viewer?.dispose();
  });

  // Reactive updates
  createEffect(on(() => local.skinUrl, (url) => {
    if (viewer) {
      viewer.loadSkin(url || undefined as any, { model: local.model === "slim" ? "slim" : "default" });
    }
  }));

  createEffect(on(() => local.capeUrl, (url) => {
    if (viewer) {
      if (!url) {
        viewer.loadCape(null as any);
      } else {
        viewer.loadCape(url as any);
      }
    }
  }));

  createEffect(on(() => local.model, (model) => {
    if (viewer) {
      // In skinview3d, playerObject.skin.texture is a Texture object, not a URL
      // To switch models for the current skin, we should just update modelType
      // If that doesn't work visually, we need to re-apply the texture source
      viewer.loadSkin(local.skinUrl || undefined as any, { model: model === "slim" ? "slim" : "default" });
    }
  }));

  createEffect(on(() => local.animation, () => {
    updateAnimation();
  }));

  createEffect(on(() => local.animationSpeed, (speed) => {
    if (viewer && viewer.animation) {
      viewer.animation.speed = speed ?? 0.5;
    }
  }));

  return (
    <div 
      ref={containerRef} 
      {...others}
      style={{ 
        width: "100%", 
        height: "100%",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        overflow: "hidden",
        ...(others.style as any)
      }} 
    />
  );
}
