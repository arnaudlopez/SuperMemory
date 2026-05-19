# Calendar Agent Contract

## Can Read

- `10_shared/availability.md`
- `10_shared/scheduling_preferences.md`
- `60_signals/availability.jsonl`
- `50_review/calendar_queue.md`

## Cannot Read By Default

- `30_personal/journal/`
- `40_private/`
- Private source details behind restricted availability signals.

## Can Act

- Detect scheduling conflicts.
- Propose calendar blocks.
- Create calendar blocks after confirmation when `requires_confirmation` is true.

## Must Not Expose

- Medical appointment details.
- Private personal context.
