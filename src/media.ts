import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";

/**
 * Extraction d'images depuis une vidéo locale.
 *
 * Objectif : permettre à un modèle de *voir* réellement le contenu d'une vidéo
 * avant d'écrire sa description — au lieu de rédiger à l'aveugle depuis le seul
 * nom de fichier.
 */

const FFMPEG = (ffmpegPath as unknown as string) || "ffmpeg";

function run(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) =>
      reject(new Error(`ffmpeg introuvable ou non exécutable (${FFMPEG}) : ${err.message}`))
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stderr);
      else reject(new Error(`ffmpeg a échoué (code ${code}) : ${stderr.slice(-800)}`));
    });
  });
}

export interface ExtractedFrame {
  /** Position de l'image dans la vidéo, en secondes. */
  atSeconds: number;
  /** Image JPEG encodée en base64 (prête pour un bloc `image` MCP). */
  base64: string;
}

/**
 * Extrait `count` images réparties uniformément sur la durée de la vidéo.
 *
 * Les images sont redimensionnées et compressées : l'objectif est la lisibilité
 * du contenu (texte à l'écran, visages, interface filmée), pas la qualité photo.
 */
export async function extractFrames(args: {
  filePath: string;
  count?: number;
  durationSeconds?: number;
  width?: number;
}): Promise<ExtractedFrame[]> {
  const count = Math.min(Math.max(args.count ?? 6, 1), 12);
  const width = Math.min(Math.max(args.width ?? 420, 160), 960);
  const duration = args.durationSeconds && args.durationSeconds > 0 ? args.durationSeconds : undefined;

  const dir = await mkdtemp(join(tmpdir(), "frames-"));
  try {
    const timestamps: number[] = [];
    if (duration) {
      // On évite la toute première et la toute dernière seconde (souvent noires).
      const span = Math.max(duration - 2, 1);
      for (let i = 0; i < count; i++) {
        timestamps.push(1 + (span * (i + 0.5)) / count);
      }
    }

    if (timestamps.length > 0) {
      // Extraction ciblée : un seek précis par image, bien plus rapide qu'un
      // décodage intégral et garantit un échantillonnage régulier.
      await Promise.all(
        timestamps.map((ts, i) =>
          run([
            "-nostdin",
            "-ss",
            ts.toFixed(3),
            "-i",
            args.filePath,
            "-frames:v",
            "1",
            "-vf",
            `scale=${width}:-2`,
            "-q:v",
            "5",
            "-y",
            join(dir, `frame-${String(i).padStart(2, "0")}.jpg`),
          ])
        )
      );
    } else {
      // Durée inconnue : on laisse ffmpeg répartir les images lui-même.
      await run([
        "-nostdin",
        "-i",
        args.filePath,
        "-vf",
        `thumbnail,scale=${width}:-2`,
        "-frames:v",
        String(count),
        "-q:v",
        "5",
        "-y",
        join(dir, "frame-%02d.jpg"),
      ]);
    }

    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    if (files.length === 0) {
      throw new Error("Aucune image n'a pu être extraite de la vidéo.");
    }

    return Promise.all(
      files.map(async (file, i) => ({
        atSeconds: timestamps[i] ?? 0,
        base64: (await readFile(join(dir, file))).toString("base64"),
      }))
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
