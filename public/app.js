const outputPreview = document.getElementById("output-preview");
const outputJson = document.getElementById("output-json");
const generatedTime = document.getElementById("generated-time");
const downloadButton = document.getElementById("download-button");
const toast = document.getElementById("toast");
const reportButton = document.getElementById("report-button");
const viewLogsButton = document.getElementById("view-logs-button");
const tweakButton = document.getElementById("tweak-button");
const iterateButton = document.getElementById("iterate-button");
const shareButton = document.getElementById("share-button");
const viewPredictionButton = document.getElementById("view-prediction-button");
const deleteButton = document.getElementById("delete-button");

const modelButtons = document.querySelectorAll("[data-model-button]");
const outputTabs = document.querySelectorAll("[data-output-tab]");

let activeModelKey = "seedream";
let activeOutputTab = "preview";

const defaultPreviewAspect = Object.freeze({ width: 16, height: 9 });
let currentPreviewAspect = { ...defaultPreviewAspect };

const expectedAspectResolvers = {};

const createInitialState = (downloadExtension = "png") => ({
  imageUrl: null,
  prediction: null,
  elapsedSeconds: null,
  downloadExtension,
  defaultDownloadExtension: downloadExtension,
  aspect: { ...defaultPreviewAspect },
});

const modelStates = {
  seedream: createInitialState("png"),
  "nano-banana": createInitialState("jpg"),
};

const normalizePositiveNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const computeGcd = (a, b) => {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
};

const parseAspectRatioValue = (value) => {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  if (cleaned.includes(":")) {
    const [wRaw, hRaw] = cleaned.split(":");
    const width = normalizePositiveNumber(wRaw);
    const height = normalizePositiveNumber(hRaw);
    if (width && height) {
      return { width, height };
    }
  }
  return null;
};

const normalizeAspect = (aspect) => {
  if (!aspect || typeof aspect !== "object") {
    return { ...defaultPreviewAspect };
  }
  const width = normalizePositiveNumber(aspect.width);
  const height = normalizePositiveNumber(aspect.height);
  if (!width || !height) {
    return { ...defaultPreviewAspect };
  }
  const gcd = computeGcd(width, height);
  return { width: width / gcd, height: height / gcd };
};

const setPreviewAspect = (aspect) => {
  const normalized = normalizeAspect(aspect);
  outputPreview.style.setProperty(
    "--preview-aspect",
    `${normalized.width} / ${normalized.height}`,
  );
  currentPreviewAspect = normalized;
};

setPreviewAspect(defaultPreviewAspect);

const getExpectedAspectForModel = (modelKey) => {
  const resolver = expectedAspectResolvers[modelKey];
  if (typeof resolver === "function") {
    try {
      const aspect = resolver();
      if (aspect && typeof aspect === "object") {
        return aspect;
      }
    } catch (error) {
      console.warn("Failed to resolve preview aspect for model:", modelKey, error);
    }
  }
  return { ...defaultPreviewAspect };
};

const resetModelState = (modelKey, { preserveDownloadExtension = true } = {}) => {
  const state = modelStates[modelKey];
  if (!state) return;
  state.imageUrl = null;
  state.prediction = null;
  state.elapsedSeconds = null;
  state.aspect = { ...defaultPreviewAspect };
  if (!preserveDownloadExtension) {
    state.downloadExtension = state.defaultDownloadExtension;
  }
};

const applyStateToPreview = (modelKey, { fallbackAspect } = {}) => {
  if (modelKey !== activeModelKey) return;
  const state = modelStates[modelKey];
  if (!state) return;

  const previewAspect = state.imageUrl
    ? state.aspect || { ...defaultPreviewAspect }
    : fallbackAspect || getExpectedAspectForModel(modelKey);

  setPreviewAspect(previewAspect);

  if (state.imageUrl) {
    const imageElement = document.createElement("img");
    imageElement.alt = `${modelKey} preview`;
    imageElement.decoding = "async";
    imageElement.src = state.imageUrl;
    outputPreview.innerHTML = "";
    outputPreview.appendChild(imageElement);
    downloadButton.disabled = false;
  } else {
    outputPreview.innerHTML = `
      <div class="preview-placeholder">
        <span>Generated image will appear here</span>
      </div>
    `;
    downloadButton.disabled = true;
  }

  const prediction = state.prediction ?? {};
  outputJson.textContent = JSON.stringify(prediction, null, 2);

  generatedTime.textContent =
    typeof state.elapsedSeconds === "number" && Number.isFinite(state.elapsedSeconds)
      ? `${state.elapsedSeconds}s`
      : "—";
};

const updateStateWithImage = (modelKey, imageUrl, downloadExtension) => {
  const state = modelStates[modelKey];
  if (!state) return;

  if (downloadExtension) {
    state.downloadExtension = downloadExtension;
  }

  if (!imageUrl) {
    state.imageUrl = null;
    state.aspect = { ...defaultPreviewAspect };
    applyStateToPreview(modelKey);
    return;
  }

  state.imageUrl = imageUrl;
  state.aspect = state.aspect || { ...defaultPreviewAspect };
  applyStateToPreview(modelKey);

  const probe = new Image();
  probe.onload = () => {
    const width = normalizePositiveNumber(probe.naturalWidth);
    const height = normalizePositiveNumber(probe.naturalHeight);
    if (width && height) {
      state.aspect = normalizeAspect({ width, height });
    } else {
      state.aspect = { ...defaultPreviewAspect };
    }
    applyStateToPreview(modelKey);
  };
  probe.onerror = () => {
    state.imageUrl = null;
    state.aspect = { ...defaultPreviewAspect };
    if (modelKey === activeModelKey) {
      showToast("Failed to load generated image preview.", "error");
    }
    applyStateToPreview(modelKey);
  };
  probe.src = imageUrl;
};

function createRangeValueSync(input) {
  const badge = document.querySelector(`[data-range-value="${input.id}"]`);
  const update = () => {
    if (badge) {
      badge.textContent = input.value;
    }
  };
  input.addEventListener("input", update);
  update();
  return update;
}

function filesToBase64(input) {
  const files = Array.from(input?.files ?? []);
  if (!files.length) return Promise.resolve([]);

  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = (err) => reject(err);
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function showToast(message, type = "info") {
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.dataset.type = type;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 4000);
}

function normalizeImageValue(value, modelKey) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:")
  ) {
    return trimmed;
  }

  const base64Pattern = /^[A-Za-z0-9+/=\s]+$/;
  if (base64Pattern.test(trimmed) && trimmed.length > 100) {
    const state = modelStates[modelKey ?? activeModelKey] || modelStates[activeModelKey];
    const extension =
      state?.downloadExtension || state?.defaultDownloadExtension || "jpeg";
    const format = extension.replace(/[^a-z0-9]/gi, "") || "jpeg";
    return `data:image/${format};base64,${trimmed.replace(/\s/g, "")}`;
  }

  return null;
}

function extractImageUrl(prediction, modelKey) {
  if (!prediction) return null;
  const output = prediction.output ?? prediction.images ?? null;

  if (typeof output === "string") {
    return normalizeImageValue(output, modelKey);
  }

  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === "string") {
        const normalized = normalizeImageValue(item, modelKey);
        if (normalized) return normalized;
      }

      if (item && typeof item === "object") {
        const sources = [item.image, item.url, item.uri, item.path];
        for (const source of sources) {
          const normalized = normalizeImageValue(source, modelKey);
          if (normalized) return normalized;
        }
      }
    }
  }

  if (output && typeof output === "object") {
    const sources = [output.image, output.url, output.uri, output.path];
    for (const source of sources) {
      const normalized = normalizeImageValue(source, modelKey);
      if (normalized) return normalized;
    }
  }

  return null;
}

function setActiveOutputTab(tabName) {
  activeOutputTab = tabName;
  outputTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.getAttribute("data-output-tab") === tabName);
  });

  if (tabName === "preview") {
    outputPreview.classList.remove("hidden");
    outputJson.classList.add("hidden");
  } else {
    outputPreview.classList.add("hidden");
    outputJson.classList.remove("hidden");
  }
}

function toggleRunning(isRunning, config) {
  const runButton = config?.runButton;
  if (!runButton) return;

  if (isRunning) {
    runButton.dataset.originalHtml = runButton.innerHTML;
    runButton.innerHTML = "Generating…";
    runButton.disabled = true;
  } else {
    runButton.innerHTML = runButton.dataset.originalHtml || "Run";
    runButton.disabled = false;
  }
}

function createSeedreamConfig() {
  const form = document.getElementById("seedream-form");
  const promptField = document.getElementById("seedream-prompt");
  const fileInput = document.getElementById("seedream-image-input");
  const sizeSelect = document.getElementById("seedream-size");
  const aspectSelect = document.getElementById("seedream-aspect-ratio");
  const widthRange = document.getElementById("seedream-width");
  const heightRange = document.getElementById("seedream-height");
  const sequentialSelect = document.getElementById("seedream-sequential");
  const maxImagesRange = document.getElementById("seedream-max-images");

  let matchInputAspect = null;

  const defaults = {
    prompt:
      "a photo of a store front called 'Seedream 4', it sells books, a poster in the window says 'Seedream 4 now on Replicate'",
    size: "2K",
    aspect_ratio: "16:9",
    width: 2048,
    height: 2048,
    sequential_image_generation: "disabled",
    max_images: 1,
  };

  const updateWidthLabel = createRangeValueSync(widthRange);
  const updateHeightLabel = createRangeValueSync(heightRange);
  const updateMaxImagesLabel = createRangeValueSync(maxImagesRange);

  const dependentFields = form.querySelectorAll("[data-size-dependent]");

  function setSizeDependentState() {
    const isCustom = sizeSelect.value === "custom";
    dependentFields.forEach((field) => {
      field.classList.toggle("is-disabled", !isCustom);
      const rangeInput = field.querySelector('input[type="range"]');
      if (rangeInput) {
        rangeInput.disabled = !isCustom;
      }
    });
  }

  const getPreviewAspect = () => {
    if (sizeSelect.value === "custom") {
      const width = normalizePositiveNumber(widthRange.value) ?? defaults.width;
      const height = normalizePositiveNumber(heightRange.value) ?? defaults.height;
      return { width, height };
    }

    const aspectValue = aspectSelect.value;
    const parsed = parseAspectRatioValue(aspectValue);
    if (parsed) return parsed;

    if (aspectValue === "match_input_image" && matchInputAspect) {
      return matchInputAspect;
    }

    return { ...defaultPreviewAspect };
  };

  expectedAspectResolvers.seedream = () => getPreviewAspect();

  const applyPreviewAspect = () => {
    if (activeModelKey !== "seedream") return;
    if (modelStates.seedream.imageUrl) return;
    applyStateToPreview("seedream", { fallbackAspect: getPreviewAspect() });
  };

  const updateMatchInputAspectFromFile = () => {
    matchInputAspect = null;
    if (aspectSelect.value !== "match_input_image") {
      applyPreviewAspect();
      return;
    }
    const firstFile = fileInput.files?.[0];
    if (!firstFile) {
      applyPreviewAspect();
      return;
    }
    const objectUrl = URL.createObjectURL(firstFile);
    const image = new Image();
    image.onload = () => {
      const width = normalizePositiveNumber(image.naturalWidth);
      const height = normalizePositiveNumber(image.naturalHeight);
      matchInputAspect =
        width && height ? { width, height } : { ...defaultPreviewAspect };
      URL.revokeObjectURL(objectUrl);
      applyPreviewAspect();
    };
    image.onerror = () => {
      matchInputAspect = null;
      URL.revokeObjectURL(objectUrl);
      applyPreviewAspect();
    };
    image.src = objectUrl;
  };

  sizeSelect.addEventListener("change", setSizeDependentState);
  sizeSelect.addEventListener("change", () => {
    applyPreviewAspect();
  });

  aspectSelect.addEventListener("change", () => {
    if (aspectSelect.value === "match_input_image") {
      updateMatchInputAspectFromFile();
    } else {
      matchInputAspect = null;
      applyPreviewAspect();
    }
  });

  widthRange.addEventListener("input", () => {
    if (sizeSelect.value === "custom") {
      applyPreviewAspect();
    }
  });

  heightRange.addEventListener("input", () => {
    if (sizeSelect.value === "custom") {
      applyPreviewAspect();
    }
  });

  fileInput.addEventListener("change", updateMatchInputAspectFromFile);

  setSizeDependentState();

  function resetFields() {
    promptField.value = defaults.prompt;
    sizeSelect.value = defaults.size;
    aspectSelect.value = defaults.aspect_ratio;
    widthRange.value = defaults.width;
    heightRange.value = defaults.height;
    sequentialSelect.value = defaults.sequential_image_generation;
    maxImagesRange.value = defaults.max_images;
    updateWidthLabel();
    updateHeightLabel();
    updateMaxImagesLabel();
    setSizeDependentState();
    fileInput.value = "";
    matchInputAspect = null;
    applyPreviewAspect();
  }

  async function gatherPayload() {
    const prompt = promptField.value;
    const size = sizeSelect.value;
    const aspect_ratio = aspectSelect.value;
    const width = parseInt(widthRange.value, 10);
    const height = parseInt(heightRange.value, 10);
    const sequential_image_generation = sequentialSelect.value;
    const max_images = parseInt(maxImagesRange.value, 10);
    const image_input = await filesToBase64(fileInput);

    const payload = {
      model_key: "seedream",
      prompt,
      size,
      aspect_ratio,
      sequential_image_generation,
      max_images,
    };

    if (size === "custom") {
      payload.width = width;
      payload.height = height;
    }

    if (image_input.length) {
      payload.image_input = image_input;
    }

    return {
      payload,
      downloadExtension: "png",
    };
  }

  applyPreviewAspect();

  return {
    key: "seedream",
    form,
    promptField,
    fileInput,
    runButton: form.querySelector('[data-role="run"]'),
    resetButton: form.querySelector('[data-role="reset"]'),
    reset: resetFields,
    gatherPayload,
    getPreviewAspect,
    onActivate: () => {
      setSizeDependentState();
      applyPreviewAspect();
    },
  };
}

function createReviseConfig() {
  const form = document.getElementById("revise-form");
  const promptField = document.getElementById("revise-prompt");
  const fileInput = document.getElementById("revise-image-input");
  const aspectSelect = document.getElementById("revise-aspect-ratio");
  const outputFormatSelect = document.getElementById("revise-output-format");

  const defaults = {
    prompt:
      "A F-22 raptor fighter jet parked in front of a traditional Indonesian cottage, surrounded by lush palm trees and distant volcanoes. The lighting is golden hour, with warm sunlight reflecting off the jet's metallic surface. The camera angle is from below the jet, The scene is ultra-detailed, photorealistic, with realistic shadows, textures, and depth of field, captured in 8K cinematic quality.",
    aspect_ratio: "16:9",
    output_format: "jpg",
  };

  const getPreviewAspect = () => {
    return parseAspectRatioValue(aspectSelect.value) || { ...defaultPreviewAspect };
  };

  expectedAspectResolvers["nano-banana"] = () => getPreviewAspect();

  const applyPreviewAspect = () => {
    if (activeModelKey !== "nano-banana") return;
    if (modelStates["nano-banana"].imageUrl) return;
    applyStateToPreview("nano-banana", { fallbackAspect: getPreviewAspect() });
  };

  aspectSelect.addEventListener("change", applyPreviewAspect);

  function resetFields() {
    promptField.value = defaults.prompt;
    aspectSelect.value = defaults.aspect_ratio;
    outputFormatSelect.value = defaults.output_format;
    fileInput.value = "";
    applyPreviewAspect();
  }

  async function gatherPayload() {
    const prompt = promptField.value;
    const aspect_ratio = aspectSelect.value;
    const output_format = outputFormatSelect.value;
    const image_input = await filesToBase64(fileInput);

    const payload = {
      model_key: "nano-banana",
      prompt,
      aspect_ratio,
      output_format,
    };

    if (image_input.length) {
      payload.image_input = image_input;
    }

    return {
      payload,
      downloadExtension: output_format || "jpg",
    };
  }

  applyPreviewAspect();

  return {
    key: "nano-banana",
    form,
    promptField,
    fileInput,
    runButton: form.querySelector('[data-role="run"]'),
    resetButton: form.querySelector('[data-role="reset"]'),
    reset: resetFields,
    gatherPayload,
    getPreviewAspect,
  };
}

const modelConfigs = {
  seedream: createSeedreamConfig(),
  "nano-banana": createReviseConfig(),
};

const refreshPreviewAspectForModel = (modelKey) => {
  const fallbackAspect = getExpectedAspectForModel(modelKey);
  applyStateToPreview(modelKey, { fallbackAspect });
};

function setActiveModel(modelKey) {
  if (!modelConfigs[modelKey]) return;
  activeModelKey = modelKey;

  Object.entries(modelConfigs).forEach(([key, config]) => {
    config.form.classList.toggle("form--hidden", key !== modelKey);
    config.form.classList.toggle("form--active", key === modelKey);
    config.onActivate?.();
  });

  modelButtons.forEach((button) => {
    const isActive = button.getAttribute("data-model-button") === modelKey;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  refreshPreviewAspectForModel(modelKey);
}

async function handleSubmit(event, modelKey) {
  event.preventDefault();
  const config = modelConfigs[modelKey];
  if (!config) return;

  setActiveOutputTab("preview");

  try {
    const { payload, downloadExtension } = await config.gatherPayload();
    payload.prompt = (payload.prompt || "").trim();

    if (!payload.prompt) {
      showToast("Please provide a prompt before running the model.", "error");
      return;
    }

    const state = modelStates[modelKey];
    state.downloadExtension =
      downloadExtension || state.downloadExtension || state.defaultDownloadExtension;

    resetModelState(modelKey, { preserveDownloadExtension: true });
    applyStateToPreview(modelKey, { fallbackAspect: getExpectedAspectForModel(modelKey) });

    toggleRunning(true, config);

    const response = await fetch("/api/predictions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      const message = result?.error || "Failed to generate image.";
      showToast(message, "error");
      if (modelKey === activeModelKey) {
        outputJson.textContent = JSON.stringify(result ?? {}, null, 2);
        generatedTime.textContent = "—";
      }
      return;
    }

    const { prediction, elapsed_seconds } = result;

    state.prediction = prediction;
    const parsedElapsed =
      typeof elapsed_seconds === "number"
        ? elapsed_seconds
        : Number.parseFloat(elapsed_seconds);
    state.elapsedSeconds = Number.isFinite(parsedElapsed) ? Number(parsedElapsed.toFixed(2)) : null;

    const imageUrl = extractImageUrl(prediction, modelKey);

    if (!imageUrl) {
      showToast("Prediction finished but no image URL returned.", "error");
    }

    updateStateWithImage(modelKey, imageUrl, state.downloadExtension);

    if (modelKey === activeModelKey) {
      applyStateToPreview(modelKey);
    }

    showToast("Prediction complete.", "success");
  } catch (error) {
    console.error(error);
    showToast("Unexpected error while running the prediction.", "error");
  } finally {
    toggleRunning(false, config);
  }
}

function resetModelForm(modelKey, { silent = false } = {}) {
  const config = modelConfigs[modelKey];
  if (!config) return;

  resetModelState(modelKey, { preserveDownloadExtension: true });
  config.reset();
  refreshPreviewAspectForModel(modelKey);

  if (!silent && modelKey === activeModelKey) {
    applyStateToPreview(modelKey);
    showToast("Inputs reset to defaults.");
  }
}

modelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const modelKey = button.getAttribute("data-model-button");
    setActiveModel(modelKey);
  });
});

outputTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const tabName = tab.getAttribute("data-output-tab");
    setActiveOutputTab(tabName);
  });
});

Object.entries(modelConfigs).forEach(([modelKey, config]) => {
  config.form.addEventListener("submit", (event) => handleSubmit(event, modelKey));
  config.resetButton?.addEventListener("click", () => resetModelForm(modelKey));
});

downloadButton.addEventListener("click", () => {
  const state = modelStates[activeModelKey];
  if (!state?.imageUrl) return;

  const extension =
    state.downloadExtension || state.defaultDownloadExtension || "png";
  const safeExtension = extension.replace(/[^a-z0-9]/gi, "") || "png";
  const anchor = document.createElement("a");
  anchor.href = state.imageUrl;
  anchor.download = `playground-output.${safeExtension}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
});

const stubButtons = [
  [tweakButton, "Tweak feature not wired yet."],
  [iterateButton, "Iterate flow is not available in this playground."],
  [shareButton, "Share link support coming soon."],
  [reportButton, "Report flow is not available in this demo."],
  [viewLogsButton, "Logs are shown automatically in JSON output."],
  [viewPredictionButton, "Full prediction view is not implemented in this demo."],
  [
    deleteButton,
    () => {
      resetModelState(activeModelKey, { preserveDownloadExtension: true });
      applyStateToPreview(activeModelKey);
      showToast("Prediction cleared.", "success");
    },
  ],
];

stubButtons.forEach(([button, handler]) => {
  if (!button) return;
  if (typeof handler === "function") {
    button.addEventListener("click", handler);
  } else {
    button.addEventListener("click", () => showToast(handler));
  }
});

document.addEventListener("keydown", (event) => {
  const isCmdOrCtrl = event.metaKey || event.ctrlKey;
  if (isCmdOrCtrl && event.key.toLowerCase() === "enter") {
    event.preventDefault();
    const config = modelConfigs[activeModelKey];
    config?.form?.requestSubmit();
  }
});

resetModelForm("seedream", { silent: true });
resetModelForm("nano-banana", { silent: true });
setActiveModel(activeModelKey);
applyStateToPreview(activeModelKey);
