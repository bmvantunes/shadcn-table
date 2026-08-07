# Require source-native Match-None Filter semantics

Set Filter state preserves `only these` versus `everything except these` intent, and an empty
inclusion set means Match None for current and future values. The Server Adapter must compile that
intent to an explicit source-native Match-None Filter Expression; it must not use empty `in` when the
source normalizes that form away or negate the currently observed facet values, because a future
value would then match unexpectedly. The required View Server contract is tracked in
[effect-view-server#409](https://github.com/bmvantunes/effect-view-server/issues/409).
