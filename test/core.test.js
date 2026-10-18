import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_INPUT,
  SAMPLE_PLAN,
  buildPrompt,
  formatPlanText,
  normalizePlan,
  parseOllamaResponse,
  validateLesson
} from "../src/core.js";

test("validates the minimum useful lesson input", () => {
  assert.deepEqual(validateLesson(SAMPLE_INPUT), {});
  const errors = validateLesson({ studentName: "", instrument: "", minutes: 2, days: 9, lessonNotes: "short" });
  assert.deepEqual(Object.keys(errors).sort(), ["days", "instrument", "lessonNotes", "minutes", "studentName"]);
});

test("builds an evidence-grounded prompt with requested limits", () => {
  const prompt = buildPrompt(SAMPLE_INPUT);
  assert.match(prompt, /exactly 5 practice days/);
  assert.match(prompt, /about 20 minutes/);
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /Maya/);
});

test("parses both Ollama chat JSON and fenced JSON", () => {
  assert.deepEqual(parseOllamaResponse({ message: { content: '{"summary":"ok"}' } }), { summary: "ok" });
  assert.deepEqual(parseOllamaResponse({ response: '```json\n{"summary":"ok"}\n```' }), { summary: "ok" });
});

test("normalizes model output to exact requested days and minutes", () => {
  const malformed = {
    ...SAMPLE_PLAN,
    weekPlan: [
      { ...SAMPLE_PLAN.weekPlan[0], blocks: SAMPLE_PLAN.weekPlan[0].blocks.map((block) => ({ ...block, minutes: 20 })) },
      ...SAMPLE_PLAN.weekPlan.slice(1, 2)
    ]
  };
  const plan = normalizePlan(malformed, SAMPLE_INPUT);
  assert.equal(plan.weekPlan.length, 5);
  for (const day of plan.weekPlan) {
    assert.equal(day.blocks.reduce((sum, block) => sum + block.minutes, 0), 20);
    assert.equal(day.minutes, 20);
  }
});

test("formats a complete copyable plan", () => {
  const plan = normalizePlan(SAMPLE_PLAN, SAMPLE_INPUT);
  const text = formatPlanText(plan, SAMPLE_INPUT);
  assert.match(text, /Maya's Piano practice plan/);
  assert.match(text, /STUDENT RECAP/);
  assert.match(text, /Day 5/);
});
