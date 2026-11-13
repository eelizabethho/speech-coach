import type { InterviewMode } from "@/lib/types";

export const MODE_ORDER: InterviewMode[] = ["behavioral", "technical", "system-design", "leetcode", "custom"];

export const MODE_INFO: Record<InterviewMode, { icon: string; description: string; tip: string }> = {
  behavioral: {
    icon: "B",
    description: "STAR stories about teamwork, conflict, and impact.",
    tip: "Structure answers as Situation, Task, Action, Result — and quantify the result.",
  },
  technical: {
    icon: "T",
    description: "CS fundamentals, your projects, and trade-offs.",
    tip: "Say your reasoning out loud, and name trade-offs before you commit to an answer.",
  },
  "system-design": {
    icon: "S",
    description: "Design a scalable system out loud, whiteboard-style.",
    tip: "Clarify requirements first, then sketch the high-level design before diving deep. Share a diagram tool if you like.",
  },
  leetcode: {
    icon: "</>",
    description: "Solve a coding problem while thinking aloud.",
    tip: "Restate the problem, walk through an example, then code. The interviewer sees the code panel each time you answer.",
  },
  custom: {
    icon: "+",
    description: "Describe any scenario and the interviewer plays it.",
    tip: "The interviewer follows your scenario — be specific about the role and what you want to practice.",
  },
};
