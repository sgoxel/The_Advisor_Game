# Evidence Trigger Markers

These files provide a repository-native fallback for required verification when the connected Worker environment cannot invoke `workflow_dispatch` directly.

A workflow may include its marker path in `on.push.paths`. Updating only that marker creates a harmless current-main descendant and triggers the workflow without editing product code or weakening acceptance criteria.

Rules:
- Use only when required evidence is otherwise non-dispatchable or a fresh current-main descendant check is specifically needed.
- Record target issue, reason, requested suite, and source/candidate SHA in the marker.
- The resulting workflow run verifies the marker commit (a descendant containing the prior candidate unchanged). A Tester may reuse it only when the target acceptance criteria allow descendant evidence.
- If exact original-candidate SHA evidence is explicitly required and descendant evidence is not allowed, the marker is not a substitute; route a focused workflow infrastructure fix instead.
- Do not repeatedly update a marker for an unchanged failure/wait. One request, then inspect the terminal evidence.
- Marker commits contain no product authority or gameplay state.
