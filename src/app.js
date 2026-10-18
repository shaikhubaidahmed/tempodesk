import {
  PLAN_SCHEMA,
  SAMPLE_INPUT,
  SAMPLE_PLAN,
  buildPrompt,
  formatPlanText,
  normalizePlan,
  parseOllamaResponse,
  validateLesson
} from "./core.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const elements = {
  form: $("#lessonForm"),
  studentName: $("#studentName"),
  instrument: $("#instrument"),
  level: $("#level"),
  minutes: $("#minutes"),
  days: $("#days"),
  lessonNotes: $("#lessonNotes"),
  characterCount: $("#characterCount"),
  errorSummary: $("#errorSummary"),
  errorList: $("#errorList"),
  generateButton: $("#generateButton"),
  emptyState: $("#emptyState"),
  loadingState: $("#loadingState"),
  resultContent: $("#resultContent"),
  resultError: $("#resultError"),
  resultErrorMessage: $("#resultErrorMessage"),
  settingsDialog: $("#settingsDialog"),
  ollamaUrl: $("#ollamaUrl"),
  modelName: $("#modelName"),
  modelNote: $("#modelNote"),
  connectionButton: $("#connectionButton"),
  connectionLabel: $("#connectionLabel"),
  connectionResult: $("#connectionResult"),
  toast: $("#toast")
};

let currentPlan = null;
let currentInput = null;
let toastTimer;
const isLoopbackUrl = (url) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(url);
const storedUrl = localStorage.getItem("tempodesk.ollamaUrl") || "";
const settings = {
  url: isLoopbackUrl(storedUrl) ? storedUrl : "http://localhost:11434",
  model: localStorage.getItem("tempodesk.model") || "gemma3:4b"
};

function readInput() {
  return {
    studentName: elements.studentName.value.trim(),
    instrument: elements.instrument.value,
    level: elements.level.value,
    minutes: Number(elements.minutes.value),
    days: Number(elements.days.value),
    lessonNotes: elements.lessonNotes.value.trim()
  };
}

function setView(view) {
  elements.emptyState.hidden = view !== "empty";
  elements.loadingState.hidden = view !== "loading";
  elements.resultContent.hidden = view !== "result";
  elements.resultError.hidden = view !== "error";
}

function showErrors(errors) {
  $$("[aria-invalid='true']").forEach((field) => field.removeAttribute("aria-invalid"));
  $$(".field-error").forEach((node) => { node.textContent = ""; });
  elements.errorList.replaceChildren();
  const entries = Object.entries(errors);
  elements.errorSummary.hidden = entries.length === 0;
  entries.forEach(([field, message]) => {
    const input = document.getElementById(field);
    const error = document.getElementById(`${field}Error`);
    if (input) input.setAttribute("aria-invalid", "true");
    if (error) error.textContent = message;
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${field}`;
    link.textContent = message;
    item.append(link);
    elements.errorList.append(item);
  });
  if (entries.length) elements.errorSummary.focus();
}

function fillExample() {
  Object.entries(SAMPLE_INPUT).forEach(([key, value]) => {
    if (elements[key]) elements[key].value = value;
  });
  updateCharacterCount();
  showErrors({});
  elements.lessonNotes.focus();
  showToast("Example lesson loaded. Edit it or build the sample plan.");
}

function updateCharacterCount() {
  elements.characterCount.textContent = `${elements.lessonNotes.value.length.toLocaleString()} / 2,500`;
}

async function requestPlan(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${settings.url.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.model,
        stream: false,
        format: PLAN_SCHEMA,
        options: { temperature: 0.15, seed: 42 },
        messages: [{ role: "user", content: buildPrompt(input) }]
      }),
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(response.status === 404 ? `Model “${settings.model}” was not found. Run: ollama pull ${settings.model}` : `Ollama returned ${response.status}: ${body.slice(0, 180)}`);
    }
    return normalizePlan(parseOllamaResponse(await response.json()), input);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The request took more than two minutes. Try gemma3:1b or shorten the notes.");
    if (error instanceof TypeError) throw new Error("Could not reach Ollama. Start it, check the URL in settings, then try again. You can also preview the sample result.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const input = readInput();
  const errors = validateLesson(input);
  showErrors(errors);
  if (Object.keys(errors).length) return;

  currentInput = input;
  setView("loading");
  elements.generateButton.disabled = true;
  elements.generateButton.querySelector("span").textContent = "Building locally…";
  try {
    currentPlan = await requestPlan(input);
    renderPlan(currentPlan, input);
    setView("result");
    elements.resultContent.focus?.();
  } catch (error) {
    elements.resultErrorMessage.textContent = error.message;
    setView("error");
  } finally {
    elements.generateButton.disabled = false;
    elements.generateButton.querySelector("span").textContent = "Build this week’s plan";
  }
}

function makeList(target, values) {
  target.replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

function renderPlan(plan, input) {
  $("#planTitle").textContent = `${input.studentName}’s ${input.instrument.toLowerCase()} plan`;
  $("#planSummary").textContent = plan.summary;
  makeList($("#winsList"), plan.wins);
  makeList($("#focusList"), plan.focusAreas);
  makeList($("#goalList"), plan.nextLessonGoals);
  makeList($("#unknownList"), plan.unknowns);
  $("#unknownCard").hidden = !plan.unknowns.length;
  $("#studentMessage").textContent = plan.studentMessage;
  $("#parentMessage").textContent = plan.parentMessage;

  $("#schedule").replaceChildren(...plan.weekPlan.map((day) => {
    const card = document.createElement("article");
    card.className = "day-card";
    const label = document.createElement("div");
    label.className = "day-label";
    const name = document.createElement("strong");
    name.textContent = day.day;
    const time = document.createElement("span");
    time.textContent = `${day.minutes} minutes`;
    label.append(name, time);
    const blocks = document.createElement("div");
    blocks.className = "practice-blocks";
    day.blocks.forEach((block) => {
      const item = document.createElement("div");
      item.className = "practice-block";
      const activity = document.createElement("strong");
      activity.textContent = `${block.minutes} min · ${block.activity}`;
      const target = document.createElement("p");
      target.textContent = block.target;
      item.append(activity, target);
      blocks.append(item);
    });
    card.append(label, blocks);
    return card;
  }));
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch {
    showToast("Clipboard access was blocked. Select and copy the text manually.");
  }
}

function setupTabs() {
  const tabs = $$('[role="tab"]');
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activateTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + direction + tabs.length) % tabs.length];
      activateTab(next);
      next.focus();
    });
  });
}

function activateTab(active) {
  $$('[role="tab"]').forEach((tab) => {
    const selected = tab === active;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")).hidden = !selected;
  });
}

async function testConnection({ quiet = false } = {}) {
  const url = (elements.ollamaUrl.value || settings.url).replace(/\/$/, "");
  if (!isLoopbackUrl(url)) {
    if (!quiet) elements.connectionResult.textContent = "Use a localhost URL, such as http://localhost:11434.";
    setConnection(false, "Local AI needs setup");
    return false;
  }
  if (!quiet) elements.connectionResult.textContent = "Checking…";
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    const model = elements.modelName.value || settings.model;
    const available = data.models?.some((item) => item.name === model || item.model === model);
    setConnection(true, available ? "Local AI ready" : "Ollama ready · model missing");
    if (!quiet) elements.connectionResult.textContent = available ? `${model} is installed and ready.` : `Ollama is online. Run “ollama pull ${model}” to install this model.`;
    return available;
  } catch {
    setConnection(false, "Local AI offline");
    if (!quiet) elements.connectionResult.textContent = "Ollama is not reachable. Start Ollama, then test again.";
    return false;
  }
}

function setConnection(online, label) {
  elements.connectionButton.classList.toggle("online", online);
  elements.connectionButton.classList.toggle("offline", !online);
  elements.connectionLabel.textContent = label;
}

function openSettings() {
  elements.ollamaUrl.value = settings.url;
  elements.modelName.value = settings.model;
  $("#settingsButton").setAttribute("aria-expanded", "true");
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  if (event.submitter?.value !== "save") return;
  event.preventDefault();
  const nextUrl = elements.ollamaUrl.value.trim().replace(/\/$/, "");
  if (!isLoopbackUrl(nextUrl)) {
    elements.connectionResult.textContent = "TempoDesk only connects to localhost URLs.";
    return;
  }
  settings.url = nextUrl;
  settings.model = elements.modelName.value.trim() || "gemma3:4b";
  localStorage.setItem("tempodesk.ollamaUrl", settings.url);
  localStorage.setItem("tempodesk.model", settings.model);
  elements.modelNote.textContent = settings.model;
  elements.settingsDialog.close();
  showToast("Local AI settings saved.");
  testConnection({ quiet: true });
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  toastTimer = setTimeout(() => { elements.toast.hidden = true; }, 4200);
}

function showSamplePlan() {
  Object.entries(SAMPLE_INPUT).forEach(([key, value]) => {
    if (elements[key]) elements[key].value = value;
  });
  updateCharacterCount();
  currentInput = { ...SAMPLE_INPUT };
  currentPlan = normalizePlan(SAMPLE_PLAN, currentInput);
  renderPlan(currentPlan, currentInput);
  setView("result");
  showToast("Showing the included sample plan. No AI request was made.");
}

elements.form.addEventListener("submit", handleSubmit);
elements.lessonNotes.addEventListener("input", updateCharacterCount);
elements.lessonNotes.addEventListener("blur", () => {
  const input = readInput();
  if (input.lessonNotes && input.lessonNotes.length < 30) showErrors(validateLesson(input));
});
$("#exampleButton").addEventListener("click", fillExample);
$("#settingsButton").addEventListener("click", openSettings);
elements.connectionButton.addEventListener("click", openSettings);
elements.settingsDialog.addEventListener("close", () => $("#settingsButton").setAttribute("aria-expanded", "false"));
$("#settingsForm").addEventListener("submit", saveSettings);
$("#testConnectionButton").addEventListener("click", () => testConnection());
$("#retryButton").addEventListener("click", () => elements.form.requestSubmit());
$("#demoButton").addEventListener("click", showSamplePlan);
$("#emptyDemoButton").addEventListener("click", showSamplePlan);
$("#copyAllButton").addEventListener("click", () => currentPlan && copyText(formatPlanText(currentPlan, currentInput), "Full practice plan copied."));
$$('[data-copy]').forEach((button) => button.addEventListener("click", () => copyText(currentPlan?.[button.dataset.copy] || "", "Message copied.")));
setupTabs();
elements.modelNote.textContent = settings.model;
updateCharacterCount();
testConnection({ quiet: true });

if (new URLSearchParams(window.location.search).get("demo") === "1") {
  Object.entries(SAMPLE_INPUT).forEach(([key, value]) => {
    if (elements[key]) elements[key].value = value;
  });
  updateCharacterCount();
  currentInput = { ...SAMPLE_INPUT };
  currentPlan = normalizePlan(SAMPLE_PLAN, currentInput);
  renderPlan(currentPlan, currentInput);
  setView("result");
}
