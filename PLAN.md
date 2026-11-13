# Speech Coach — plan & roadmap

## Goal
Practice interviews out loud with an AI interviewer that listens, talks back, and can see your
screen or code — behavioral, technical, system design, LeetCode, or any custom scenario — and get
an honest feedback report at the end.

## v1 (built)
- **Setup screen:** interview type, role, company, job description, difficulty, length, AI model, voice.
- **Live interview room:** hands-free voice turn-taking (it listens, sends your answer automatically
  when you pause, and speaks the reply), a typing fallback, a timer, and an "End interview" button.
- **The interviewer sees your work:** screen share on a laptop (it gets a screenshot with each answer)
  and a built-in code editor on any device (its contents are sent with each answer).
- **Feedback report:** an overall score and verdict, category scores, strengths, things to improve,
  rewritten "better answers", next steps, words per minute, and a filler-word count.
- **History:** past sessions are saved in your browser (localStorage).

## Architecture
| Piece | Where | Notes |
|---|---|---|
| Contract (shared types) | `lib/types.ts` | Every module codes against this |
| AI backend | `lib/ai/`, `app/api/interview`, `app/api/feedback` | Claude via `@anthropic-ai/sdk`, streamed replies, structured-output feedback |
| Voice | `lib/voice/`, `app/api/tts` | Browser speech recognition, browser voice or Google Cloud voice |
| Screen & code | `lib/capture/`, `components/capture/` | `getDisplayMedia` screenshots, textarea code editor |
| Pages & UX | `app/page.tsx`, `app/interview/`, `components/room/`, `lib/session/` | Setup, room, feedback, metrics, history |

## Cost
- Interviewer: Claude Haiku 5.5 by default ($0.10 / $0.50 per million input/output tokens), so a
  30-minute session is about a few cents. Screenshots are the largest cost, so only the latest one is sent.
- Feedback report: Claude Sonnet 5.5, one call per interview.
- Voice: the browser voice is free. The Google cloud voice costs fractions of a cent per reply.

## Phase 2 ideas
- [ ] Optional Gemini provider behind `lib/ai/llm.ts`
- [ ] Progress dashboard (scores over time, filler-word trend)
- [ ] LeetCode question bank + company-tagged behavioral question bank
- [ ] Resume upload → tailored questions
- [ ] Webcam: eye contact / posture feedback
- [ ] Realtime speech-to-speech APIs for lower latency and natural interruptions
- [ ] Accounts + cloud sync of sessions
