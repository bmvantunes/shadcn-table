# Derive the edit safety footer from the save capability

`BrunoTableClient` and `BrunoTableServer` accept an input-modality-neutral `onSaveEdits` operation. Its presence activates the Batch Save Capability and automatically mounts BrunoTable's persistent Edit Safety Footer; pages do not compose their own Reset, Save, conflict-count, or validation plumbing.

The footer places conditional edit status on the left and Reset and Save on the right. The conflict count appears only when non-zero. Activating it or activating Save while unresolved conflicts exist opens the same conflict-resolution workflow, and `onSaveEdits` is not invoked until conflicts and blocking validation are resolved.
