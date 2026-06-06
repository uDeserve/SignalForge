# Reader Feedback To Case Examples

This page collects short example case shapes derived from real Omni Lingua materials.

These are useful for:

- README proof points
- release notes
- launch posts
- explaining SignalForge to other product teams

## Example 1

Raw signal style:

- `手机上查词弹层太难点`
- `查词不顺手`
- `布局不舒服`
- `手机端体验不好`

Better case:

```text
Mobile lookup interaction interrupts reading flow
```

Why it matters:

- multiple low-signal UX complaints become one mobile reading ergonomics issue

## Example 2

Raw signal style:

- frontend opens but key actions time out
- app feels unstable today
- repeated backend-request failures during reading

Better case:

```text
Reader remains reachable while backend request path becomes unhealthy
```

Why it matters:

- user-visible pain can point to an operational incident before the root cause is fully diagnosed

## Example 3

Raw signal style:

- users say they do not know what to do next
- reading flow feels awkward
- feedback arrives from the reader surface rather than from a support desk

Better case:

```text
Reader workflow clarity breaks at key in-session interaction points
```

Why it matters:

- product confusion becomes a case that can be triaged, labeled, and discussed instead of staying as vague qualitative noise

## Source Boundary

These examples are derived from:

- Omni Lingua feedback reason taxonomy
- Omni Lingua SignalForge bridge tests
- Omni Lingua incident and verification documents

They are intended as faithful case shapes, not as inflated claims about precise historical frequency.
