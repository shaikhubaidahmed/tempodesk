export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    wins: { type: "array", items: { type: "string" } },
    focusAreas: { type: "array", items: { type: "string" } },
    weekPlan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "string" },
          minutes: { type: "integer" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                minutes: { type: "integer" },
                activity: { type: "string" },
                target: { type: "string" }
              },
              required: ["minutes", "activity", "target"]
            }
          }
        },
        required: ["day", "minutes", "blocks"]
      }
    },
    studentMessage: { type: "string" },
    parentMessage: { type: "string" },
    nextLessonGoals: { type: "array", items: { type: "string" } },
    unknowns: { type: "array", items: { type: "string" } }
  },
  required: ["summary", "wins", "focusAreas", "weekPlan", "studentMessage", "parentMessage", "nextLessonGoals", "unknowns"]
};

const clean = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const cleanList = (value, fallback = []) => Array.isArray(value) ? value.map((item) => clean(item)).filter(Boolean).slice(0, 6) : fallback;
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

export function validateLesson(input) {
  const errors = {};
  if (!clean(input.studentName)) errors.studentName = "Enter the student’s first name.";
  if (!clean(input.instrument)) errors.instrument = "Choose an instrument.";
  if (clean(input.lessonNotes).length < 30) errors.lessonNotes = "Add at least 30 characters of lesson notes so the plan has useful evidence.";
  const minutes = Number(input.minutes);
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 120) errors.minutes = "Use 5–120 minutes per day.";
  const days = Number(input.days);
  if (!Number.isFinite(days) || days < 1 || days > 7) errors.days = "Use 1–7 days per week.";
  return errors;
}

export function buildPrompt(input) {
  return `You are TempoDesk, a careful assistant for independent music teachers. Convert raw lesson notes into a practical weekly practice brief.

Rules:
- Use only facts present in the teacher's input. Never invent a piece title, grade, deadline, diagnosis, achievement, or personal detail.
- If a useful fact is missing, put a short question in unknowns instead of guessing.
- Make each practice target observable and student-friendly.
- Create exactly ${input.days} practice days, each totaling about ${input.minutes} minutes. Keep block minutes realistic and make their sum equal the day's minutes.
- wins and focusAreas should each have 1–3 concise items.
- studentMessage should speak directly to ${input.studentName}, warmly and without baby talk.
- parentMessage should be factual, concise, and suitable to paste into a message. Do not mention AI.
- nextLessonGoals should be things the teacher can actually check.
- Return only JSON matching the provided schema.

Student first name: ${input.studentName}
Instrument: ${input.instrument}
Level: ${input.level}
Available practice: ${input.minutes} minutes/day, ${input.days} days/week

Teacher's raw notes:
${input.lessonNotes}`;
}

export function parseOllamaResponse(payload) {
  const content = payload?.message?.content ?? payload?.response;
  if (typeof content !== "string") throw new Error("Ollama returned no plan content.");
  const stripped = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) return JSON.parse(stripped.slice(first, last + 1));
    throw new Error("The model response was not valid JSON. Try again or use a larger Gemma model.");
  }
}

export function normalizePlan(raw, input) {
  const requestedDays = clamp(input.days, 1, 7, 5);
  const requestedMinutes = clamp(input.minutes, 5, 120, 20);
  const sourceDays = Array.isArray(raw?.weekPlan) ? raw.weekPlan : [];
  const fallbackDays = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

  const weekPlan = Array.from({ length: requestedDays }, (_, index) => {
    const source = sourceDays[index] || {};
    const sourceBlocks = Array.isArray(source.blocks) ? source.blocks : [];
    let blocks = sourceBlocks.slice(0, 5).map((block) => ({
      minutes: clamp(block?.minutes, 1, requestedMinutes, 5),
      activity: clean(block?.activity, "Focused practice"),
      target: clean(block?.target, "Repeat slowly and notice one improvement.")
    }));
    if (!blocks.length) blocks = [{ minutes: requestedMinutes, activity: "Focused practice", target: "Repeat the lesson focus slowly and accurately." }];
    let difference = requestedMinutes - blocks.reduce((sum, block) => sum + block.minutes, 0);
    if (difference > 0) blocks[blocks.length - 1].minutes += difference;
    for (let blockIndex = blocks.length - 1; difference < 0 && blockIndex >= 0; blockIndex -= 1) {
      const reducible = blocks[blockIndex].minutes - 1;
      const reduction = Math.min(reducible, -difference);
      blocks[blockIndex].minutes -= reduction;
      difference += reduction;
    }
    return {
      day: clean(source.day, fallbackDays[index]),
      minutes: blocks.reduce((sum, block) => sum + block.minutes, 0),
      blocks
    };
  });

  return {
    summary: clean(raw?.summary, `A focused ${requestedDays}-day plan based on this lesson.`),
    wins: cleanList(raw?.wins, ["Showed up and worked through today’s material."]),
    focusAreas: cleanList(raw?.focusAreas, ["Repeat the main lesson focus slowly and evenly."]),
    weekPlan,
    studentMessage: clean(raw?.studentMessage, `Hi ${input.studentName}! Your practice plan is ready. Keep each session calm and focused, and notice one small improvement each day.`),
    parentMessage: clean(raw?.parentMessage, `${input.studentName} has a ${requestedDays}-day practice plan based on today’s ${input.instrument.toLowerCase()} lesson. Short, consistent sessions will help most this week.`),
    nextLessonGoals: cleanList(raw?.nextLessonGoals, ["Check whether the student can demonstrate the week’s focus independently."]),
    unknowns: cleanList(raw?.unknowns)
  };
}

export function formatPlanText(plan, input) {
  const days = plan.weekPlan.map((day) => {
    const blocks = day.blocks.map((block) => `  - ${block.minutes} min — ${block.activity}: ${block.target}`).join("\n");
    return `${day.day} (${day.minutes} min)\n${blocks}`;
  }).join("\n\n");
  return `${input.studentName}'s ${input.instrument} practice plan\n\n${plan.summary}\n\nWINS\n${plan.wins.map((item) => `- ${item}`).join("\n")}\n\nFOCUS\n${plan.focusAreas.map((item) => `- ${item}`).join("\n")}\n\nWEEK PLAN\n${days}\n\nSTUDENT RECAP\n${plan.studentMessage}\n\nPARENT UPDATE\n${plan.parentMessage}\n\nNEXT LESSON\n${plan.nextLessonGoals.map((item) => `- ${item}`).join("\n")}`;
}

export const SAMPLE_INPUT = {
  studentName: "Maya",
  instrument: "Piano",
  level: "Early intermediate",
  minutes: 20,
  days: 5,
  lessonNotes: "Maya kept a steady pulse in the first half of Minuet in G and corrected two missed notes without prompting. Left hand became tense when hands played together, especially in bars 9–12. We practised those bars hands-separate at a slow tempo. C major scale was confident ascending but fingering slipped on the way down. She responds well to counting aloud. Please keep sessions short because school exams are this week."
};

export const SAMPLE_PLAN = {
  summary: "Keep the confident pulse while making the left hand feel easier. Short sessions use counting aloud and hands-separate work before a careful return to hands together.",
  wins: ["Held a steady pulse through the first half of Minuet in G.", "Self-corrected two notes without a prompt."],
  focusAreas: ["Release left-hand tension in bars 9–12.", "Keep correct descending fingering in the C major scale."],
  weekPlan: [
    { day: "Day 1", minutes: 20, blocks: [{ minutes: 5, activity: "C major scale", target: "Play up and down slowly 3 times with consistent fingering." }, { minutes: 10, activity: "Bars 9–12, hands separate", target: "Count aloud and keep the left wrist loose for 4 accurate repeats." }, { minutes: 5, activity: "Minuet recap", target: "Play the first half once with a steady pulse." }] },
    { day: "Day 2", minutes: 20, blocks: [{ minutes: 5, activity: "C major scale", target: "Pause before descending, then complete 3 accurate repetitions." }, { minutes: 10, activity: "Bars 9–12, hands separate", target: "Play each hand twice without tightening." }, { minutes: 5, activity: "Hands together", target: "Join bars 9–10 slowly while counting aloud." }] },
    { day: "Day 3", minutes: 20, blocks: [{ minutes: 4, activity: "Reset", target: "Shake out both hands and play an easy warm-up with relaxed wrists." }, { minutes: 11, activity: "Bars 9–12", target: "Alternate one hands-separate repeat with one hands-together attempt." }, { minutes: 5, activity: "First half", target: "Play once without stopping; circle only the place that needs another look." }] },
    { day: "Day 4", minutes: 20, blocks: [{ minutes: 5, activity: "C major scale", target: "Complete 3 even up-and-down repetitions with correct fingering." }, { minutes: 10, activity: "Bars 9–12", target: "Play hands together 3 times slowly with a loose left hand." }, { minutes: 5, activity: "Choice repeat", target: "Repeat the trickiest two bars once more, slowly." }] },
    { day: "Day 5", minutes: 20, blocks: [{ minutes: 5, activity: "Scale check", target: "Play C major once slowly and once at a comfortable tempo." }, { minutes: 10, activity: "Minuet performance", target: "Play the first half, keeping the pulse even through bars 9–12." }, { minutes: 5, activity: "Reflection", target: "Name one part that feels easier and one part to show next lesson." }] }
  ],
  studentMessage: "Hi Maya! This week, keep your sessions short and calm. Count aloud in bars 9–12, practise each hand separately first, and check that your left wrist stays loose. Your steady pulse is already a real strength—build on it one small repeat at a time.",
  parentMessage: "Maya made good progress with a steady pulse and corrected two notes independently today. This week she has five short 20-minute sessions focused on relaxed left-hand work in bars 9–12 and consistent descending fingering in the C major scale. Short sessions are intentional because of her school exams.",
  nextLessonGoals: ["Hear the first half of Minuet in G with a steady pulse.", "Check whether bars 9–12 can be played hands together without left-hand tension.", "Check descending C major fingering at a comfortable tempo."],
  unknowns: ["What tempo feels comfortable for hands-together practice?", "Is there a preferred fingering edition for Minuet in G?"]
};
