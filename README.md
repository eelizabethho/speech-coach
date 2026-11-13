# Speech Coach 🎤

Practice interviews **out loud** with an AI interviewer. Pick a scenario (behavioral, technical,
system design, LeetCode, or describe your own) and have a real back-and-forth conversation. The
interviewer listens, replies out loud, can see your shared screen or code, and gives you a
detailed feedback report at the end.

## Quick start (laptop)
```bash
npm install
cp .env.example .env.local      # then paste your ANTHROPIC_API_KEY
npm run dev
```
Open http://localhost:3000 in **Chrome** (best speech support) and allow the microphone.

## Use it on your phone
Deploy it for free on Vercel:
1. Go to vercel.com → **Add New → Project** → import `eelizabethho/speech-coach`.
2. Under **Environment Variables**, add `ANTHROPIC_API_KEY` (and optionally `GOOGLE_TTS_API_KEY`).
3. Deploy, then open the URL on your phone or laptop.

> ⚠️ Anyone with your deployment URL can use your API key. Keep the URL private, or add
> Vercel password protection.

| Feature | Laptop (Chrome/Edge) | Android Chrome | iPhone Safari |
|---|---|---|---|
| Voice conversation | ✅ | ✅ | ✅ (tap Start first) |
| Screen sharing | ✅ | ❌ | ❌ |
| Code editor panel | ✅ | ✅ | ✅ |

## Keys and cost
- `ANTHROPIC_API_KEY` (required): from https://console.anthropic.com. The default interviewer is
  Claude Haiku 5.5, so a 30-minute mock costs roughly a few cents. You can switch to Sonnet or Opus
  on the setup screen for a sharper interviewer.
- `GOOGLE_TTS_API_KEY` (optional): turns on the more natural **cloud voice**. Without it, the free
  built-in browser voice is used.

## Manual test checklist
- [ ] Start a behavioral interview, then answer by voice: it auto-sends when you pause and the
      interviewer replies out loud
- [ ] Tap the mic while the interviewer is talking: it stops and listens to you
- [ ] LeetCode mode: type code in the panel, then mention it in your answer; the interviewer refers to it
- [ ] Laptop: share your screen and ask "what do you see?"
- [ ] End the interview and check that the feedback report and filler-word stats appear
- [ ] The session shows up under Past sessions

See [PLAN.md](PLAN.md) for the architecture and roadmap.
