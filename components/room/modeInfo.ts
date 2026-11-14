import type { InterviewMode } from "@/lib/types";

export const MODE_ORDER: InterviewMode[] = ["behavioral", "technical", "system-design", "leetcode", "ai-coding", "custom"];

export const MODE_INFO: Record<InterviewMode, { description: string; tip: string }> = {
  behavioral: {
    description: "STAR stories about teamwork, conflict, and impact.",
    tip: "Structure answers as Situation, Task, Action, Result — and quantify the result.",
  },
  technical: {
    description: "CS fundamentals, your projects, and trade-offs.",
    tip: "Say your reasoning out loud, and name trade-offs before you commit to an answer.",
  },
  "system-design": {
    description: "Design a scalable system out loud, whiteboard-style.",
    tip: "Clarify requirements first, then sketch the high-level design before diving deep. Share a diagram tool if you like.",
  },
  leetcode: {
    description: "Solve a coding problem while thinking aloud.",
    tip: "Open the problem on LeetCode in another tab, then share that tab when the interview starts. The interviewer reads the problem and your code from your screen.",
  },
  "ai-coding": {
    description: "Build a feature in a real codebase with an AI assistant.",
    tip: "Open the repo in your editor with your AI tool and share that window. Read the code before prompting, give the AI small focused asks, and review and test everything it writes.",
  },
  custom: {
    description: "Describe any scenario and the interviewer plays it.",
    tip: "The interviewer follows your scenario — be specific about the role and what you want to practice.",
  },
};
