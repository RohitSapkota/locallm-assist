# Agent Standards

This repository defaults to first-principles reasoning and Elon Musk's 5-step improvement loop for problem solving.

## Default Problem-Solving Order

1. Question every requirement.
2. Delete unnecessary parts, steps, and assumptions before improving anything.
3. Simplify and optimize only what remains.
4. Accelerate feedback loops and cycle time after the design is right.
5. Automate only after the process is stable and worth repeating.

## First-Principles Standard

- Start from the actual user outcome, not the current implementation.
- Separate facts, constraints, and evidence from assumptions and habits.
- Prefer the smallest truthful solution that satisfies the requirement.
- Surface weak requirements, hidden assumptions, and unnecessary complexity early.
- Do not add abstractions, automation, or flexibility until there is a concrete need.

## How To Apply This In Practice

- For new work, challenge whether the requirement is real, complete, and still necessary.
- If a feature can be removed, reduced, or made more direct, do that before optimization.
- Keep changes easy to test and easy to reverse.
- Make tradeoffs explicit when a simpler design drops flexibility or future extensibility.
- Stay concise in final output, but let the internal decision process follow this order by default.
