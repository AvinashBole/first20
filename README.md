# First 20 Hours

A practice cockpit for Josh Kaufman's rapid skill acquisition method ("The First 20 Hours", TEDxCSU):

1. **Deconstruct the skill.** Define the target performance, break the skill into sub-skills, and practice the most important ones first.
2. **Learn enough to self-correct.** Use 3–5 resources, and don't let reading become procrastination.
3. **Remove barriers to practice.** Clear distractions and get your tools ready.
4. **Pre-commit to 20 hours.** This gets you past the frustration barrier.

**Live app:** https://avinashbole.github.io/first20/

## What it does
- Pre-session barrier checklist, the drill, and self-correction cues.
- Session timer. Paused time is excluded and only practice counts toward the 20 h. Research time has a separate, capped timer.
- One-tap logging of every rep (clean or miss), miss tags, and distractions. Keys: `j` `k` `1-8` `d` `space`.
- After each session: one measured metric, a frustration rating from 1 to 5, a one-line note, and instant feedback.
- Dashboard: the 20 h ring with pace and ETA, live flags (rules taken from the talk), per-sub-skill accuracy and metric trend, top errors, the frustration curve, the research budget, and a session log.
- AI coach card that shows the latest Claude review.

## AI loop (Claude Code)
- `/learn <skill>`: Claude deconstructs the skill into a plan and opens `…/first20/#import=<plan>`.
- Practice in the app. After 2 or 3 sessions, click **Export for Claude review**.
- `/learn review`: Claude analyzes the logged sessions and checks whether earlier actions worked, then updates the plan. The import link updates the app and keeps your sessions.

## Privacy
This is a static site with no backend and no network requests (the CSP sets `connect-src 'none'`). All data stays in your browser's `localStorage`. Plans arrive in the URL fragment, which browsers never send to the server. Use **Export** to back up your data or move it to another device, and **Import** on the home screen to restore it.

## Plan format
See the `cleanPlan()` function in `app.js` for the whitelisted schema. A demo plan (the ukulele example from the talk) is on the home screen.
