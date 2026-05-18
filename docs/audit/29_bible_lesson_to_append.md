# Bible lessons — copy-paste to Notion lessons table

Three rows for the NZA Development Bible "Lessons learned" table. Pasting
verbatim for ease of copy.

---

| Lesson | Source | Date |
|---|---|---|
| The name of an engine in the UI must correspond to what the engine actually computes. If a layer between the engine and the user re-implements the calculation, that layer IS the engine and should be named accordingly. NZA-Sim's "Dynamic" has been a Python re-implementation of Static with EP's T_zone trace substituted in, not EP's own heat balance — discovered Brief 29 Part 2. | NZA-Sim Brief 29 Part 2 / Issue #8 | May 2026 |
| Parameter binding at an API boundary can silently disable a feature without raising any error. The only thing that catches this is an end-to-end test verifying that calling the feature with input X actually produces behaviour X downstream — not a unit test on the handler, not a type check on the parameter, an integration test on the full pipeline. Every mode-like parameter in a request handler needs this test. | NZA-Sim Brief 30 / Issue #13 re-diagnosis | May 2026 |
| When a problem keeps having "the real root cause" turn out to be one level deeper than the previous diagnosis, the working assumption should be that more layers remain. Continue diagnostic discipline; do not accept the latest plausible cause as final until the symptom is fully explained and verifiable from end to end. | NZA-Sim Brief 29/30 multi-layer diagnostics | May 2026 |
