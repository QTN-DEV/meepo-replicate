import path from "path";
import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const terminalStatuses = new Set(["succeeded", "failed", "canceled"]);
const pollIntervalMs = Number(process.env.REPLICATE_POLL_INTERVAL_MS || 2000);
const waitTimeoutMs = Number(process.env.REPLICATE_TIMEOUT_MS || 120000);
const DEFAULT_MODEL_KEY = (process.env.REPLICATE_DEFAULT_MODEL_KEY || "seedream").toLowerCase();

const MODEL_CONFIG = {
  seedream: {
    envKey: "REPLICATE_SEEDREAM_VERSION",
    version: process.env.REPLICATE_SEEDREAM_VERSION || process.env.REPLICATE_MODEL_VERSION,
  },
  "nano-banana": {
    envKey: "REPLICATE_NANO_BANANA_VERSION",
    version: process.env.REPLICATE_NANO_BANANA_VERSION,
  },
};

const DIMENSION_LIMITS = { min: 1024, max: 4096 };
const MAX_IMAGES_LIMITS = { min: 1, max: 15 };

const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/predictions", async (req, res) => {
  try {
    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res
        .status(500)
        .json({ error: "Missing REPLICATE_API_TOKEN in environment." });
    }

    const body = req.body || {};
    const rawModelKey = typeof body.model_key === "string" ? body.model_key : undefined;
    const modelKey = (rawModelKey || DEFAULT_MODEL_KEY).toLowerCase();
    const config = MODEL_CONFIG[modelKey];

    if (!config) {
      return res.status(400).json({
        error: `Unsupported model key "${modelKey}".`,
      });
    }

    if (!config.version) {
      const envHint =
        modelKey === "seedream"
          ? "REPLICATE_SEEDREAM_VERSION (or legacy REPLICATE_MODEL_VERSION)"
          : config.envKey || "model version environment variable";

      return res.status(500).json({
        error: `Missing ${envHint} for model "${modelKey}".`,
      });
    }

    const promptValue = typeof body.prompt === "string" ? body.prompt : "";
    const trimmedPrompt = promptValue.trim();

    if (!trimmedPrompt) {
      return res.status(400).json({ error: 'Field "prompt" is required.' });
    }

    const imageInput = Array.isArray(body.image_input)
      ? body.image_input.filter((item) => typeof item === "string" && item.trim())
      : [];

    let inputPayload = { prompt: trimmedPrompt };

    if (modelKey === "seedream") {
      const rawSize = typeof body.size === "string" ? body.size : "2K";
      const trimmedSize = typeof rawSize === "string" ? rawSize.trim() : "";
      const lowerSize = trimmedSize.toLowerCase();
      const upperSize = trimmedSize.toUpperCase();
      const size =
        lowerSize === "custom"
          ? "custom"
          : ["1K", "2K", "4K"].includes(upperSize)
            ? upperSize
            : "2K";
      const aspectRatio =
        typeof body.aspect_ratio === "string" ? body.aspect_ratio : "match_input_image";
      const sequential =
        typeof body.sequential_image_generation === "string"
          ? body.sequential_image_generation
          : "disabled";
      const parsedMaxImages = Number.parseInt(body.max_images, 10);
      const maxImages = Number.isNaN(parsedMaxImages)
        ? 1
        : clampNumber(parsedMaxImages, MAX_IMAGES_LIMITS.min, MAX_IMAGES_LIMITS.max);

      inputPayload = {
        prompt: trimmedPrompt,
        size,
        aspect_ratio: aspectRatio,
        sequential_image_generation: sequential,
        max_images: maxImages,
      };

      if (size === "custom") {
        const parsedWidth = Number.parseInt(body.width, 10);
        const parsedHeight = Number.parseInt(body.height, 10);

        if (!Number.isNaN(parsedWidth)) {
          inputPayload.width = clampNumber(parsedWidth, DIMENSION_LIMITS.min, DIMENSION_LIMITS.max);
        }

        if (!Number.isNaN(parsedHeight)) {
          inputPayload.height = clampNumber(
            parsedHeight,
            DIMENSION_LIMITS.min,
            DIMENSION_LIMITS.max,
          );
        }
      }

      if (imageInput.length > 0) {
        inputPayload.image_input = imageInput;
      }
    } else {
      const aspectRatio = typeof body.aspect_ratio === "string" ? body.aspect_ratio : "16:9";
      const outputFormat = typeof body.output_format === "string" ? body.output_format : "jpg";

      inputPayload = {
        prompt: trimmedPrompt,
        aspect_ratio: aspectRatio,
        output_format: outputFormat,
      };

      if (imageInput.length > 0) {
        inputPayload.image_input = imageInput;
      }
    }

    const replicateBody = {
      version: config.version,
      input: inputPayload,
    };

    const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
      },
      body: JSON.stringify(replicateBody),
    });

    const initialPrediction = await createResponse.json();

    if (!createResponse.ok) {
      return res.status(createResponse.status).json({
        error: initialPrediction?.error || "Failed to create prediction.",
        details: initialPrediction,
      });
    }

    let prediction = initialPrediction;
    const startedAt = Date.now();

    while (!terminalStatuses.has(prediction.status)) {
      if (Date.now() - startedAt > waitTimeoutMs) {
        return res.status(504).json({
          error: "Timed out while waiting for Replicate prediction to finish.",
          details: prediction,
        });
      }

      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));

      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        {
          headers: {
            Authorization: `Token ${token}`,
          },
        },
      );

      prediction = await pollResponse.json();

      if (!pollResponse.ok) {
        return res.status(pollResponse.status).json({
          error: prediction?.error || "Failed while polling prediction status.",
          details: prediction,
        });
      }
    }

    const elapsedSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(2));

    return res.json({
      elapsed_seconds: elapsedSeconds,
      prediction,
    });
  } catch (error) {
    console.error("[/api/predictions] unexpected error:", error);
    return res.status(500).json({
      error: "Unexpected server error.",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Nano Banana playground running at http://localhost:${PORT}`);
});
