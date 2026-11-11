/** Decoded textures shared by the 2D thumbnails and 3D preview. No GPU resources are cached. */
function decodeTexture(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      if (error) { image.src = ''; reject(error); }
      else resolve(image);
    };
    const timeout = setTimeout(() => finish(new Error('Skin texture timed out')), 30_000);
    image.onload = () => {
      void image.decode().then(() => finish(), () => finish(new Error('Skin texture decode failed')));
    };
    image.onerror = () => finish(new Error('Skin texture failed'));
    image.decoding = 'async';
    image.crossOrigin = 'anonymous';
    image.src = source;
  });
}

interface Job {
  source: string;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: unknown) => void;
}

/** Bound retained pixels and active/queued decodes, even during rapid hover previews. */
export class SkinTextureCache {
  private images = new Map<string, { image: HTMLImageElement; bytes: number }>();
  private pending = new Map<string, Promise<HTMLImageElement>>();
  private queue: Job[] = [];
  private active = 0;
  private bytes = 0;

  constructor(private decode = decodeTexture, private limits = {
    entries: 32, bytes: 8 * 1024 * 1024, concurrent: 4, queued: 32,
  }) {}

  load(source: string): Promise<HTMLImageElement> {
    const hit = this.images.get(source);
    if (hit) {
      this.images.delete(source);
      this.images.set(source, hit);
      return Promise.resolve(hit.image);
    }
    const pending = this.pending.get(source);
    if (pending) return pending;
    const job = { source } as Job;
    const promise = new Promise<HTMLImageElement>((resolve, reject) => Object.assign(job, { resolve, reject }));
    this.pending.set(source, promise);
    if (this.queue.length >= this.limits.queued) {
      const old = this.queue.shift()!;
      this.pending.delete(old.source);
      old.reject(new Error('Skin texture superseded'));
    }
    this.queue.push(job);
    this.drain();
    return promise;
  }

  private drain() {
    while (this.active < this.limits.concurrent && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void Promise.resolve().then(() => this.decode(job.source)).then((image) => {
        const bytes = image.naturalWidth * image.naturalHeight * 4;
        if (bytes > 0 && bytes <= this.limits.bytes) {
          this.images.set(job.source, { image, bytes });
          this.bytes += bytes;
          while (this.images.size > this.limits.entries || this.bytes > this.limits.bytes) {
            const [key, old] = this.images.entries().next().value!;
            this.images.delete(key);
            this.bytes -= old.bytes;
          }
        }
        this.finished(job);
        job.resolve(image);
      }, (error) => {
        this.finished(job);
        job.reject(error);
      });
    }
  }

  private finished(job: Job) {
    this.active--;
    this.pending.delete(job.source);
    this.drain();
  }
}

const textures = new SkinTextureCache();
export const loadSkinTexture = (source: string) => textures.load(source);
