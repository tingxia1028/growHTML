// Register the CODE-registered built-in triggers (PRO-1 / PRO-2). A side-effect module
// (the ./theme/builtins idiom): importing it once at client startup arms the built-ins the
// proactive tick evaluates. PRO-1 shipped the review-push exemplar (enabled); PRO-2 adds
// the teach-back trigger shipped enabled:false (opt-in — the 克制 default that avoids the
// double-nudge on the shared reviewDue signal until PRO-3's distinct teachDue lands).

import { registerReviewPushTrigger } from "./reviewPush";
import { registerTeachbackTrigger } from "./teachbackTrigger";

registerReviewPushTrigger();
registerTeachbackTrigger();
