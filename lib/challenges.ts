/**
 * Codebases + tasks for the "AI-assisted coding" mode. Real public repos, so
 * every link works; tasks are written to fit each repo's actual structure.
 * Shared by the client (shows the task) and server (puts it in the prompt).
 */
import type { Difficulty } from "@/lib/types";

export interface Challenge {
  id: string;
  difficulty: Difficulty;
  repo: string;
  url: string;
  language: string;
  task: string;
}

export const CHALLENGES: Challenge[] = [
  {
    id: "micrograd-exp",
    difficulty: "easy",
    repo: "karpathy/micrograd",
    url: "https://github.com/karpathy/micrograd",
    language: "Python",
    task: "Add exp() and sigmoid() operations to the Value class with correct gradients, and add a test that checks their gradients.",
  },
  {
    id: "minbpe-ratio",
    difficulty: "easy",
    repo: "karpathy/minbpe",
    url: "https://github.com/karpathy/minbpe",
    language: "Python",
    task: "Add a helper that reports a tokenizer's compression ratio on a text (UTF-8 bytes in ÷ tokens out), use it in train.py, and add a test.",
  },
  {
    id: "flaskr-search",
    difficulty: "easy",
    repo: "pallets/flask (examples/tutorial)",
    url: "https://github.com/pallets/flask/tree/main/examples/tutorial",
    language: "Python",
    task: "In the Flaskr tutorial blog app, add a search box on the index page that filters posts by title or body, with a test.",
  },
  {
    id: "petclinic-vet-filter",
    difficulty: "medium",
    repo: "spring-projects/spring-petclinic",
    url: "https://github.com/spring-projects/spring-petclinic",
    language: "Java",
    task: "Let users filter the Veterinarians page by specialty (for example only show radiology vets), and add a test for it.",
  },
  {
    id: "realworld-report",
    difficulty: "medium",
    repo: "gothinkster/node-express-realworld-example-app",
    url: "https://github.com/gothinkster/node-express-realworld-example-app",
    language: "TypeScript",
    task: "Add a way for a logged-in user to report an article, plus an endpoint that lists the most-reported articles. A user can only report an article once.",
  },
  {
    id: "nanogpt-top-p",
    difficulty: "medium",
    repo: "karpathy/nanoGPT",
    url: "https://github.com/karpathy/nanoGPT",
    language: "Python",
    task: "Add top-p (nucleus) sampling to text generation alongside the existing top-k, and expose it as an option in sample.py.",
  },
  {
    id: "fastapi-due-date",
    difficulty: "hard",
    repo: "fastapi/full-stack-fastapi-template",
    url: "https://github.com/fastapi/full-stack-fastapi-template",
    language: "Python + TypeScript",
    task: "Add an optional due date to Items end to end: the database model and migration, the API, and the frontend form and list. Overdue items should stand out.",
  },
  {
    id: "microblog-likes",
    difficulty: "hard",
    repo: "miguelgrinberg/microblog",
    url: "https://github.com/miguelgrinberg/microblog",
    language: "Python",
    task: "Let users like and unlike posts. Show a like count on each post, add a migration, and add tests. A user can like a post only once.",
  },
  {
    id: "nanogpt-kv-cache",
    difficulty: "hard",
    repo: "karpathy/nanoGPT",
    url: "https://github.com/karpathy/nanoGPT",
    language: "Python",
    task: "Add a key/value cache to generation so each new token doesn't recompute attention over the whole sequence. Show that the output matches the uncached version.",
  },
];

export function getChallenge(id: string): Challenge | undefined {
  return CHALLENGES.find((c) => c.id === id);
}

/** Random challenge at this difficulty, avoiding `lastId` so back-to-back sessions differ. */
export function pickChallenge(difficulty: Difficulty, lastId = ""): Challenge {
  const pool = CHALLENGES.filter((c) => c.difficulty === difficulty && c.id !== lastId);
  return pool[Math.floor(Math.random() * pool.length)];
}
