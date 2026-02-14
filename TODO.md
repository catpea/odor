# TODO


---

- ## TODO LONG-TERM, NOT SCHEDULED FOR EXECUTION

## Conversational Learning Loop

A self-improving strategy where the AI fixes a poem, reflects on what it learned, and loops back for another pass if it gained new insight. Uses muriel's `send.to()` for routing back through the pipeline.

### The Vision

```js
['each-blogpost',
  fixPoemWithLessons(),
  evaluateAndReflect(),
  route({
    'each-blogpost': p => p._learnedSomethingNew,  // loop back
    'fixed-poem': p => !p._learnedSomethingNew,     // done
  })
],
['fixed-poem', collectResults, 'done']
```

### What's Missing

1. **User-sourced lessons** — Right now reflection only captures the AI's self-assessment. When you reject a change or manually correct something, that reasoning should be captured as a lesson too. The AI needs to learn from *you*, not just from itself.

2. **Multi-turn dialogue** — The current prompt-response cycle is one-shot. A conversational strategy would need a back-and-forth chat session per post where you and the AI co-edit, and lessons emerge from the dialogue:
   - AI: "Here's what I'd change..."
   - You: "No, that made it worse because..."
   - AI: "Ah, I see — saving that as a lesson."

3. **Loop termination** — Routing back to `'each-blogpost'` with `send.to()` needs a reliable stop condition. "Did I learn something new?" could loop forever with a chatty model. Options:
   - Max iteration count (e.g., 3 passes)
   - Diminishing returns threshold (fewer corrections each pass)
   - User approval gate before looping

4. **Lesson quality** — Current lessons are single sentences from the AI. Conversational lessons would be richer (user preferences, style rules, domain knowledge) and need better dedup/pruning to avoid prompt bloat.

### Implementation Stages

**Stage 1 — Capture user feedback as lessons**
- When user rejects a change, prompt: "Why did you reject this?" (optional)
- Save the answer as a lesson tied to the task
- When user manually edits after accepting, diff the edit and save as a lesson

**Stage 2 — Multi-turn chat strategy**
- New strategy: `conversational`
- Opens a chat session per post (not one-shot)
- AI proposes changes, user responds, AI adjusts
- Lessons extracted from the conversation at the end

**Stage 3 — Learning loop with `send.to()`**
- Wire the conversational strategy into a loop via `route()`
- AI applies lessons, re-evaluates, loops if meaningful improvement is possible
- Max iterations cap for safety
- Final approval before writing to disk
